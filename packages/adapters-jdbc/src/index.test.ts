import { test } from "node:test";
import assert from "node:assert/strict";
import { JdbcAdapter } from "./index.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";

const cfg = (options?: ConnectionConfig["options"]): ConnectionConfig => ({
  id: "jdbc-test",
  label: "JDBC test",
  dialect: "jdbc-generic",
  endpoint: "jdbc:example://localhost:1234/db",
  user: "nobody",
  options: { jarPath: "/tmp/driver.jar", driverClassName: "com.example.Driver", ...options },
});

function mockFetch(handler: (url: string, body: Record<string, unknown>) => Record<string, unknown>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const responseBody = handler(String(input), body);
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("JdbcAdapter: exige jarPath e driverClassName em options", () => {
  assert.throws(() => new JdbcAdapter(cfg({ jarPath: "" })), /jarPath/);
  assert.throws(() => new JdbcAdapter({ ...cfg(), options: { driverClassName: "x" } }), /jarPath/);
  assert.throws(() => new JdbcAdapter({ ...cfg(), options: { jarPath: "x" } }), /driverClassName/);
});

test("JdbcAdapter: constrói sem disparar conexão", () => {
  const a = new JdbcAdapter(cfg());
  assert.equal(a.id, "jdbc-test");
  assert.equal(a.dialect, "jdbc-generic");
  assert.deepEqual(a.listSchemas(), []);
});

test("JdbcAdapter: connect() envia jarPath/driverClassName/jdbcUrl pro sidecar", async () => {
  let calledUrl = "";
  let calledBody: Record<string, unknown> = {};
  const restore = mockFetch((url, body) => {
    calledUrl = url;
    calledBody = body;
    return { ok: true };
  });
  try {
    const a = new JdbcAdapter(cfg(), "secret");
    await a.connect();
    assert.equal(calledUrl, "http://127.0.0.1:41921/jdbc/connect");
    assert.equal(calledBody.connectionId, "jdbc-test");
    assert.equal(calledBody.jarPath, "/tmp/driver.jar");
    assert.equal(calledBody.driverClassName, "com.example.Driver");
    assert.equal(calledBody.jdbcUrl, "jdbc:example://localhost:1234/db");
    assert.equal(calledBody.password, "secret");
  } finally {
    restore();
  }
});

test("JdbcAdapter: runQuery mapeia a resposta do sidecar pro shape de QueryResult", async () => {
  const restore = mockFetch((url) => {
    assert.equal(url, "http://127.0.0.1:41921/jdbc/query");
    return {
      ok: true,
      columns: [{ name: "id", dataType: "INTEGER", nullable: false }],
      rows: [[1], [2]],
      rowsAffected: null,
      rowsMoreAvailable: false,
      elapsedMs: 5,
    };
  });
  try {
    const a = new JdbcAdapter(cfg());
    const result = await a.runQuery("select id from t", 100);
    assert.deepEqual(result.columns, [{ name: "id", dataType: "INTEGER", nullable: false }]);
    assert.deepEqual(result.rows, [[1], [2]]);
    assert.equal(result.rowsMoreAvailable, false);
    assert.equal(result.elapsedMs, 5);
  } finally {
    restore();
  }
});

test("JdbcAdapter: erro do sidecar (ok:false) vira Error com causeTag/message", async () => {
  const restore = mockFetch(() => ({
    ok: false,
    causeTag: "driver-missing",
    message: "could not load driver class",
  }));
  try {
    const a = new JdbcAdapter(cfg());
    await assert.rejects(a.connect(), /driver-missing.*could not load driver class/);
  } finally {
    restore();
  }
});

test("JdbcAdapter: test() fecha a conexão depois de testar", async () => {
  const calls: string[] = [];
  const restore = mockFetch((url) => {
    calls.push(url);
    return { ok: true };
  });
  try {
    const a = new JdbcAdapter(cfg());
    const result = await a.test();
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
      "http://127.0.0.1:41921/jdbc/connect",
      "http://127.0.0.1:41921/jdbc/close",
    ]);
  } finally {
    restore();
  }
});

test("JdbcAdapter: explain/getDefinition/updateRow não são suportados", async () => {
  const a = new JdbcAdapter(cfg());
  await assert.rejects(a.explain("select 1"), /EXPLAIN não é suportado/);
  await assert.rejects(a.getDefinition("view", "s", "v"), /getDefinition não é suportado/);
  await assert.rejects(a.updateRow({ schema: null, table: "t", set: {}, where: {} }), /edição de célula não é suportada/);
});
