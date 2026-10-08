import test from "node:test";
import assert from "node:assert/strict";
import { mongoSqlToNative } from "./mongo-sql.ts";
import { parseMongoQuery } from "./mongo-adapter.ts";

const convert = (sql: string, database?: string) => JSON.parse(mongoSqlToNative(sql, database)) as Record<string, unknown>;

test("Mongo SQL pushes equality and explicit list membership into native filters", () => {
  const plan = (where: string) => JSON.parse(mongoSqlToNative(`SELECT * FROM base_laudos.padronizacao WHERE ${where}`, undefined, true));
  assert.deepEqual(plan("id_guia = '52712827'").filter, { id_guia: { $eq: "52712827" } });
  assert.deepEqual(plan("'52712827' = id_guia").filter, { id_guia: { $eq: "52712827" } });
  assert.deepEqual(plan("list_contains(id_guia, '52712827')").filter, { id_guia: { $elemMatch: { $eq: "52712827" } } });
  assert.deepEqual(plan("(id_guia = '52712827' OR id_guia = '789') AND status = 'ok'").filter, {
    $and: [{ $or: [{ id_guia: { $eq: "52712827" } }, { id_guia: { $eq: "789" } }] }, { status: { $eq: "ok" } }],
  });
  assert.deepEqual(plan("id_guia = NULL").filter, { $expr: { $and: [{ $ne: [{ $ifNull: ["$id_guia", null] }, null] }, { $ne: [{ $ifNull: [{ $literal: null }, null] }, null] }, { $eq: ["$id_guia", { $literal: null }] }] } });
  assert.throws(() => plan("list_contains(id_guia, other_field)"), /literais/);
});

test("SQL SELECT converts to the native adapter contract with separate database and collection", () => {
  const query = convert("SELECT id_guia, status FROM base_laudos.padronizacao WHERE id_guia = '52712827' ORDER BY status DESC");
  assert.equal(query.database, "base_laudos");
  assert.equal(query.collection, "padronizacao");
  assert.equal(query.operation, "find");
  assert.deepEqual(query.projection, { id_guia: 1, status: 1, _id: 0 });
  assert.deepEqual(query.sort, { status: -1 });
  assert.equal(parseMongoQuery(JSON.stringify(query)).operation, "find");
  assert.equal(convert("SELECT * FROM items", "test").database, "test");
  assert.deepEqual(convert("SELECT _id FROM items", "test").projection, { _id: 1 });
  assert.equal(convert('SELECT * FROM "db"."dot.collection"').collection, "dot.collection");
});

test("SQL aliases and LIMIT generate an aggregate accepted by the native adapter", () => {
  const query = convert("SELECT i.status AS situacao FROM db.items i WHERE i.flag = TRUE ORDER BY situacao LIMIT 5");
  assert.equal(query.operation, "aggregate");
  const pipeline = query.pipeline as Record<string, unknown>[];
  assert.deepEqual(pipeline.at(-1), { $project: { _id: 0, situacao: { $ifNull: ["$status", null] } } });
  assert.deepEqual(pipeline.at(-2), { $limit: 5 });
  assert.deepEqual(pipeline.at(-3), { $sort: { status: 1 } });
  assert.equal(parseMongoQuery(JSON.stringify(query)).operation, "aggregate");
  assert.deepEqual((convert("SELECT * FROM db.items LIMIT 0").pipeline as unknown[]).at(-1), { $match: { $expr: false } });
});

test("GROUP BY supports multiple keys, accumulators, HAVING and ORDER BY output aliases", () => {
  const query = convert("SELECT status, tipo AS categoria, COUNT(*) AS total, SUM(valor) AS soma, AVG(valor) AS media, MIN(valor) AS minimo, MAX(valor) AS maximo FROM db.items WHERE valor >= -2 GROUP BY status, tipo HAVING COUNT(*) > 1 AND SUM(valor) IS NOT NULL ORDER BY total DESC LIMIT 10");
  const pipeline = query.pipeline as Record<string, unknown>[];
  const group = pipeline.find((s) => s.$group)?.$group as Record<string, unknown>;
  assert.deepEqual(group._id, { g0: { $ifNull: ["$status", null] }, g1: { $ifNull: ["$tipo", null] } });
  assert.deepEqual(group.a0, { $sum: 1 });
  assert.deepEqual(group.a1, { $sum: { $ifNull: ["$valor", null] } });
  assert.deepEqual(group.a2, { $avg: { $ifNull: ["$valor", null] } });
  assert.ok(pipeline.some((s) => s.$set));
  const project = pipeline.at(-1)?.$project as Record<string, unknown>;
  assert.equal(project.status, "$_id.g0");
  assert.equal(project.categoria, "$_id.g1");
  assert.equal(project.total, "$a0");
  assert.equal(parseMongoQuery(JSON.stringify(query)).operation, "aggregate");
});

test("SQL null semantics survive comparisons, NOT IN, COUNT(field) and empty global aggregates", () => {
  const negative = convert("SELECT * FROM db.items WHERE x NOT IN (1, NULL)");
  assert.deepEqual(negative.filter, { $expr: false });
  const aggregate = convert("SELECT COUNT(*) AS total, COUNT(valor) AS n, SUM(valor) AS soma FROM db.items WHERE valor <> NULL");
  const pipeline = aggregate.pipeline as Record<string, unknown>[];
  assert.ok(pipeline.some((s) => s.$facet));
  assert.ok(pipeline.some((s) => s.$replaceRoot));
  const query = convert("SELECT * FROM db.items WHERE NOT (x = 1 OR y IS NULL) AND z IN (2, 3)");
  assert.ok(JSON.stringify(query.filter).includes("$ifNull"));
  assert.ok(JSON.stringify(query.filter).includes('"$ne"'));
});

test("unsupported SQL fails instead of silently dropping clauses or guessing", () => {
  for (const sql of [
    "DELETE FROM db.items", "SELECT * FROM db.items; SELECT * FROM db.items", "SELECT * FROM a JOIN b ON a.id=b.id",
    "SELECT * FROM (SELECT * FROM db.items) x", "WITH x AS (SELECT * FROM db.items) SELECT * FROM x",
    "SELECT DISTINCT status FROM db.items", "SELECT * FROM db.items OFFSET 2", "SELECT * FROM db.items FOR UPDATE",
    "SELECT * INTO other FROM db.items", "SELECT ABS(x) FROM db.items", "SELECT COUNT(DISTINCT x) FROM db.items",
    "SELECT status, COUNT(*) FROM db.items", "SELECT * FROM db.items WHERE x IN (SELECT x FROM other)",
    "SELECT * FROM db.items WHERE x LIKE 'a%'", "SELECT * FROM db.items ORDER BY x NULLS FIRST",
    "SELECT * FROM db.items LIMIT -1", "SELECT * FROM db.items WHERE x=9007199254740993", "SELECT * FROM items",
    "SELECT a.x FROM db.items", 'SELECT x AS "$out" FROM db.items', "SELECT x, x FROM db.items",
  ]) assert.throws(() => convert(sql), /SQL → MongoDB/, sql);
});
