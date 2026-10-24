import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { registerAdapter } from "@omni-sql/adapters-core";
import type { McpBridgeRequest, McpHttpStatus, McpToolResultByName, QueryResult } from "@omni-sql/ts-types";
import { InMemoryAdapter } from "./in-memory-adapter.ts";

const directory = await mkdtemp(join(tmpdir(), "omni-mcp-execution-"));
process.env.OMNI_SQL_METADATA_DB = join(directory, "metadata.db");
process.env.OMNI_SQL_DEV_KEYRING_FILE = join(directory, "keyring.json");
process.env.OMNI_SQL_AUTH_TOKEN = "mcp-execution-desktop";
process.env.OMNI_SQL_MCP_AUTH_TOKEN = "mcp-execution-bridge";
const { startServer } = await import("../src/index.ts");
const { closeBackendResources } = await import("../src/handlers.ts");
const { closeMcpHttp, closeMcpBridge } = await import("../src/mcp-handlers.ts");
const server = startServer(0);
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
process.env.OMNI_SQL_PORT = String(address.port);
const base = `http://127.0.0.1:${address.port}`;
const httpToken = "mcp-execution-http-token";
let endpoint = "";
let session = "";
let nextId = 0;
let executions = 0;
let readOnlyExecutions = 0;
let cancelSlow: (() => void) | undefined;
class TestAdapter extends InMemoryAdapter {
  override async runQuery(sql: string, limit: number): Promise<QueryResult> {
    executions++;
    if (sql === "WAIT") return new Promise((_resolve, reject) => { cancelSlow = () => reject(new Error("query cancelled")); });
    if (/^\s*DELETE\b/i.test(sql)) return { columns: [], rows: [], rowsAffected: 2, rowsMoreAvailable: false, elapsedMs: 0 };
    return super.runQuery(sql, limit);
  }
  async runReadOnlyQuery(sql: string, limit: number): Promise<QueryResult> {
    readOnlyExecutions++;
    return this.runQuery(sql, limit);
  }
  async cancelRunning(): Promise<void> { cancelSlow?.(); cancelSlow = undefined; }
}
registerAdapter("jdbc-generic", (config) => new TestAdapter(config));

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  const response = await fetch(`${base}/rpc`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OMNI_SQL_AUTH_TOKEN}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }) });
  const body = await response.json() as { result: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
async function mcp(body: unknown, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
  return fetch(endpoint, { method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json", authorization: `Bearer ${httpToken}`, ...(session ? { "mcp-session-id": session } : {}), ...extra }, body: JSON.stringify(body), signal });
}
async function requestExecution(sql: string, limit?: number) {
  await rpc("mcp.ui.next", { listenerId: "execution-ui" });
  const id = ++nextId;
  const controller = new AbortController();
  const result = mcp({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "executeSql", arguments: { sql, ...(limit === undefined ? {} : { limit }) } } }, {}, controller.signal).then(async (response) => {
    const body = await response.json() as { result: { isError?: boolean; structuredContent?: McpToolResultByName["executeSql"]; content: { text: string }[] } };
    return body.result;
  });
  const request = await rpc<McpBridgeRequest>("mcp.ui.next", { listenerId: "execution-ui", waitMs: 2_000 });
  assert.equal(request.tool, "executeSql");
  return { id, request, result, controller };
}
async function approve(request: McpBridgeRequest, connectionId = "memory") {
  const result = await rpc<McpToolResultByName["executeSql"]>("mcp.ui.execute", { id: request.id, listenerId: "execution-ui", connectionId });
  await rpc("mcp.ui.respond", { id: request.id, listenerId: "execution-ui", ok: true, result });
  return result;
}

before(async () => {
  await rpc("connection.add", { config: { id: "memory", label: "Memory", dialect: "jdbc-generic", endpoint: "memory://local", user: "test", options: { mcpAccess: "write" } } });
  const status = await rpc<McpHttpStatus>("mcp.http.start", { token: httpToken, port: 0 });
  endpoint = status.endpoint!;
  const response = await mcp({ jsonrpc: "2.0", id: ++nextId, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-execution-test", version: "1" } } });
  assert.equal(response.status, 200);
  session = response.headers.get("mcp-session-id")!;
  await response.arrayBuffer();
  const initialized = await mcp({ jsonrpc: "2.0", method: "notifications/initialized" });
  await initialized.arrayBuffer();
});
after(async () => {
  closeMcpBridge();
  await closeMcpHttp();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeBackendResources();
  await rm(directory, { recursive: true, force: true });
});

test("HTTP MCP executes only after approval, prevents replay, bounds rows, and records all tools", async () => {
  const initial = executions;
  const { request, result } = await requestExecution("SELECT * FROM users", 1);
  assert.equal(executions, initial);
  await assert.rejects(rpc("mcp.ui.execute", { id: request.id, listenerId: "other-ui", connectionId: "memory" }), /stale/i);
  const executed = await approve(request);
  assert.equal(executions, initial + 1);
  assert.equal(executed.rows.length, 1);
  assert.equal(executed.truncated, true);
  assert.deepEqual((await result).structuredContent, executed);
  await assert.rejects(approve(request), /stale/i);
  assert.equal(executions, initial + 1);
  const history = await rpc<{ entries: { tool: string; status: string }[] }>("mcp.history");
  assert.equal(history.entries[0]?.tool, "executeSql");
  assert.equal(history.entries[0]?.status, "completed");
  assert.equal((await rpc<McpHttpStatus>("mcp.http.status")).sessions, 1);
});

test("HTTP MCP rejects unapproved execution and validates origin and token", async () => {
  const initial = executions;
  const { request, result } = await requestExecution("SELECT 1");
  await rpc("mcp.ui.respond", { id: request.id, listenerId: "execution-ui", ok: false, error: { code: "rejected", message: "User rejected execution" } });
  assert.equal((await result).isError, true);
  assert.equal(executions, initial);
  const invalidHeaders: Record<string, string>[] = [{ authorization: "Bearer wrong" }, { origin: "https://untrusted.example" }];
  for (const headers of invalidHeaders) {
    const response = await mcp({}, headers);
    assert.ok(response.status === 401 || response.status === 403);
    await response.arrayBuffer();
  }
});

test("MCP cancellation reaches the running adapter and frees the connection", async () => {
  const { id, request, result, controller } = await requestExecution("WAIT");
  const cancelledResult = assert.rejects(result);
  const running = rpc("mcp.ui.execute", { id: request.id, listenerId: "execution-ui", connectionId: "memory" });
  const rejected = assert.rejects(running);
  // Wait for the adapter to own the query before notifying cancellation.
  for (let attempt = 0; !cancelSlow && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(cancelSlow);
  const cancelled = await mcp({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "test cancellation" } });
  await cancelled.arrayBuffer();
  await rejected;
  controller.abort();
  await cancelledResult;
  const next = await requestExecution("SELECT 1");
  await approve(next.request);
  assert.equal((await next.result).isError, undefined);
});

type ToolResult = { isError?: boolean; structuredContent?: unknown; content: { text: string }[] };
async function callReadTool(tool: string, args: Record<string, unknown>, uiResult: unknown): Promise<ToolResult> {
  await rpc("mcp.ui.next", { listenerId: "execution-ui" });
  const pending = mcp({ jsonrpc: "2.0", id: ++nextId, method: "tools/call", params: { name: tool, arguments: args } })
    .then(async (response) => (await response.json() as { result: ToolResult }).result);
  const request = await rpc<McpBridgeRequest>("mcp.ui.next", { listenerId: "execution-ui", waitMs: 2_000 });
  assert.equal(request.tool, tool);
  await rpc("mcp.ui.respond", { id: request.id, listenerId: "execution-ui", ok: true, result: uiResult });
  return pending;
}
async function addMemoryConnection(id: string, mcpAccess?: string) {
  await rpc("connection.add", { config: { id, label: id, dialect: "jdbc-generic", endpoint: "memory://local", user: "test", ...(mcpAccess ? { options: { mcpAccess } } : {}) } });
}
/** Simulates a desktop that approved anyway: the backend must still refuse. */
async function approveDespitePolicy(sql: string, connectionId: string) {
  const { request, result } = await requestExecution(sql);
  const execution = await rpc("mcp.ui.execute", { id: request.id, listenerId: "execution-ui", connectionId }).then(() => null, (error: Error) => error);
  await rpc("mcp.ui.respond", { id: request.id, listenerId: "execution-ui", ok: false, error: { code: "rejected", message: execution?.message ?? "unexpected success" } });
  return { execution, result: await result };
}

test("connections default to read-only MCP access and persist an explicit choice", async () => {
  await addMemoryConnection("perm-default");
  await addMemoryConnection("perm-off", "off");
  await addMemoryConnection("perm-write", "write");
  const { configs } = await rpc<{ configs: { id: string; options?: Record<string, unknown> }[] }>("connection.list");
  const access = (id: string) => configs.find((config) => config.id === id)?.options?.mcpAccess;
  assert.equal(access("perm-default"), undefined);
  assert.equal(access("perm-off"), "off");
  assert.equal(access("perm-write"), "write");
  const { request, result } = await requestExecution("SELECT * FROM users");
  const readsBefore = readOnlyExecutions;
  assert.equal((await approve(request, "perm-default")).rows.length, 2);
  assert.equal(readOnlyExecutions, readsBefore + 1, "default access must use the read-only execution path");
  assert.equal((await result).isError, undefined);
});

test("read-only MCP access rejects writes in the backend even after desktop approval", async () => {
  await addMemoryConnection("perm-read", "read");
  const initial = executions;
  for (const sql of [
    "DELETE FROM users",
    "UPDATE users SET name = 'x'",
    "DROP TABLE users",
    "SELECT 1; DELETE FROM users",
    "WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone",
    "SELECT * FROM users FOR UPDATE",
    "CALL purge_users()",
  ]) {
    const { execution, result } = await approveDespitePolicy(sql, "perm-read");
    assert.ok(execution, `${sql} must be refused`);
    assert.match(execution.message, /Read-only access/);
    assert.equal(result.isError, true);
  }
  assert.equal(executions, initial, "no rejected statement may reach the adapter");
  const { request } = await requestExecution("SELECT 1");
  assert.deepEqual((await approve(request, "perm-read")).rows, [[1]]);
});

test("MCP access off blocks execution and every result bound to the connection", async () => {
  await addMemoryConnection("perm-blocked", "off");
  const initial = executions;
  const { execution, result } = await approveDespitePolicy("SELECT 1", "perm-blocked");
  assert.match(execution?.message ?? "", /MCP access is disabled/);
  assert.equal(result.isError, true);
  assert.equal(executions, initial);
  for (const [tool, args, uiResult] of [
    ["getActiveConnectionContext", {}, { connectionId: "perm-blocked", label: "Blocked", dialect: "postgres" }],
    ["getSchemaSummary", {}, { connectionId: "perm-blocked", schemas: [{ name: "public", relations: [{ name: "salaries", kind: "table", columns: [] }] }] }],
    ["getTableIndexes", { schema: "public", table: "salaries" }, { connectionId: "perm-blocked", indexes: [] }],
    ["explainSql", { sql: "SELECT 1" }, { connectionId: "perm-blocked", textual: "Seq Scan on salaries", format: "text" }],
    // A connection the backend does not know is treated as off.
    ["getActiveConnectionContext", {}, { connectionId: "never-saved", label: "Ghost", dialect: "postgres" }],
  ] as const) {
    const blocked = await callReadTool(tool, args, uiResult);
    assert.equal(blocked.isError, true, tool);
    assert.match(blocked.content[0]?.text ?? "", /MCP access is disabled/, tool);
    assert.doesNotMatch(JSON.stringify(blocked), /salaries/, `${tool} must not leak the UI result`);
  }
  const history = await rpc<{ entries: { tool: string; status: string; errorCode?: string; errorMessage?: string }[] }>("mcp.history");
  assert.equal(history.entries[0]?.status, "error");
  assert.equal(history.entries[0]?.errorCode, "rejected");
  assert.match(history.entries[0]?.errorMessage ?? "", /MCP access is disabled/);
  const allowed = await callReadTool("getActiveConnectionContext", {}, { connectionId: "memory", label: "Memory", dialect: "postgres" });
  assert.equal(allowed.isError, undefined);
});

test("read and write MCP access runs approved writes, and a permission change applies to the next request", async () => {
  await addMemoryConnection("perm-switch", "write");
  const before = executions;
  const write = await requestExecution("DELETE FROM users");
  assert.equal((await approve(write.request, "perm-switch")).rowsAffected, 2);
  assert.equal(executions, before + 1);
  await addMemoryConnection("perm-switch", "read");
  const { execution } = await approveDespitePolicy("DELETE FROM users", "perm-switch");
  assert.match(execution?.message ?? "", /Read-only access/);
  await addMemoryConnection("perm-switch", "off");
  const { execution: blocked } = await approveDespitePolicy("SELECT 1", "perm-switch");
  assert.match(blocked?.message ?? "", /MCP access is disabled/);
  assert.equal(executions, before + 1);
});

test("PostgreSQL executes SQL through MCP HTTP, approval RPC, backend and real adapter", { skip: process.env.OMNI_SQL_RUN_INTEGRATION !== "1" }, async () => {
  await rpc("connection.add", { config: { id: "pg-mcp", label: "MCP PostgreSQL", dialect: "postgres", endpoint: "127.0.0.1:5432/omni_test", user: "omni", options: { mcpAccess: "write" } }, password: "omni" });
  try {
    const { request, result } = await requestExecution("SELECT n, repeat('x', 1000) AS payload FROM generate_series(1, 200) n", 3);
    const executed = await approve(request, "pg-mcp");
    assert.equal(executed.rows.length, 3);
    assert.deepEqual(executed.rows.map((row) => row[0]), [1, 2, 3]);
    assert.equal(executed.rowsMoreAvailable, true);
    assert.deepEqual((await result).structuredContent, executed);
    const write = await requestExecution("CREATE TEMP TABLE mcp_approval_test (id integer)");
    assert.deepEqual((await approve(write.request, "pg-mcp")).rows, []);
    assert.equal((await write.result).isError, undefined);
    const insert = await requestExecution("INSERT INTO mcp_approval_test VALUES (7) RETURNING id");
    assert.deepEqual((await approve(insert.request, "pg-mcp")).rows, [[7]]);
    assert.equal((await insert.result).isError, undefined);
    await rpc("query.run", { connectionId: "pg-mcp", sql: "DROP TABLE IF EXISTS mcp_approval_test", executionRiskAccepted: true });
  } finally { await rpc("connection.remove", { connectionId: "pg-mcp" }); }
});

test("MCP cancellation interrupts a real PostgreSQL query and allows another query", { skip: process.env.OMNI_SQL_RUN_INTEGRATION !== "1", timeout: 15_000 }, async () => {
  for (const id of ["pg-cancel", "pg-observer"]) await rpc("connection.add", { config: { id, label: id, dialect: "postgres", endpoint: "127.0.0.1:5432/omni_test", user: "omni" }, password: "omni" });
  try {
    const { id, request, result, controller } = await requestExecution("SELECT pg_sleep(10)");
    const cancelledResult = assert.rejects(result);
    const running = rpc("mcp.ui.execute", { id: request.id, listenerId: "execution-ui", connectionId: "pg-cancel" });
    const rejected = assert.rejects(running);
    let active = false;
    for (let attempt = 0; attempt < 30 && !active; attempt++) {
      const status = await rpc<QueryResult>("query.run", { connectionId: "pg-observer", sql: "SELECT count(*)::int FROM pg_stat_activity WHERE wait_event = 'PgSleep' AND state = 'active'", limit: 1 });
      active = Number(status.rows[0]?.[0]) > 0;
      if (!active) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(active, true);
    const notification = await mcp({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "cancel PostgreSQL" } });
    await notification.arrayBuffer();
    controller.abort();
    await cancelledResult;
    await rejected;
    const next = await rpc<QueryResult>("query.run", { connectionId: "pg-cancel", sql: "SELECT 42", limit: 1 });
    assert.deepEqual(next.rows, [[42]]);
  } finally {
    for (const connectionId of ["pg-cancel", "pg-observer"]) await rpc("connection.remove", { connectionId });
  }
});
