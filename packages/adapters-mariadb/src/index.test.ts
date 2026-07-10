import { test } from "node:test";
import assert from "node:assert/strict";
import { MariadbAdapter, mariadbAdapterFactory } from "./index.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";

// Sem docker/MariaDB local: smoke só valida construção + recusa de dial.
// Em CI/uso local, setar `MARIADB_TEST_CONNECTION_STRING` para acionar testes reais.

const MARIADB_CONN = process.env.MARIADB_TEST_CONNECTION_STRING;

const cfg = (endpoint = MARIADB_CONN ?? "127.0.0.1:1/dummy"): ConnectionConfig => ({
  id: "mariadb-test",
  label: "MariaDB test",
  dialect: "mariadb",
  endpoint,
  user: "nobody",
});

test("MariadbAdapter: constrói sem disparar conexão", () => {
  const a = new MariadbAdapter(cfg());
  assert.equal(a.id, "mariadb-test");
  assert.equal(a.dialect, "mariadb");
  assert.equal(a.dialectDescriptor().dialect, "mariadb");
  assert.deepEqual(a.listSchemas(), []);
  assert.deepEqual(a.listTables("app"), []);
});

test("mariadbAdapterFactory: produz instância Adapter", () => {
  const a = mariadbAdapterFactory(cfg());
  assert.equal(a.dialect, "mariadb");
});

test("test() retorna ok:false quando não consegue conectar", async () => {
  const a = new MariadbAdapter(cfg("127.0.0.1:1/dummy"));
  const t = await a.test();
  assert.equal(t.ok, false);
  assert.ok(t.message);
  await a.close();
});

if (MARIADB_CONN) {
  test("introspect real + runQuery SELECT 1", async () => {
    const a = new MariadbAdapter(cfg(MARIADB_CONN));
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
  test("introspect real: SKIPPED (set MARIADB_TEST_CONNECTION_STRING para rodar)", { skip: true }, () => {
    assert.ok(true);
  });
}
