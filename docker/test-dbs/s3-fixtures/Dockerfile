FROM python:3.12-slim

RUN pip install --no-cache-dir \
    boto3==1.40.18 \
    pyarrow==21.0.0 \
    deltalake==1.1.4 \
    "pyiceberg[pyarrow,sql-sqlite]==0.10.0"

WORKDIR /fixtures
COPY generate.py .
CMD ["python", "generate.py"]
