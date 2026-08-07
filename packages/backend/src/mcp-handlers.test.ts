import assert from "node:assert/strict";
import { test } from "node:test";
import { MCP_LIMITS } from "@omni-sql/ts-types";
import { McpBridgeError } from "./mcp-bridge.ts";
import { closeMcpBridge, mcpHandlers, validateMcpRequest } from "./mcp-handlers.ts";

function invalid(value: unknown): void {
  assert.throws(() => validateMcpRequest(value), (error: unknown) =>
    error instanceof McpBridgeError && error.code === "invalid");
}

test("MCP request uses exact tool/args contract and per-tool allowlists", () => {
  assert.deepEqual(validateMcpRequest({ tool: "getSchemaSummary", args: {} }), {
    tool: "getSchemaSummary",
    args: {},
  });
  assert.deepEqual(validateMcpRequest({
    tool: "openSqlTab",
    args: { title: "Draft", sql: "select 1", connectionId: "active" },
  }), {
    tool: "openSqlTab",
    args: { title: "Draft", sql: "select 1", connectionId: "active" },
  });

  invalid({ tool: "getSchemaSummary", args: { connectionId: "arbitrary" } });
  invalid({ tool: "getActiveSql", args: { value: "unexpected" } });
  invalid({ tool: "openSqlTab", args: { title: "Draft", sql: "select 1", extra: true } });
  invalid({ tool: "proposeSqlEdit", args: { sql: "select 1" } });
  invalid({ tool: "proposeSqlEdit", args: { sql: "select 1", rationale: "test", connectionId: "arbitrary" } });
  invalid({ tool: "getActiveSql", args: {}, params: {} });
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
