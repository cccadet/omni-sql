import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnectionPool, Request } from "mssql";
import { MssqlAdapter } from "./index.ts";
import { runQueryViaPool } from "./introspection.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";

// Sem docker/SQL Server local: smoke só valida construção + recusa de dial.
// Em CI/uso local, setar `MSSQL_TEST_CONNECTION_STRING` (formato `host:port/db`)
// para acionar testes reais.

const MSSQL_CONN = process.env.MSSQL_TEST_CONNECTION_STRING;
const MSSQL_PASSWORD = process.env.MSSQL_TEST_PASSWORD;

const cfg = (endpoint = MSSQL_CONN ?? "127.0.0.1:1/dummy"): ConnectionConfig => ({
  id: "mssql-test",
  label: "SQL Server test",
  dialect: "sqlserver",
  endpoint,
  user: "sa",
});

test("MssqlAdapter: constrói sem disparar conexão", () => {
  const a = new MssqlAdapter(cfg());
  assert.equal(a.id, "mssql-test");
  assert.equal(a.dialect, "sqlserver");
  assert.equal(a.dialectDescriptor().dialect, "sqlserver");
  assert.ok(a.dialectDescriptor().keywords.has("TOP"));
  assert.deepEqual(a.listSchemas(), []);
  assert.deepEqual(a.listTables("dbo"), []);
});

test("MssqlAdapter: factory via construtor produz instância Adapter", () => {
  const a = new MssqlAdapter(cfg());
  assert.equal(a.dialect, "sqlserver");
});

test("test() retorna ok:false quando não consegue conectar", async () => {
  const a = new MssqlAdapter(cfg("127.0.0.1:1/dummy"), "nobody");
  const t = await a.test();
  assert.equal(t.ok, false);
  assert.ok(t.message);
  await a.close();
});

test("cancelRunning cancela Request ativo e não limpa Request mais novo", async () => {
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  let finishFirst!: () => void;
  let rejectSecond!: (error: Error) => void;
  let cancelCalls = 0;
  let requestNumber = 0;

  const firstRequest = {
    arrayRowMode: false,
    input: () => firstRequest,
    query: async () => {
      firstStarted();
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      return { recordset: [], rowsAffected: [] };
    },
    cancel: () => { cancelCalls += 1; },
  } as unknown as Request;
  const secondRequest = {
    arrayRowMode: false,
    input: () => secondRequest,
    query: async () => {
      secondStarted();
      await new Promise<never>((_resolve, reject) => { rejectSecond = reject; });
    },
    cancel: () => {
      cancelCalls += 1;
      rejectSecond(new Error("query cancelled"));
    },
  } as unknown as Request;
  const pool = {
    request: () => requestNumber++ === 0 ? firstRequest : secondRequest,
  } as unknown as ConnectionPool;
  const a = new MssqlAdapter(cfg());
  (a as unknown as { poolPromise: Promise<ConnectionPool> | null }).poolPromise = Promise.resolve(pool);

  const firstRun = a.runQuery("SELECT 1", 10);
  await new Promise<void>((resolve) => { firstStarted = resolve; });
  const secondRun = a.runQuery("SELECT 2", 10);
  await new Promise<void>((resolve) => { secondStarted = resolve; });

  finishFirst();
  await firstRun;
  await a.cancelRunning();
  await assert.rejects(secondRun, /query cancelled/);
  await a.cancelRunning();

  assert.equal(cancelCalls, 1);
});

test("runQueryViaPool caps simple SELECT server-side and preserves ORDER BY", async () => {
  let queryText = "";
  let boundLimit: number | undefined;
  const request = {
    arrayRowMode: false,
    input: (name: string, value: number) => {
      assert.equal(name, "omni_limit");
      boundLimit = value;
      return request;
    },
    query: async (text: string) => {
      queryText = text;
      const recordset = [[1], [2]] as unknown[][] & {
        columns?: Record<string, { index: number; type: unknown }>;
      };
      recordset.columns = { value: { index: 0, type: Number } };
      return { recordset };
    },
  } as unknown as Request;
  const pool = { request: () => request } as unknown as ConnectionPool;

  const result = await runQueryViaPool(pool, "SELECT DISTINCT value\nFROM dbo.items\nORDER BY value", 1);

  assert.equal(queryText, "SELECT DISTINCT TOP (@omni_limit) value\nFROM dbo.items\nORDER BY value");
  assert.equal(boundLimit, 2);
  assert.deepEqual(result.rows, [[1]]);
  assert.equal(result.rowsMoreAvailable, true);
});

test("runQueryViaPool bypasses unsafe SQL without changing binds", async () => {
  const queryTexts: string[] = [];
  const boundNames: string[] = [];
  const request = {
    arrayRowMode: false,
    input: (name: string) => {
      boundNames.push(name);
      return request;
    },
    query: async (text: string) => {
      queryTexts.push(text);
      return { recordset: [] };
    },
  } as unknown as Request;
  const pool = { request: () => request } as unknown as ConnectionPool;

  await runQueryViaPool(pool, "SELECT value FROM dbo.items UNION SELECT value FROM dbo.archive", 1);

  assert.deepEqual(queryTexts, ["SELECT value FROM dbo.items UNION SELECT value FROM dbo.archive"]);
  assert.deepEqual(boundNames, []);
});

if (MSSQL_CONN) {
  test("introspect real + runQuery SELECT 1", async () => {
    const a = new MssqlAdapter(cfg(MSSQL_CONN), MSSQL_PASSWORD);
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
  test("introspect real: SKIPPED (set MSSQL_TEST_CONNECTION_STRING para rodar)", { skip: true }, () => {
    assert.ok(true);
  });
}
