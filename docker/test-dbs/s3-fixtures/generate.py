"""Create small, real CSV, Parquet, Delta and Iceberg tables in test MinIO."""

import io
import os
import time
from urllib.parse import urlparse

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from deltalake import write_deltalake
from pyiceberg.catalog.sql import SqlCatalog


BUCKET = "omni-test"
EXTRA_BUCKET = "omni-extra"
ENDPOINT = os.environ["AWS_ENDPOINT_URL"]
ACCESS_KEY = os.environ["AWS_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["AWS_SECRET_ACCESS_KEY"]
REGION = os.environ["AWS_DEFAULT_REGION"]

s3 = boto3.client(
    "s3", endpoint_url=ENDPOINT, region_name=REGION,
    aws_access_key_id=ACCESS_KEY, aws_secret_access_key=SECRET_KEY,
)
for attempt in range(30):
    try:
        s3.list_buckets()
        break
    except Exception:
        if attempt == 29:
            raise
        time.sleep(2)

try:
    s3.create_bucket(Bucket=BUCKET)
except s3.exceptions.BucketAlreadyOwnedByYou:
    pass
try:
    s3.create_bucket(Bucket=EXTRA_BUCKET)
except s3.exceptions.BucketAlreadyOwnedByYou:
    pass

data = pa.table({"id": pa.array([1, 2, 3], pa.int64()), "amount": pa.array([10, 20, 30], pa.int64())})
s3.put_object(Bucket=BUCKET, Key="csv/orders.csv", Body=b"id,amount\n1,10\n2,20\n3,30\n")
s3.put_object(Bucket=EXTRA_BUCKET, Key="csv/customers.csv", Body=b"id,name\n1,Ada\n2,Lin\n3,Sam\n")
parquet_bytes = io.BytesIO()
pq.write_table(data, parquet_bytes)
s3.put_object(Bucket=BUCKET, Key="parquet/orders.parquet", Body=parquet_bytes.getvalue())

write_deltalake(
    f"s3://{BUCKET}/delta/orders", data, mode="overwrite",
    storage_options={
        "AWS_ACCESS_KEY_ID": ACCESS_KEY,
        "AWS_SECRET_ACCESS_KEY": SECRET_KEY,
        "AWS_REGION": REGION,
        "AWS_ENDPOINT_URL": ENDPOINT,
        "AWS_S3_ALLOW_UNSAFE_RENAME": "true",
        "allow_http": "true",
    },
)

catalog = SqlCatalog(
    "omni", uri="sqlite:////tmp/omni-iceberg-catalog.db",
    warehouse=f"s3://{BUCKET}/iceberg",
    **{
        "py-io-impl": "pyiceberg.io.pyarrow.PyArrowFileIO",
        "s3.endpoint": ENDPOINT,
        "s3.access-key-id": ACCESS_KEY,
        "s3.secret-access-key": SECRET_KEY,
        "s3.region": REGION,
    },
)
catalog.create_namespace_if_not_exists("default")
table = catalog.create_table("default.orders", schema=data.schema, location=f"s3://{BUCKET}/iceberg/orders")
table.append(data)
metadata = urlparse(table.metadata_location)
s3.copy_object(
    Bucket=BUCKET,
    CopySource={"Bucket": metadata.netloc, "Key": metadata.path.lstrip("/")},
    Key="iceberg/orders/metadata/current.metadata.json",
)
print("S3 fixtures ready: CSV, Parquet, Delta, Iceberg, second bucket")
