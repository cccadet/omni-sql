# Test databases

Docker fixtures with fictional data for adapter smoke tests and integration
tests. This folder is a pnpm workspace package, so tests use the current
`packages/adapters-*` sources without a rebuild.

For the full, evidence-producing run use `pnpm test:integration` from the
repository root (see [Testing](../../docs/TESTING.md)). The commands below are
for investigating one path by hand.

## Services

| Service | Image | Port | User / password |
| --- | --- | --- | --- |
| `postgres` | `postgres:16` | 5432 | `omni` / `omni` (database `omni_test`) |
| `mysql` | `mysql:8` | 3306 | `omni` / `omni` (database `omni_test`) |
| `mariadb` | `mariadb:11.4` | 3307 | `omni` / `omni` |
| `mssql` | `mssql/server:2022-latest` | 1433 | `sa` / `Omni!2024` (database `omni_test`) |
| `oracle` | `gvenzl/oracle-xe:21-slim` | 1521 | `OMNI` / `omni` (service `XEPDB1`) |
| `mongo` | `mongo:8` | 27017 | `omni_root` / `omni_root` (admin) |
| `h2` | local build (`./jdbc-h2/`) | 9092 | `omni` / `omni` |
| `minio` + `minio-fixtures` | MinIO | 9000 | `omni_test` / `omni_test_secret` |

Using the Oracle image means accepting the Oracle license; it is the slowest to
become healthy. H2 has no native adapter and is reached through generic JDBC:
on start, the container copies its driver to `./drivers/h2.jar` for the
host-side JVM sidecar.

Every relational database gets the same schema: `customers`, `products`,
`orders` and `order_items` with PKs/FKs, the `order_summary` view, a
`get_customer_total(customer_id)` function (not on H2) and indexes on
`orders.customer_id` and `order_items.order_id`.

## Smoke tests

```bash
pnpm install                 # once, at the repository root
cd docker/test-dbs
docker compose up -d
docker compose ps            # wait until healthy
pnpm exec tsx --test ./smoke-test.ts
```

The smoke test drives the real PostgreSQL, MySQL, SQL Server and Oracle adapters
through connection, introspection, schemas, tables, columns with PK/FK,
functions, queries (joins, aggregates, CASE, correlated subquery), explain,
indexes, view/function definitions and close. Run one database with
`--test-name-pattern=PostgreSQL` (or `MySQL`, `'SQL Server'`, `'Oracle XE'`).

`docker compose down -v` removes the containers and data; use it to recreate a
database initialized with bad data. Ports 5432, 3306, 3307, 1433, 1521, 9092,
27017 and 9000 must be free.

## Integration tests

From this folder, with the containers up:

```bash
pnpm test:integration          # backend JSON-RPC suite with all databases
pnpm test:integration:mongo    # MongoDB only (native and SQL)
pnpm test:integration:h2       # H2/JDBC only
```

Tests isolate SQLite and the keyring in a temporary folder. The MongoDB SQL path
needs Rust and downloads DuckDB's community Mongo extension. Point at another
MongoDB with `OMNI_SQL_TEST_MONGO_URI` (no credentials in the URI),
`OMNI_SQL_TEST_MONGO_ADMIN_USER` and `OMNI_SQL_TEST_MONGO_ADMIN_PASSWORD`.

H2 needs the JVM sidecar on port 41921 with the test token:

```bash
cd services/jvm-sidecar && ./gradlew jar
OMNI_SQL_AUTH_TOKEN=integration-auth-token java -jar build/libs/omni-sql-sidecar.jar
```

Six cases are skipped by design for JDBC (`query.explain`, native CREATE TABLE,
`metadata.listFunctions`, `metadata.listIndexes` and both `metadata.getDefinition`).

## S3

MinIO fixtures write CSV, Parquet, Delta and Iceberg to bucket `omni-test` and
CSV to `omni-extra`:

```bash
docker compose up --build -d minio minio-fixtures
docker compose logs minio-fixtures   # wait for "S3 fixtures ready"

# from apps/desktop/src-tauri
OMNI_SQL_RUN_S3_INTEGRATION=1 \
AWS_ACCESS_KEY_ID=omni_test AWS_SECRET_ACCESS_KEY=omni_test_secret \
AWS_DEFAULT_REGION=us-east-1 \
cargo test --lib data_engine::tests -- --nocapture
```

If pulling MinIO fails with 401, add `-f docker-compose.yml -f docker-compose.s3-moto.yml`
to use the S3-compatible Moto server with the same buckets and credentials.

In the app, create an **S3** connection with buckets `s3://omni-test` and
`s3://omni-extra`, region `us-east-1`, endpoint `http://127.0.0.1:9000` and the
credentials above. Test URIs: `s3://omni-test/csv/orders.csv`,
`s3://omni-test/parquet/orders.parquet`, `s3://omni-test/delta/orders`,
`s3://omni-test/iceberg/orders/metadata/current.metadata.json` and
`s3://omni-extra/csv/customers.csv`.

## Seed connections into the app

With the backend running:

```bash
pnpm -w run seed:test-connections            # all dialects
pnpm -w run seed:test-connections -- pg mysql
```

Override passwords with `OMNI_SQL_TEST_PG_PASSWORD`, `OMNI_SQL_TEST_MYSQL_PASSWORD`,
`OMNI_SQL_TEST_MSSQL_PASSWORD` and `OMNI_SQL_TEST_ORACLE_PASSWORD`, and the
backend URL with `OMNI_SQL_BACKEND_URL`.
