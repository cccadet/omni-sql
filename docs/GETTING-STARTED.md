# Getting started

This page takes you from a fresh install to your first query. Install omni-sql
first: see [Installation](INSTALL.md).

## Query a file

You do not need a database to start.

1. Choose **Import file** and pick a CSV, JSON or Parquet file. For CSV, check
   the preview and the delimiter, then confirm.
2. The file becomes a table in the **Local DuckDB** workspace, listed in the
   sidebar.
3. In the **Local DuckDB** SQL tab, write a query and press **Ctrl+Enter**
   (**Cmd+Enter** on macOS):

   ```sql
   SELECT region, count(*) AS orders, sum(total) AS revenue
   FROM orders
   GROUP BY region
   ORDER BY revenue DESC;
   ```

Imported tables persist across restarts. See [Local analysis](LOCAL-ANALYSIS.md)
for samples, exports and S3.

## Connect to a database

1. Open the connection switcher in the header (**Ctrl+Alt+O**) and choose
   **New connection**.
2. Pick the database type and fill in host, port, database, user and password.
   Optionally choose a folder, an environment, SSL settings and which schemas
   to load.
3. Choose **Test connection**, then save and connect.

The sidebar now lists the connection's schemas, tables, views and functions.
Double-click a table to open a `SELECT`, or open a new SQL tab and start typing:
completion knows your tables and columns. Connection options are covered in
[Connections](CONNECTIONS.md), and per-database notes in
[Database support](DATABASE-SUPPORT.md).

## Run and inspect queries

- **Ctrl+Enter** runs the selection, or the statement under the cursor.
  **Ctrl+Shift+Enter** runs every statement in the tab.
- Results appear below the editor. Filter, sort, page and export them, and
  raise the **Row limit** in the toolbar when you need more rows.
- **Explain SQL** shows the execution plan where the database supports it.
- Statements that can remove data (`DROP`, `TRUNCATE`, `DELETE` without
  `WHERE`, …) ask for confirmation first.

More in [SQL editor](SQL-EDITOR.md).

## Join a query result with a file

Choose **Analyze locally** after running a query to copy its result, in full or
as a sample, into DuckDB. A new **Local DuckDB** tab opens, where you can join it
with imported files. The [database + CSV tutorial](demo/README.md) walks through
a complete example.

## Next steps

- Connect an AI assistant with the [MCP integration](MCP.md).
- Query MongoDB natively or with SQL: [MongoDB](MONGODB.md).
- Learn the [keyboard shortcuts](SHORTCUTS.md).
