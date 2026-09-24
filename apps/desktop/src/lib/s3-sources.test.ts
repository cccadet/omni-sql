import { expect, test } from "vitest";
import { detectS3Tables } from "./s3-sources";

test("detects mixed tables in one S3 bucket", () => {
  expect(detectS3Tables([
    "s3://bucket/csv/orders.csv",
    "s3://bucket/parquet/orders.parquet",
    "s3://bucket/delta/orders/_delta_log/00000000000000000000.json",
    "s3://bucket/delta/orders/part-000.parquet",
    "s3://bucket/iceberg/orders/metadata/current.metadata.json",
    "s3://bucket/iceberg/orders/data/part-000.parquet",
  ])).toEqual([
    { uri: "s3://bucket/csv/orders.csv", name: "orders.csv", format: "csv" },
    { uri: "s3://bucket/delta/orders", name: "orders", format: "delta" },
    { uri: "s3://bucket/iceberg/orders/metadata/current.metadata.json", name: "orders", format: "iceberg" },
    { uri: "s3://bucket/parquet/orders.parquet", name: "orders.parquet", format: "parquet" },
  ]);
});
