-- Run on PostgreSQL. Fictional data; no tables are created or changed.
SELECT *
FROM (VALUES
  ('North', 125000),
  ('South',  84000),
  ('West',  112000)
) AS sales(region, revenue)
ORDER BY region;
