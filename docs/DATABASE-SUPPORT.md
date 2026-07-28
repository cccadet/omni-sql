# Database support

| Database / mechanism | Status | Mechanism and notes |
| --- | --- | --- |
| PostgreSQL | Supported | Native `pg` adapter; `information_schema`/`pg_catalog` introspection, pooled connections, server-side query cursor behavior, and `EXPLAIN (FORMAT JSON)`. |
| MySQL | Supported | Native `mysql2/promise` adapter; MySQL metadata queries, pooled connections, and `EXPLAIN FORMAT=JSON`. |
| MariaDB | Supported | Uses the MySQL wire-compatible `mysql2/promise` adapter. Server/version-specific SQL or metadata differences can limit introspection. |
| SQL Server | Supported | Native `mssql`/Tedious adapter; metadata queries and `SET SHOWPLAN_XML ON` in an isolated transaction for plans. |
| Oracle | Supported | Native `oracledb` thin-mode adapter; Oracle metadata and `EXPLAIN PLAN`. No Oracle Instant Client is required for thin mode. |
| Generic JDBC | Experimental | JVM sidecar loads a user-provided driver JAR and `java.sql.Driver` class, then connects through the supplied JDBC URL. |
| ODBC | Planned | No ODBC adapter is currently provided. |
| MongoDB | Deferred to v2 | No document-database adapter in the current product. |

## Generic JDBC

Configure the JDBC connection with:

- `endpoint`: JDBC URL;
- `options.jarPath`: filesystem path to the driver JAR;
- `options.driverClassName`: class implementing `java.sql.Driver`;
- username and password as normal connection credentials.

The JVM sidecar loads the JAR dynamically and keeps connections in memory. It
uses standard `DatabaseMetaData` for schemas, tables, views, columns, and
best-effort primary-key flags. Drivers without schemas use a `default` bucket.
Queries are capped at 10,000 rows and use driver-dependent fetch/max-row
settings. Values outside JSON primitives are stringified; byte arrays are
Base64 encoded.

Limitations are intentional because JDBC drivers differ:

- `EXPLAIN` is unsupported; JDBC has no portable plan syntax.
- `getDefinition` is unsupported; there is no portable CREATE-text query.
- Functions, indexes, foreign keys, and defaults are not exposed reliably by
  arbitrary drivers.
- Primary-key discovery is best effort and may be unavailable.
- Driver-specific SQL, authentication, TLS, transactions, type conversion,
  and metadata quality remain the responsibility of the selected driver.
- A missing JAR, invalid driver class, rejected URL, credentials error, or
  network error is reported by the sidecar; it is not silently converted into
  native-driver behavior.

Native adapters should be preferred when available because they provide
dialect-specific introspection and explain support.
