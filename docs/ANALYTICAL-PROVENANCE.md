# Analytical data and provenance

The result grid is a bounded preview. Its row limit does not limit a **Full query
result** analytical import. A first-N or reservoir import retains a sample;
subsequent joins and exports can use only those retained rows.

| Entry point | Stored coverage | Source timing and origin |
| --- | --- | --- |
| Displayed grid | `truncated` when more rows were available; otherwise `complete` for that executed result | Connection ID and SQL when supplied; the original database execution interval is unavailable. |
| Relational stream | `complete` only after the source sends its completion frame; first-N and reservoir are `sampled` | Connection ID, SQL, and the individual stream start/finish times survive a local database restart. Different imported tables may reflect different source snapshots. |
| Local CSV, JSON, Parquet | Full import is `complete` for the file as read; first-N and reservoir are `sampled` | Original file path survives restart. The file may already be an extract of another source. |
| S3 CSV, Parquet, Delta, Iceberg, DuckLake | Full import is `complete` for the registered source scan; first-N and reservoir are `sampled` | Original S3 URI survives restart. Direct S3 editor queries are bounded previews until imported. |
| Local join and export | Query output contains all rows available in its input datasets | A full export never restores rows excluded by a sample or truncated grid import. A companion `<result>.omni.json` records workspace datasets' coverage and origins; it does not claim that every listed dataset appears in the SQL. Raw SQL is omitted so query literals are not copied to disk. |

The Node analytical stream sends newline-delimited JSON batches followed by a
completion frame. Missing completion, malformed or oversized frames, and source
disconnects fail the import without publishing a partial dataset. Exact decimals
and integers beyond JavaScript's safe range travel as decimal strings; binary
values travel as byte arrays or Base64, depending on the adapter. Dates and times
travel as text when the adapter can preserve their precision. When a driver has
already rounded a decimal or timestamp, the adapter rejects the stream and asks
for an explicit text cast in the source SQL. Nested DuckDB values in previews are
JSON; decimal members remain strings.

Local DuckDB datasets and their metadata are durable. Federated datasets,
stable result pages, and staging files are temporary. Renaming a durable dataset
changes its SQL relation name; dropping it removes both its table and metadata.
