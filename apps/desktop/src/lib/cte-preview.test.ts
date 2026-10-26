// @vitest-environment node
import { test, assert } from "vitest";
import { buildCtePreview, findCteClause } from "./cte-preview";

const at = (sql: string, marker: string) => sql.indexOf(marker);

test("buildCtePreview: keeps preceding CTEs and drops the outer query", () => {
  const sql = "WITH a AS (SELECT 1 AS x), b AS (SELECT x FROM a WHERE x > 0)\nSELECT * FROM b JOIN";
  const preview = buildCtePreview(sql, at(sql, "x FROM a"), "postgres");
  assert.deepEqual(preview, {
    ok: true,
    cteName: "b",
    sql: "WITH a AS (SELECT 1 AS x), b AS (SELECT x FROM a WHERE x > 0)\nSELECT * FROM b",
  });
  const first = buildCtePreview(sql, at(sql, "a AS"), "postgres");
  assert.equal(first.ok && first.sql, "WITH a AS (SELECT 1 AS x)\nSELECT * FROM a");
});

test("buildCtePreview: preserves RECURSIVE, column lists and MATERIALIZED", () => {
  const sql = "WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM n WHERE v < 5), m AS NOT MATERIALIZED (SELECT v FROM n) SELECT 1";
  const preview = buildCtePreview(sql, at(sql, "m AS"), "postgres");
  assert.equal(preview.ok && preview.sql, "WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM n WHERE v < 5), m AS NOT MATERIALIZED (SELECT v FROM n)\nSELECT * FROM m");
});

test("buildCtePreview: ignores parentheses and keywords inside strings, comments and quoted names", () => {
  const sql = `WITH "odd )name" AS (SELECT ')' AS p /* ) DELETE */ -- )\n FROM t), [b] AS (SELECT 'update' FROM "odd )name") SELECT`;
  const clause = findCteClause(sql, "postgres");
  assert.deepEqual(clause?.ctes.map((cte) => [cte.name, cte.dataModifying]), [['"odd )name"', false], ["[b]", false]]);
  const preview = buildCtePreview(sql, at(sql, "[b]"), "sqlserver");
  assert.equal(preview.ok && preview.sql.endsWith("\nSELECT * FROM [b]"), true);
});

test("buildCtePreview: finds the WITH clause after a statement prefix and skips non-CTE WITH", () => {
  const sql = "CREATE VIEW v AS WITH a AS (SELECT * FROM t WITH (NOLOCK)) SELECT * FROM a";
  const preview = buildCtePreview(sql, at(sql, "a AS"), "sqlserver");
  assert.equal(preview.ok && preview.sql, "WITH a AS (SELECT * FROM t WITH (NOLOCK))\nSELECT * FROM a");
  assert.equal(findCteClause("SELECT CAST(x AS TIMESTAMP) FROM t GROUP BY x WITH ROLLUP", "mysql"), null);
});

test("buildCtePreview: refuses data-modifying CTEs that would run with the preview", () => {
  const sql = "WITH gone AS (DELETE FROM t RETURNING id), kept AS (SELECT 1) SELECT * FROM kept";
  assert.deepEqual(buildCtePreview(sql, at(sql, "kept AS"), "postgres"), { ok: false, reason: "data-modifying", cteName: "gone" });
  const locking = "WITH a AS (SELECT * FROM t FOR NO KEY UPDATE) SELECT 1";
  assert.equal(buildCtePreview(locking, at(locking, "a AS"), "postgres").ok, true);
});

test("buildCtePreview: reports a cursor outside any CTE, an unclosed body and SEARCH/CYCLE", () => {
  const sql = "WITH a AS (SELECT 1) SELECT * FROM a";
  assert.deepEqual(buildCtePreview(sql, at(sql, "* FROM a"), "postgres"), { ok: false, reason: "no-cte" });
  assert.deepEqual(buildCtePreview("SELECT 1", 3, "postgres"), { ok: false, reason: "no-cte" });
  const open = "WITH a AS (SELECT 1), b AS (SELECT * FROM a WHERE (x";
  assert.deepEqual(buildCtePreview(open, open.length, "postgres"), { ok: false, reason: "incomplete" });
  assert.equal(buildCtePreview(open, at(open, "a AS"), "postgres").ok, true);
  const search = "WITH RECURSIVE t(id) AS (SELECT 1) SEARCH DEPTH FIRST BY id SET ord SELECT * FROM t";
  assert.deepEqual(buildCtePreview(search, at(search, "t(id)"), "postgres"), { ok: false, reason: "unsupported" });
});
