# Querying CSV and Parquet exports inside a SQL IDE with DuckDB

Someone sends you a CSV export and asks you to investigate it. You need to check duplicates, group records, or compare it with another export. For a one-off analysis, loading it into a database or writing a separate script can take longer than the query itself.

I'm building [omni-sql](https://github.com/cccadet/omni-sql), an open-source SQL IDE with embedded DuckDB. You can import CSV or Parquet and query it with SQL inside the IDE. A spreadsheet someone sends you fits this workflow when exported as CSV.

## Joining a file with a database query result

Sometimes the file only contains part of what you need. You can also import a database query result into local DuckDB and join it with the file, without loading the file into the source database.

The demo uses fictional sales rows from PostgreSQL and a CSV of regional targets. The sales query uses VALUES, so it doesn't create tables or change database data.

1. Run the sales query on PostgreSQL and send the full result to local analysis.
2. Import targets.csv into the local DuckDB workspace.
3. Run the join in the local SQL tab, using the table names shown in your workspace.


![omni-sql demo: importing a PostgreSQL query result and joining it locally with a targets CSV](https://raw.githubusercontent.com/cccadet/omni-sql/main/docs/images/release-visuals/local-analysis-demo.gif)

This GIF is a sequence of app screenshots showing the workflow.

The example names the imported query result local_analysis and the CSV table targets. The join is:

```sql
SELECT
  s.region,
  s.revenue,
  t.target,
  s.revenue - t.target AS gap,
  ROUND(100.0 * s.revenue / t.target, 1) AS target_pct
FROM local_analysis AS s
JOIN targets AS t USING (region)
ORDER BY gap DESC;
```

The result shows South reaching 84% of its target. [The SQL, CSV, instructions, and expected result are in the repository](https://github.com/cccadet/omni-sql/tree/main/docs/demo).

## Trying it with your own export

The app runs locally and doesn't require an account. It is MIT licensed, with installers for Windows x64, Debian/Ubuntu amd64, and macOS 15+ on Apple Silicon and Intel. Node.js and Java runtimes are bundled. The macOS builds use ad-hoc signing and are not notarized; the README explains the first launch.

The project is still early. Full imports have resource limits, and an imported sample only supports conclusions about that sample. [The local analysis guide](https://github.com/cccadet/omni-sql/blob/main/docs/LOCAL-ANALYSIS.md) covers those limits and numeric precision constraints.

[Source code and downloads](https://github.com/cccadet/omni-sql)

How do you investigate files people send you today? If you try omni-sql, I'd like to hear whether you could import and query a file, and what was missing. There's also a [first-run feedback form](https://github.com/cccadet/omni-sql/issues/new?template=first_run.yml) for compatibility and installation reports.
