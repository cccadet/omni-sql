# Local analysis with DuckDB

Import query results and local files into DuckDB, then join them with SQL in Analyze Locally.

## Import coverage, storage, and export

The grid preview limit is separate from analytical ingestion. A full analytical load
reads the source query to completion, subject to local resource budgets; a sample
retains only the selected rows. The local SQL editor uses DuckDB syntax and omits
identifier quotes when they are unnecessary. See the [Rust data engine plan](RUST_DATA_ENGINE_PLAN.md)
and [remaining-work checklist](RUST_DATA_ENGINE_TODO.md) for implementation
status and validation still needed.
The [analytical provenance guide](ANALYTICAL-PROVENANCE.md) explains which
imports are complete, sampled, or truncated and what an export can contain.

Local DuckDB datasets are saved in the application's `local.duckdb` database and
are available after restart. Federated datasets used for a session's joins and
temporary result pages are cleared when the process exits. S3 object queries use
separate DuckDB readers; CSV and Parquet support and optional Delta/Iceberg
support depend on DuckDB extensions, which may need network access on first use.
For DuckLake, configure a catalog on the S3 connection for a bucket or table
prefix. The catalog can use a saved PostgreSQL connection or a SQLite/DuckDB
file; the longest matching prefix wins when a bucket contains mixed data.
S3 query results in the editor are bounded previews. To export every selected
S3 row, import the object into a local DuckDB dataset, then use the analytical
full-result export; exporting the visible grid only writes displayed rows.
The main DuckDB editor offers **Export full CSV** for the last executed query.
For SQL Server analytical imports, the current driver cannot preserve very large
`DECIMAL`/`NUMERIC` values as JavaScript numbers. The stream rejects detected
unsafe values; cast those columns to `VARCHAR` in the source SQL to retain their
exact digits. MySQL and Oracle analytical streams return large numeric values as
text for the same reason. SQL Server and Oracle drivers can also discard
sub-millisecond timestamp precision; analytical streaming rejects those values
when detected. Cast the column to text in the source SQL (`VARCHAR` on SQL
Server, `TO_CHAR(..., 'YYYY-MM-DD HH24:MI:SS.FF6')` on Oracle) to preserve it.
Generic ODBC streams also reject driver-decoded decimal and date/time values
when their precision cannot be established; cast them to text in the source SQL.
The ODBC adapter requires a separately installed 64-bit driver. The legacy
Windows SQL Server ODBC driver on the test host connected but failed even to
fetch `SELECT 1`, so that combination has no fidelity claim.

In Analyze Locally, **Browse all rows** materializes a stable temporary result
and pages it in groups of 1,000. Editing SQL or leaving the workspace releases
the result. Imported dataset metadata records coverage and selection; streamed
sources also record the source-query start and finish times. A full export
contains all rows of the current local query, but cannot restore rows omitted
by an earlier sample or truncated import. Local full exports write a companion
`.omni.json` file with workspace dataset provenance. It omits raw SQL literals.

To compare repeatable local input samples before a join, use DuckDB's native
`USING SAMPLE reservoir(1000 ROWS) REPEATABLE (42)` on each input subquery.
Sampling each side of a join can exclude matching rows. Aggregates over these
sampled inputs describe the sample, not the full source.
