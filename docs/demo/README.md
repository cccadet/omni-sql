# Demo: database results + a local CSV

Which sales region missed its target? Revenue comes from PostgreSQL; targets
come from a local CSV. Join them locally in omni-sql without uploading the CSV
to the database. All values are fictional.

1. Connect to a development PostgreSQL database and run [sales.sql](sales.sql).
   It uses `VALUES`, so it creates no tables and changes no data.
2. Choose **Analyze locally** and import the **Full query result**. A new
   **Local DuckDB** tab opens with a query on the imported table (named
   `local_analysis` in the captured release; keep whatever name your workspace
   assigns).
3. Choose **Import file** and select [targets.csv](targets.csv). It becomes a
   local table named `targets`.
4. Run [join.sql](join.sql), adjusting the two table names if needed.
5. Choose **Export full CSV** to export the joined rows.

Expected result:

| region | revenue | target | gap | target_pct |
| --- | ---: | ---: | ---: | ---: |
| North | 125000 | 100000 | 25000 | 125.0 |
| West | 112000 | 100000 | 12000 | 112.0 |
| South | 84000 | 100000 | -16000 | 84.0 |

## Regenerating the media

The README GIF and its poster are a sequence of real app screenshots kept in
`docs/images/release-visuals/`. Regenerate them with
`python scripts/generate_release_visuals.py --local-analysis` (needs Pillow and
the Windows Segoe UI fonts). Use fictional data and a test connection, hide
unrelated connections, and keep the source PNGs. If you change this demo, keep
the website's copy of the result table aligned (see [website](../../website/README.md)).
