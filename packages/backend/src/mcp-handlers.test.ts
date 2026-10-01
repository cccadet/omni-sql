import assert from "node:assert/strict";
import { test } from "node:test";
import { MCP_LIMITS } from "@omni-sql/ts-types";
import { McpBridgeError } from "./mcp-bridge.ts";
import { closeMcpBridge, mcpBridge, mcpHandlers, validateMcpRequest } from "./mcp-handlers.ts";

function invalid(value: unknown): void {
  assert.throws(() => validateMcpRequest(value), (error: unknown) =>
    error instanceof McpBridgeError && error.code === "invalid");
}

test("MCP request uses exact tool/args contract and per-tool allowlists", () => {
  assert.deepEqual(validateMcpRequest({ tool: "getSchemaSummary", args: {} }), {
    tool: "getSchemaSummary",
    args: {},
  });
  assert.deepEqual(validateMcpRequest({ tool: "getLatestSqlExecutionError", args: {} }), {
    tool: "getLatestSqlExecutionError",
    args: {},
  });
  assert.deepEqual(validateMcpRequest({
    tool: "getTableIndexes",
    args: { schema: "public", table: "orders" },
  }), {
    tool: "getTableIndexes",
    args: { schema: "public", table: "orders" },
  });
  assert.deepEqual(validateMcpRequest({
    tool: "explainSql",
    args: { sql: "select * from orders" },
  }), {
    tool: "explainSql",
    args: { sql: "select * from orders" },
  });
  assert.deepEqual(validateMcpRequest({
    tool: "proposeSqlEdit",
    args: { sql: "select 1", rationale: "Improve query" },
  }), {
    tool: "proposeSqlEdit",
    args: { sql: "select 1", rationale: "Improve query" },
  });

  invalid({ tool: "getSchemaSummary", args: { connectionId: "arbitrary" } });
  invalid({ tool: "getActiveSql", args: { value: "unexpected" } });
  invalid({ tool: "getLatestSqlExecutionError", args: { value: "unexpected" } });
  invalid({ tool: "openSqlTab", args: { title: "Draft", sql: "select 1" } });
  invalid({ tool: "proposeSqlEdit", args: { sql: "select 1" } });
  invalid({ tool: "proposeSqlEdit", args: { sql: "select 1", rationale: "test", connectionId: "arbitrary" } });
  invalid({ tool: "getTableIndexes", args: { schema: "public" } });
  invalid({ tool: "getTableIndexes", args: { schema: "public", table: "orders", connectionId: "arbitrary" } });
  invalid({ tool: "explainSql", args: {} });
  invalid({ tool: "explainSql", args: { sql: "select 1", analyze: true } });
  invalid({ tool: "getActiveSql", args: {}, params: {} });
});

test("MCP request key validation is insertion-order independent and rejects case and Unicode variants", () => {
  assert.deepEqual(validateMcpRequest({ args: {}, tool: "getActiveSql" }), {
    tool: "getActiveSql",
    args: {},
  });

  invalid({ Args: {}, tool: "getActiveSql" });
  invalid({ args: {}, Tool: "getActiveSql" });
  invalid({ args: {}, tool: "getActiveSql", ä: "unexpected" });
});

test("MCP limits remain shared and bounded", () => {
  assert.equal(MCP_LIMITS.maxHttpBodyBytes, 64 * 1024);
  assert.equal(MCP_LIMITS.maxArgumentBytes, 48 * 1024);
  assert.equal(MCP_LIMITS.maxBridgeResultBytes, 256 * 1024);
  assert.equal(MCP_LIMITS.requestTimeoutMs, 120_000);
});

test("mcp.ui.next releases wait when its request signal aborts", async () => {
  const controller = new AbortController();
  try {
    const waiting = mcpHandlers["mcp.ui.next"](
      { listenerId: "handler-abort", waitMs: 500 },
      { signal: controller.signal },
    );
    controller.abort();
    assert.equal(await waiting, null);
  } finally {
    closeMcpBridge();
  }
});

test("mcp.history returns recorded proposeSqlEdit entries", async () => {
  try {
    assert.deepEqual(await mcpHandlers["mcp.history"](), { entries: [] });

    const waiting = mcpHandlers["mcp.ui.next"]({ listenerId: "handler-history", waitMs: 500 });
    const pending = mcpBridge.submit("proposeSqlEdit", { sql: "select 1", rationale: "Improve query" });
    const delivered = await waiting;
    assert.equal(delivered?.tool, "proposeSqlEdit");

    mcpHandlers["mcp.ui.respond"]({
      id: delivered!.id,
      ok: true,
      result: { approved: true },
      listenerId: "handler-history",
    });
    assert.deepEqual(await pending, { approved: true });

    const history = await mcpHandlers["mcp.history"]();
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0]!.tool, "proposeSqlEdit");
    assert.equal(history.entries[0]!.status, "completed");
    assert.equal(history.entries[0]!.sql, "select 1");
    assert.equal(history.entries[0]!.rationale, "Improve query");
  } finally {
    closeMcpBridge();
  }
});

test("SQL and schema inputs keep authorization out of tool arguments", () => {
  assert.deepEqual(validateMcpRequest({ tool: "executeSql", args: { sql: "SELECT 1", limit: 100 } }).args, { sql: "SELECT 1", limit: 100 });
  for (const limit of [0, -1, 1001, 1.5, "100"]) invalid({ tool: "executeSql", args: { sql: "SELECT 1", limit } });
  invalid({ tool: "executeSql", args: { sql: "SELECT 1", executionRiskAccepted: true } });
  invalid({ tool: "executeSql", args: { sql: "SELECT 1", connectionId: "arbitrary" } });
  assert.deepEqual(validateMcpRequest({ tool: "getSchemaSummary", args: { schema: "public", table: "users", offset: 2, limit: 10 } }).args, { schema: "public", table: "users", offset: 2, limit: 10 });
});

test("SQL results stop at byte and row limits without treating column values as credentials", async () => {
  const { boundMcpQueryResult } = await import("./mcp-handlers.ts");
  const result = { columns: [{ name: "password", dataType: "text", nullable: true }], rows: [[{ token: "a database value" }], [1n], ["x".repeat(300_000)]], rowsMoreAvailable: false, elapsedMs: 1 };
  const bounded = boundMcpQueryResult("connection", result);
  assert.deepEqual(bounded.rows, [['{"token":"a database value"}'], ["1"]]);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.rowsMoreAvailable, true);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= MCP_LIMITS.maxBridgeResultBytes);
});
