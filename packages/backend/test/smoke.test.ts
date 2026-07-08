import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  AddConnectionResult,
  RunQueryResult,
  ListRelationsResult,
  CompletionResult,
} from "../src/protocol.ts";

// Isolate the SQLite cache to a tmp dir so tests don't pollute $XDG_DATA_HOME.
// Must run BEFORE importing the backend module (which opens the cache at top).
process.env.OMNI_SQL_METADATA_DB = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "omni-backend-")),
  "metadata.db",
);

const { startServer } = await import("../src/index.ts");

const TEST_PORT = 14378;
const URL = `http://127.0.0.1:${TEST_PORT}/rpc`;

async function rpc<P>(method: string, params?: P): Promise<JsonRpcResponse> {
  const req: JsonRpcRequest<P> = { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) };
  const res = await fetch(URL, {
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

    // 5. completion: `FROM ` → tables
    const c = await rpc("completion.get", {
      connectionId: "smoke",
      sql: "SELECT 1 FROM ",
      cursor: "SELECT 1 FROM ".length,
    });
    const cRes = c.result as CompletionResult;
    const labels = cRes.suggestions.map((s) => s.label);
    assert.ok(labels.includes("users"));
    assert.ok(labels.includes("orders"));

    // 6. unknown method returns JSON-RPC error (not HTTP 500)
    const bad = await rpc("nonexistent.method");
    assert.ok(bad.error);
    assert.equal(bad.error.code, -32601);
  } finally {
    server.close();
  }
});