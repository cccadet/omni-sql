import test from "node:test";
import assert from "node:assert/strict";
import { BSON } from "mongodb";
import { mongoSqlSourcePlan } from "./mongo-sql-source.ts";
import { mongoSqlNeedsSchemaSample, mongoSqlSnapshot } from "./mongo-sql-snapshot.ts";

export const examSql = `WITH itens AS (
  SELECT _id, data_evento, unnest(exames) AS exame
  FROM base_laudos.padronizacao
  WHERE list_contains(id_guia, '52712827')
)
SELECT _id, data_evento, exame.codigos[1] AS codigo,
  exame.nome_padronizado AS descricao FROM itens`;

test("prefilters the base scan while keeping the CTE and one-based code access in DuckDB", () => {
  const plan = mongoSqlSourcePlan(examSql)!;
  assert.ok(plan);
  assert.deepEqual(JSON.parse(plan.query), { database: "base_laudos", collection: "padronizacao", operation: "find",
    filter: { id_guia: { $elemMatch: { $eq: "52712827" } } }, projection: { _id: 1, data_evento: 1, exames: 1 } });
  assert.match(plan.sql, /UNNEST\(exames\)/);
  assert.match(plan.sql, /codigos\[1\]/);
  assert.match(plan.sql, /__omni_mongo_source/);
  assert.doesNotMatch(plan.sql, /LIST_CONTAINS|base_laudos/);
  const equality = mongoSqlSourcePlan(examSql.replace("list_contains(id_guia, '52712827')", "id_guia = '52712827'"))!;
  assert.deepEqual(JSON.parse(equality.query).filter, { id_guia: { $eq: "52712827" } });
  assert.doesNotMatch(equality.sql, /id_guia/);
});

test("keeps residual conditions and final limits; never splits an unsafe OR or another scan", () => {
  const residual = mongoSqlSourcePlan(examSql.replace("list_contains(id_guia, '52712827')", "id_guia = '52712827' AND length(etapa) > 3") + " LIMIT 1")!;
  assert.match(residual.sql, /LENGTH\(etapa\) > 3/);
  assert.match(residual.sql, /LIMIT 1/);
  assert.equal(JSON.parse(residual.query).projection.etapa, 1);
  assert.equal(JSON.parse(residual.query).limit, undefined);
  assert.equal(mongoSqlSourcePlan(examSql.replace("list_contains(id_guia, '52712827')", "id_guia = '52712827' OR length(etapa) > 3")), null);
  assert.equal(mongoSqlSourcePlan("WITH x AS (SELECT * FROM db.items WHERE id = 'a' LIMIT 1) SELECT * FROM db.items JOIN x USING (id)"), null);
  assert.equal(mongoSqlSourcePlan("SELECT unnest(exames) FROM db.items WHERE id = (SELECT id FROM db.other LIMIT 1)"), null);
  assert.equal(mongoSqlSourcePlan("WITH RECURSIVE x AS (SELECT * FROM db.items) SELECT * FROM x"), null);
  assert.equal(mongoSqlSourcePlan("SELECT unnest(exames) FROM db.items"), null);
  assert.equal(mongoSqlSourcePlan("SELECT upper(etapa) AS status FROM db.items WHERE status = 'OK'"), null);
  assert.equal(mongoSqlSourcePlan("SELECT unnest(exames) AS exame FROM db.items WHERE id_guia = 'a' AND exame.nome_padronizado = 'glicose'"), null);
  assert.equal(mongoSqlSourcePlan("SELECT unnest(exames) FROM db.items USING SAMPLE 10 ROWS WHERE id_guia = 'a'"), null);
});

test("handles aliases, multiple linear CTEs and fully supported OR filters", () => {
  const plan = mongoSqlSourcePlan(`WITH itens AS (
    SELECT p._id, unnest(p.exames) AS exame FROM padronizacao p WHERE p.id_guia = 'a' OR p.id_guia = 'b'
  ), codigos AS (SELECT _id, unnest(exame.codigos) AS codigo FROM itens)
  SELECT * FROM codigos ORDER BY codigo LIMIT 5`, "base_laudos")!;
  assert.ok(plan);
  assert.deepEqual(JSON.parse(plan.query).filter, { $or: [{ id_guia: { $eq: "a" } }, { id_guia: { $eq: "b" } }] });
  assert.match(plan.sql, /AS p/);
  assert.match(plan.sql, /ORDER BY codigo LIMIT 5/);
});

test("preserves nested arrays, UTC dates and exact BSON integers in the DuckDB transformation schema", () => {
  const doc = { _id: new BSON.ObjectId("0123456789abcdef01234567"), data_evento: new Date("2026-10-08T12:34:56.123Z"),
    inteiro: BSON.Long.fromString("9223372036854775807"), decimal: BSON.Decimal128.fromString("1234567890.123456789"),
    exames: [{ codigos: ["40302040", "extra"], nome_padronizado: "glicose" }, { codigos: [], nome_padronizado: "vazio" }] };
  const snapshot = mongoSqlSnapshot([doc], [], []);
  assert.deepEqual(snapshot.structure, [{ _id: "VARCHAR", data_evento: "TIMESTAMP", inteiro: "BIGINT", decimal: "VARCHAR",
    exames: [{ codigos: ["VARCHAR"], nome_padronizado: "VARCHAR" }] }]);
  assert.deepEqual(snapshot.documents, [{ ...doc, _id: "0123456789abcdef01234567", data_evento: "2026-10-08T12:34:56.123Z",
    inteiro: "9223372036854775807", decimal: "1234567890.123456789" }]);
  const empty = mongoSqlSnapshot([], [doc], ["_id", "exames"]);
  assert.deepEqual(empty.documents, []);
  assert.equal(empty.rowCount, 0);
  assert.deepEqual(empty.structure, snapshot.structure);
  const emptyLists = [{ exames: [] }, { exames: [{ codigos: [], nome_padronizado: "sem codigo" }] }];
  assert.equal(mongoSqlNeedsSchemaSample(emptyLists, ["exames"]), true);
  assert.deepEqual(mongoSqlSnapshot(emptyLists, [doc], ["exames"]).structure, [{
    exames: [{ codigos: ["VARCHAR"], nome_padronizado: "VARCHAR" }],
  }]);
});
