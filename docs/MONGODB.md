# MongoDB

A MongoDB connection has two editor modes: **native** (Extended JSON) and
**SQL** (read-only). For a hands-on walkthrough with fictional data, see the
[tutorial](TUTORIAL-MONGODB-SQL.md) (in Portuguese).

## Native mode

Queries are Extended JSON envelopes; database and collection are separate fields:

```json
{
  "database": "shop",
  "collection": "orders",
  "operation": "find",
  "filter": {"order_id": "52712827"}
}
```

`find`, `aggregate` and explicit write operations are supported. Separate
several commands with `;` as in SQL: **Run** executes the selection or the
command under the cursor, **Run all** executes them in order. A `;` inside a
string or comment does not split a command.

Autocomplete suggests operations, databases, collections, fields, operators and
common aggregation stages. Fields come from metadata, which samples up to 100
documents per collection; refresh metadata to reload cached types.

### Results

Switch between **Table** and **Documents**. The document view is read-only and
lets you expand nested objects and arrays with BSON type labels.

The table shows ObjectIds as text, BSON dates as ISO 8601 UTC and numbers
without `$oid`/`$date`/`$numberLong` envelopes, keeping every digit. Filtering
and sorting use the displayed values; hovering a structured cell shows the
original. Editing and CSV export keep the original Extended JSON, and
**Analyze locally** stores structured results as JSON snapshots.

Column types are inferred from the returned documents: lists show their element
type (`VARCHAR[]`), nulls and empty lists do not override a known type, mixed
numeric types become `NUMERIC`, and incompatible types become `JSON`. This
describes the observed values; it does not impose a schema.

## `/mongo`: convert a SELECT to native JSON

In native mode, write SQL with or without a `/mongo` prefix and choose
**Convert SQL to MongoDB** (or **Ctrl+Enter** / **Cmd+Enter**). The SQL is
replaced by native JSON without running it.

```sql
/mongo
SELECT status, COUNT(*) AS total, SUM(amount) AS sum_amount
FROM shop.orders
WHERE order_id IN ('52712827', '52712828')
GROUP BY status
HAVING COUNT(*) > 1
ORDER BY total DESC
LIMIT 20
```

Supported:

- One collection in `FROM db.collection` (without a database, the connection
  URI's database is used).
- `SELECT *`, fields and output aliases.
- `=`, `<>`, `!=`, `<`, `<=`, `>`, `>=`, `AND`, `OR`, `NOT`, parentheses,
  `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`.
- `GROUP BY` one or more fields with `COUNT(*)`, `COUNT(field)`, `SUM`, `AVG`,
  `MIN`, `MAX`; `HAVING` (including unselected aggregates); `ORDER BY` fields or
  aliases; a non-negative integer `LIMIT`.
- A non-recursive CTE with `ORDER BY … LIMIT 1` joined back to the same
  collection with `INNER JOIN` on `AND`-combined equalities of selected keys
  (for "latest row" lookups). Add `_id` to the `ORDER BY` to break ties.

Simple queries become `find`; aliases, aggregates and `LIMIT` use `aggregate`.
The UI row limit still applies. Missing values behave as nulls; `COUNT(field)`
skips them and `SUM` of only nulls is null. Comparisons follow MongoDB's native
types and ordering: there is no type coercion or array expansion, and integers
beyond JavaScript's safe range are rejected.

Not supported: other joins and CTEs, subqueries, scalar functions, window
functions, `DISTINCT`, `OFFSET`, `LIKE`, aggregate modifiers and explicit
`NULLS FIRST/LAST`. The conversion explains why and keeps your SQL.

## SQL mode

SQL mode is read-only and needs no manual conversion. Supported SELECTs run
natively in MongoDB; other queries run in DuckDB. Explain shows the plan of the
engine that was chosen.

Queries on one collection, with an equality or `list_contains` filter on the
collection read and a linear chain of CTEs, combine both engines: MongoDB
filters and fetches the needed fields, and DuckDB receives a typed snapshot to
run `UNNEST`, functions, remaining filters, sorting and aggregation. Lists of
structs and lists of strings keep their types (`item.codes[1]`,
`unnest(item.codes)`); ObjectId becomes text, dates become UTC `TIMESTAMP`,
Int64 keeps its precision, and Decimal128 and binary become text (binary as
Base64).

```sql
WITH expanded AS (
  SELECT event_id, unnest(steps) AS step
  FROM demo.events
  WHERE event_id = 'demo-001'
)
SELECT event_id, step.name, step.duration_ms
FROM expanded
ORDER BY step.duration_ms DESC;
```

In this combined path, equality uses MongoDB's native match (it matches a
scalar or an array element and can use an index), and `list_contains(field, 'x')`
is sent as `$elemMatch`. Only safe predicates are pushed down: residual filters
stay in DuckDB, parts of an `OR` are not extracted, and filters do not move
across `LIMIT`, aggregates or windows. Explain shows the native plan, the number
of documents transferred and the DuckDB plan.

Limits: the preview limit applies to the final result. The filtered source is
capped at 100,000 documents, 16 MiB and 60 seconds of MongoDB execution;
exceeding a cap fails explicitly instead of returning a partial aggregate.

Queries outside the combined path use DuckDB's Mongo extension directly. There,
a field inferred as a list cannot be compared to text with `=`; use
`list_contains(field, 'value')`, which may run as a local filter over many
documents. Check Explain to see whether a filter reached the Mongo scan.

See [example queries](examples/mongodb-exames.sql) for more patterns over
nested arrays.
