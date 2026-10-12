-- Execute cada consulta separadamente, no modo SQL de uma conexão MongoDB.

-- 1. Busca nativa traduzida a partir de SQL.
SELECT event_id, status, duration_ms
FROM omni_sql_demo.events
WHERE event_id = 'demo-001';

-- 2. Agregação executada no MongoDB.
SELECT status, COUNT(*) AS total, AVG(duration_ms) AS avg_duration_ms
FROM omni_sql_demo.events
GROUP BY status
ORDER BY status;

-- 3. Filtro no MongoDB e expansão/ordenação no DuckDB.
WITH expanded AS (
  SELECT event_id, unnest(steps) AS step
  FROM omni_sql_demo.events
  WHERE event_id = 'demo-001'
)
SELECT event_id, step.name AS step_name, step.duration_ms AS duration_ms
FROM expanded
ORDER BY duration_ms DESC;
