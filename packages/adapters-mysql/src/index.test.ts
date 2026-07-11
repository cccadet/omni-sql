import { test } from "node:test";
import assert from "node:assert/strict";
import { MysqlAdapter } from "./index.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";

// Sem docker/MySQL local: smoke só valida construção + recusa de dial.
// Em CI/uso local, setar `MYSQL_TEST_CONNECTION_STRING` para acionar testes reais.

const MYSQL_CONN = process.env.MYSQL_TEST_CONNECTION_STRING;

const cfg = (endpoint = MYSQL_CONN ?? "127.0.0.1:1/dummy"): ConnectionConfig => ({
  id: "mysql-test",
  label: "MySQL test",
  dialect: "mysql",
  endpoint,
  user: "nobody",
});

test("MysqlAdapter: constrói sem disparar conexão", () => {
  const a = new MysqlAdapter(cfg());
  assert.equal(a.id, "mysql-test");
  assert.equal(a.dialect, "mysql");
  assert.equal(a.dialectDescriptor().dialect, "mysql");
  assert.ok(a.dialectDescriptor().keywords.has("STRAIGHT_JOIN"));
  assert.deepEqual(a.listSchemas(), []);
  assert.deepEqual(a.listTables("app"), []);
});

test("MysqlAdapter: factory via construtor produz instância Adapter", () => {
  const a = new MysqlAdapter(cfg());
  assert.equal(a.dialect, "mysql");
});

test("MysqlAdapter: dialecto mariadb usa descritor mariadb", () => {
  const a = new MysqlAdapter({ ...cfg(), dialect: "mariadb" });
  assert.equal(a.dialect, "mariadb");
  assert.equal(a.dialectDescriptor().dialect, "mariadb");
});

test("test() retorna ok:false quando não consegue conectar", async () => {
  const a = new MysqlAdapter(cfg("127.0.0.1:1/dummy"));
  const t = await a.test();
  assert.equal(t.ok, false);
  assert.ok(t.message);
  await a.close();
});

if (MYSQL_CONN) {
  test("introspect real + runQuery SELECT 1", async () => {
    const a = new MysqlAdapter(cfg(MYSQL_CONN));
    try {
      await a.connect();
      const db = await a.introspect();
      assert.ok(db.schemas.length >= 1, "esperava ao menos 1 schema");

      const r = await a.runQuery("SELECT 1 AS v", 100);
      assert.equal(r.columns.length, 1);
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0]?.[0], 1);
    } finally {
      await a.close();
    }
  });
} else {
  test("introspect real: SKIPPED (set MYSQL_TEST_CONNECTION_STRING para rodar)", { skip: true }, () => {
    assert.ok(true);
  });
}
