import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { registerAdapter } from "@omni-sql/adapters-core";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  AddConnectionResult,
  RunQueryResult,
  ExplainQueryResult,
  ListRelationsResult,
  CompletionResult,
  AnalyzeEditabilityResult,
} from "../src/protocol.ts";
import { InMemoryAdapter } from "./in-memory-adapter.ts";

// Isolate the SQLite cache and dev keyring to a tmp dir so tests don't pollute
// $XDG_DATA_HOME. Must run BEFORE importing the backend module (which opens the
// cache and keyring at top).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-backend-"));
process.env.OMNI_SQL_METADATA_DB = path.join(tmpDir, "metadata.db");
process.env.OMNI_SQL_DEV_KEYRING_FILE = path.join(tmpDir, "keyring.json");

const { startServer } = await import("../src/index.ts");

// Sobrescreve o registro de produção (JdbcAdapter) para os smoke tests
// usarem o adaptador in-memory. Deve rodar DEPOIS de importar o backend,
// pois handlers.ts registra JdbcAdapter no load do módulo.
let testAdapter: InMemoryAdapter | undefined;
registerAdapter("jdbc-generic", (config) => {
  testAdapter = new InMemoryAdapter(config);
  return testAdapter;
});

const TEST_PORT = 14378;
const DEFAULT_URL = `http://127.0.0.1:${TEST_PORT}/rpc`;

async function rpc<P>(method: string, params?: P, url = DEFAULT_URL): Promise<JsonRpcResponse> {
  const req: JsonRpcRequest<P> = { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as JsonRpcResponse;
}

test("smoke: add connection → introspect → list relations → run query → completion", async () => {
  const server = startServer(TEST_PORT);
  try {
// 1. add connection. Dialeto `jdbc-generic` resolve para InMemoryAdapter
    // no registry default — assim smoke cobre pipeline JSON-RPC completo sem
    // exigir Postgres local. Para testar PG real, veja adapters-pg.
    const add = await rpc("connection.add", {
      config: {
        id: "smoke",
        label: "Smoke",
        dialect: "jdbc-generic",
        endpoint: "memory://local",
        user: "anon",
      },
    });
    const addRes = add.result as AddConnectionResult;
    assert.equal(addRes.ok, true);
    assert.equal(addRes.connectionId, "smoke");

    // 2. introspect (populates cache)
    const intro = await rpc("metadata.introspect", { connectionId: "smoke" });
    assert.ok(intro.result, "introspect returned no result");
    assert.ok((intro.result as { schemas: { name: string }[] }).schemas.some((s) => s.name === "public"));

    // 3. list relations
    const list = await rpc("metadata.listRelations", { connectionId: "smoke" });
    const listRes = list.result as ListRelationsResult;
    assert.ok(listRes.relations.length >= 1, "no relations returned");
    const usersTable = listRes.relations.find((r) => r.name === "users");
    assert.ok(usersTable, "users table missing");
    assert.equal(usersTable!.columns.length, 3);

    // 4. run query
    const q = await rpc("query.run", {
      connectionId: "smoke",
      sql: "SELECT 1",
      limit: 100,
    });
    const qRes = q.result as RunQueryResult;
    assert.equal(qRes.rows.length, 1);
    assert.equal(qRes.rows[0]?.[0], 1);

    // 5. explain
    const e = await rpc("query.explain", {
      connectionId: "smoke",
      sql: "SELECT 1",
    });
    const eRes = e.result as ExplainQueryResult;
    assert.equal(eRes.format, "text");
    assert.ok(eRes.textual.includes("SELECT 1"));

    // 6. completion: `FROM ` → tables
    const c = await rpc("completion.get", {
      connectionId: "smoke",
      sql: "SELECT 1 FROM ",
      cursor: "SELECT 1 FROM ".length,
    });
    const cRes = c.result as CompletionResult;
    const labels = cRes.suggestions.map((s) => s.label);
    assert.ok(labels.includes("users"));
    assert.ok(labels.includes("orders"));

    // 7. test connection (demo/in-memory always succeeds)
    const test = await rpc("connection.test", {
      config: {
        id: "smoke-test",
        label: "Smoke Test",
        dialect: "jdbc-generic",
        endpoint: "memory://local",
        user: "anon",
      },
    });
    const testRes = test.result as { ok: boolean; latencyMs: number };
    assert.equal(testRes.ok, true);

    // 8. unknown method returns JSON-RPC error (not HTTP 500)
    const bad = await rpc("nonexistent.method");
    assert.ok(bad.error);
    assert.equal(bad.error.code, -32601);
  } finally {
    server.close();
  }
});

test("query.run validates and bounds the untrusted limit at the RPC boundary", async () => {
  const port = 14381;
  const url = `http://127.0.0.1:${port}/rpc`;
  const server = startServer(port);
  try {
    await rpc("connection.add", {
      config: { id: "limit-validation", label: "Limit validation", dialect: "jdbc-generic", endpoint: "memory://local", user: "anon" },
    }, url);
    const invalidLimits: unknown[] = [0, -1, 10_001, 1.5, "100", null];
    for (const limit of invalidLimits) {
      const response = await rpc("query.run", { connectionId: "limit-validation", sql: "SELECT 1", limit }, url);
      assert.equal(response.error?.code, -32000);
      assert.match(response.error?.message ?? "", /limit/);
    }

    await rpc("query.run", { connectionId: "limit-validation", sql: "SELECT 1" }, url);
    assert.equal(testAdapter?.lastRunLimit, 1_000);
    await rpc("query.run", { connectionId: "limit-validation", sql: "SELECT 1", limit: 10_000 }, url);
    assert.equal(testAdapter?.lastRunLimit, 10_000);
  } finally {
    server.close();
  }
});

test("row editability: query.analyzeEditability resolves real PK, row.update validates before touching the adapter", async () => {
  // Porta dedicada (não TEST_PORT): reabrir a mesma porta logo depois que o
  // teste anterior fechou o servidor é uma corrida — no Windows o socket às
  // vezes não solta a tempo do próximo `listen()`, e o `persistence` abaixo
  // já evita isso usando portas próprias (`port1`/`port2`) pelo mesmo motivo.
  const editPort = TEST_PORT + 10;
  const editUrl = `http://127.0.0.1:${editPort}/rpc`;
  const server = startServer(editPort);
  const originalFetch = globalThis.fetch;
  try {
    await rpc("connection.add", {
      config: {
        id: "edit-demo",
        label: "Edit Demo",
        dialect: "jdbc-generic",
        endpoint: "memory://local",
        user: "anon",
      },
    }, editUrl);
    await rpc("metadata.introspect", { connectionId: "edit-demo" }, editUrl);

    // Mocka só o sidecar (Calcite): sem JOIN é "editável", com JOIN não é —
    // suficiente pra exercitar a lógica de enriquecimento com PK, sem
    // depender do sidecar JVM estar de pé neste ambiente de teste. Chamadas
    // ao servidor RPC local (o próprio helper `rpc()` usa `fetch`) passam
    // direto pro fetch original.
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      if (String(input) !== "http://127.0.0.1:41921/query/editability") {
        return originalFetch(input, init);
      }
      const sql = JSON.parse(String(init?.body)).sql as string;
      const editable = /from\s+users\b/i.test(sql) && !/\bjoin\b/i.test(sql);
      return new Response(
        JSON.stringify(
          editable
            ? { editable: true, reason: null, table: { schema: null, name: "users" }, selectStar: true, columns: [] }
            : { editable: false, reason: "mock: não editável", table: null, selectStar: false, columns: [] },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    // Tabela não qualificada (schema: null) resolve contra o metadata-cache
    // e traz schema/PK reais.
    const analyzed = await rpc(
      "query.analyzeEditability",
      { connectionId: "edit-demo", sql: "select * from users" },
      editUrl,
    );
    const analyzedRes = analyzed.result as AnalyzeEditabilityResult;
    assert.equal(analyzedRes.editable, true);
    assert.deepEqual(analyzedRes.pkColumns, ["id"]);
    assert.equal(analyzedRes.table?.schema, "public");
    assert.equal(analyzedRes.table?.name, "users");

    // JOIN: o sidecar já recusa — sem tabela nem PK no resultado.
    const joinAnalyzed = await rpc(
      "query.analyzeEditability",
      {
        connectionId: "edit-demo",
        sql: "select * from users u join orders o on o.user_id = u.id",
      },
      editUrl,
    );
    const joinRes = joinAnalyzed.result as AnalyzeEditabilityResult;
    assert.equal(joinRes.editable, false);
    assert.deepEqual(joinRes.pkColumns, []);

    // row.update nunca confia no `where` do cliente: se não cobrir
    // exatamente a PK real (id), rejeita antes de chegar no adapter.
    const badWhere = await rpc(
      "row.update",
      {
        connectionId: "edit-demo",
        table: { schema: "public", name: "users" },
        set: { name: "novo nome" },
        where: { name: "old" },
      },
      editUrl,
    );
    assert.ok(badWhere.error);
    assert.match(badWhere.error!.message, /chave primária/);

    // Coluna desconhecida em `set` — também rejeitada antes do adapter.
    const badColumn = await rpc(
      "row.update",
      {
        connectionId: "edit-demo",
        table: { schema: "public", name: "users" },
        set: { not_a_real_column: "x" },
        where: { id: 1 },
      },
      editUrl,
    );
    assert.ok(badColumn.error);
    assert.match(badColumn.error!.message, /coluna desconhecida/);

    // Request válido chega até o adapter — o InMemoryAdapter não suporta
    // escrita (dados sintéticos, sem storage real), então falha ALI, não na
    // validação: confirma que a validação não está mascarando o caminho feliz.
    const valid = await rpc(
      "row.update",
      {
        connectionId: "edit-demo",
        table: { schema: "public", name: "users" },
        set: { name: "novo nome" },
        where: { id: 1 },
      },
      editUrl,
    );
    assert.ok(valid.error);
    assert.match(valid.error!.message, /não suportada/);
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
  }
});

test("persistence: connections survive server restart", async () => {
  const port1 = TEST_PORT + 1;
  const port2 = TEST_PORT + 2;
  const url1 = `http://127.0.0.1:${port1}/rpc`;
  const url2 = `http://127.0.0.1:${port2}/rpc`;
  const server1 = startServer(port1);
  try {
    const add = await rpc(
      "connection.add",
      {
        config: {
          id: "persisted",
          label: "Persisted",
          dialect: "jdbc-generic",
          endpoint: "memory://local",
          user: "anon",
        },
      },
      url1,
    );
    assert.equal((add.result as AddConnectionResult).ok, true);
  } finally {
    server1.close();
  }

  // Start a new server on the same DB path. It should restore the connection.
  const server2 = startServer(port2);
  try {
    const list = await rpc("connection.list", {}, url2);
    const listRes = list.result as { configs: { id: string }[] };
    assert.ok(listRes.configs.some((c) => c.id === "persisted"), "persisted connection missing");
  } finally {
    server2.close();
  }
});
