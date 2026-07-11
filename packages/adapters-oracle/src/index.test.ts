import { test } from "node:test";
import assert from "node:assert/strict";
import { OracleAdapter } from "./index.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";

// Sem instância Oracle local: smoke só valida construção + recusa de dial.
// Em CI/uso local, setar `ORACLE_TEST_CONNECTION_STRING` (+ `ORACLE_TEST_USER`
// / `ORACLE_TEST_PASSWORD`) para acionar testes reais.

const ORACLE_CONN = process.env.ORACLE_TEST_CONNECTION_STRING;
const ORACLE_USER = process.env.ORACLE_TEST_USER ?? "nobody";
const ORACLE_PASSWORD = process.env.ORACLE_TEST_PASSWORD;

const cfg = (endpoint = ORACLE_CONN ?? "127.0.0.1:1/dummy"): ConnectionConfig => ({
  id: "oracle-test",
  label: "Oracle test",
  dialect: "oracle",
  endpoint,
  user: ORACLE_USER,
});

test("OracleAdapter: constrói sem disparar conexão", () => {
  const a = new OracleAdapter(cfg());
  assert.equal(a.id, "oracle-test");
  assert.equal(a.dialect, "oracle");
  assert.equal(a.dialectDescriptor().dialect, "oracle");
  assert.deepEqual(a.listSchemas(), []);
  assert.deepEqual(a.listTables("BIDW"), []);
});

test("OracleAdapter: factory via construtor produz instância Adapter", () => {
  const a = new OracleAdapter(cfg());
  assert.equal(a.dialect, "oracle");
});

test("test() retorna ok:false quando não consegue conectar", async () => {
  const a = new OracleAdapter(cfg("127.0.0.1:1/dummy"), "nobody");
  const t = await a.test();
  assert.equal(t.ok, false);
  assert.ok(t.message);
  await a.close();
});

if (ORACLE_CONN) {
  test("introspect real + runQuery SELECT 1 FROM DUAL", async () => {
    const a = new OracleAdapter(cfg(ORACLE_CONN), ORACLE_PASSWORD);
    try {
      await a.connect();
      const db = await a.introspect();
      assert.ok(db.schemas.length >= 1, "esperava ao menos 1 schema");

      const r = await a.runQuery("SELECT 1 AS v FROM DUAL", 100);
      assert.equal(r.columns.length, 1);
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0]?.[0], 1);
    } finally {
      await a.close();
    }
  });
} else {
  test("introspect real: SKIPPED (set ORACLE_TEST_CONNECTION_STRING para rodar)", { skip: true }, () => {
    assert.ok(true);
  });
}
