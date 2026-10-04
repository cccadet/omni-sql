-- Replace local_analysis with the table name shown after the source import
-- if your workspace already contains a dataset with that name.
SELECT
  s.region,
  s.revenue,
  t.target,
  s.revenue - t.target AS gap,
  ROUND(100.0 * s.revenue / t.target, 1) AS target_pct
FROM local_analysis AS s
JOIN targets AS t USING (region)
ORDER BY gap DESC;
