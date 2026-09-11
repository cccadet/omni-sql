# ODBC integration test

Builds a Linux/Node 22 environment with unixODBC and the SQLite ODBC driver,
then exercises the real native `odbc` addon, bounded queries, metadata discovery,
column types, and primary keys.

From the repository root:

```bash
docker build -f docker/odbc-test/Dockerfile -t omni-sql-odbc-test .
docker run --rm omni-sql-odbc-test
```
