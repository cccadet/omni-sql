# Database results + a local CSV

Which sales region missed its target? Revenue comes from PostgreSQL; targets
come from a local CSV. Join them locally in omni-sql without uploading the CSV
to the source database. All values in this example are fictional.

1. Connect to a development PostgreSQL database. Run [sales.sql](sales.sql).
   The query uses `VALUES`; it does not create tables or change database data.
2. Click **DuckDB** / **Send to Analyze locally** and import the **Full query result**.
3. The tab switches to **Local DuckDB** and displays a query against the imported
   table. For this `VALUES` example, the captured release names it `local_analysis`.
   Keep the actual table name if your workspace assigns a different one.
4. Click **Import file** and select [targets.csv](targets.csv). It is imported
   completely into a local table named `targets` (check **main** in the sidebar).
5. Run [join.sql](join.sql) in the DuckDB SQL tab, adjusting the two table names
   to those shown by your workspace if necessary.
6. Choose **Export full CSV** to export all three joined rows.

Expected result:

| region | revenue | target | gap | target_pct |
| --- | ---: | ---: | ---: | ---: |
| North | 125000 | 100000 | 25000 | 125.0 |
| West | 112000 | 100000 | 12000 | 112.0 |
| South | 84000 | 100000 | -16000 | 84.0 |

## 60–75 second recording

| Time | Show | Narration |
| --- | --- | --- |
| 0–8s | Final joined result | “Sales are in PostgreSQL. Targets are in a CSV. Which region missed its target?” |
| 8–20s | Execute `sales.sql` on PostgreSQL | “First, query the database. These three rows are fictional demo data.” |
| 20–35s | Send to DuckDB; select full result; show the imported table | “Import the complete query result into local analysis.” |
| 35–48s | Import `targets.csv`; show both datasets | “Add the targets file. No upload to PostgreSQL is needed.” |
| 48–62s | Execute `join.sql`; highlight South | “Join them with SQL. South reached 84 percent of its target.” |
| 62–75s | Export full CSV; repository URL | “Export the local result. omni-sql is open source, with Windows and Linux installers.” |

Use a test connection and hide unrelated connections before recording. The GIF
in the main README is a sequence of real app screenshots of this workflow.
Keep the original PNGs when updating it. For larger data, complete loads remain
subject to resource budgets; a sample cannot establish full-dataset totals.

Regenerate the 24-second screenshot GIF and its poster with
`python scripts/generate_release_visuals.py --local-analysis` (Pillow and Windows
Segoe UI fonts required). The narrated 60–75 second video script above is ready
for recording; the delivered GIF is a screenshot sequence, not a continuous video.
