import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isMcpToolName,
  McpBridge,
  McpBridgeError,
  validateMcpToolResult,
  validateSafePayload,
} from "./mcp-bridge.ts";
import { MCP_REQUEST_TIMEOUT_MS } from "@omni-sql/ts-types";

function hasCode(code: string) {
  return (error: unknown): boolean => error instanceof McpBridgeError && error.code === code;
}

test("MCP bridge rejects requests without a UI listener", async () => {
  const bridge = new McpBridge({ timeoutMs: 50 });
  try {
    await assert.rejects(
      Promise.resolve().then(() => bridge.submit("getActiveSql", {})),
      hasCode("unavailable"),
    );
  } finally {
    bridge.close();
  }
});

test("MCP bridge delivers one queued request and accepts its response", async () => {
  const bridge = new McpBridge({ timeoutMs: 500, idFactory: () => "request-1" });
  try {
    const waiting = bridge.next({ listenerId: "desktop", waitMs: 500 });
    const pending = bridge.submit("getActiveSql", {});
    const next = await waiting;
    assert.deepEqual(next && { id: next.id, tool: next.tool, args: next.args }, {
      id: "request-1",
      tool: "getActiveSql",
      args: {},
    });
    assert.equal(typeof next?.expiresAt, "number");
    assert.ok(next!.expiresAt > Date.now());
    assert.ok(next!.expiresAt <= Date.now() + 500);

    bridge.respond({ id: "request-1", ok: true, result: { sql: "select 1", dialect: "postgres" } }, "desktop");
    assert.deepEqual(await pending, { sql: "select 1", dialect: "postgres" });
    assert.equal(bridge.status().inFlight, 0);
  } finally {
    bridge.close();
  }
});

test("aborted next releases its wait and same listener can replace it", async () => {
  const bridge = new McpBridge({ maxUiWaitMs: 500 });
  try {
    const controller = new AbortController();
    const aborted = bridge.next({ listenerId: "desktop", waitMs: 500 }, controller.signal);
    controller.abort();
    assert.equal(await aborted, null);

    const first = bridge.next({ listenerId: "desktop", waitMs: 500 });
    const replacement = bridge.next({ listenerId: "desktop", waitMs: 1 });
    assert.equal(await first, null);
    assert.equal(await replacement, null);
  } finally {
    bridge.close();
  }
});

test("MCP bridge bounds queue and cleans timed out requests as stale", async () => {
  const bridge = new McpBridge({ maxQueueSize: 1, timeoutMs: 20, idFactory: () => "request-timeout" });
  try {
    await bridge.next({ listenerId: "desktop" });
    const pending = bridge.submit("getActiveSql", {});
    await assert.rejects(
      Promise.resolve().then(() => bridge.submit("getActiveSql", {})),
      hasCode("rejected"),
    );
    const next = await bridge.next({ listenerId: "desktop" });
    assert.equal(next?.id, "request-timeout");
    await assert.rejects(pending, hasCode("timeout"));
    assert.throws(
      () => bridge.respond({ id: "request-timeout", ok: true, result: { sql: "select 1", dialect: "postgres" } }, "desktop"),
      hasCode("stale"),
    );
  } finally {
    bridge.close();
  }
});

test("delivered proposals survive listener lease until request deadline", async () => {
  const bridge = new McpBridge({ listenerTtlMs: 50, timeoutMs: 150, idFactory: () => "proposal-1" });
  try {
    assert.equal(MCP_REQUEST_TIMEOUT_MS, 120_000);
    await bridge.next({ listenerId: "desktop" });
    const pending = bridge.submit({
      tool: "proposeSqlEdit",
      args: { sql: "select 1", rationale: "test" },
    });
    const delivered = await bridge.next({ listenerId: "desktop" });
    assert.equal(delivered?.id, "proposal-1");

    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(bridge.status().uiConnected, false);

    bridge.respond({ id: "proposal-1", ok: true, result: { approved: true } }, "desktop");
    assert.deepEqual(await pending, { approved: true });
  } finally {
    bridge.close();
  }
});

test("UI results use originating-tool schemas and reject unsafe fields", async () => {
  let sequence = 0;
  const bridge = new McpBridge({ timeoutMs: 500, idFactory: () => `result-${++sequence}` });
  try {
    await bridge.next({ listenerId: "desktop" });

    const contextPending = bridge.submit({ tool: "getActiveConnectionContext", args: {} });
    const contextRequest = await bridge.next({ listenerId: "desktop" });
    assert.throws(
      () => bridge.respond({
        id: contextRequest!.id,
        ok: true,
        result: { connectionId: "opaque-1", label: "Dev", dialect: "postgres", username: "alice" },
      }, "desktop"),
      hasCode("invalid"),
    );
    await assert.rejects(contextPending, hasCode("invalid"));

    const schemaPending = bridge.submit({ tool: "getSchemaSummary", args: {} });
    const schemaRequest = await bridge.next({ listenerId: "desktop" });
    assert.throws(
      () => bridge.respond({
        id: schemaRequest!.id,
        ok: true,
        result: {
          connectionId: "opaque-1",
          schemas: [{ name: "public", relations: [] }],
          host: "db.internal",
          options: { ssl: true },
        },
      }, "desktop"),
      hasCode("invalid"),
    );
    await assert.rejects(schemaPending, hasCode("invalid"));

    const sqlPending = bridge.submit({ tool: "getActiveSql", args: {} });
    const sqlRequest = await bridge.next({ listenerId: "desktop" });
    assert.throws(
      () => bridge.respond({
        id: sqlRequest!.id,
        ok: true,
        result: { sql: "select 1", dialect: "postgres", secret: "nope" },
      }, "desktop"),
      hasCode("invalid"),
    );
    await assert.rejects(sqlPending, hasCode("invalid"));
  } finally {
    bridge.close();
  }
});

test("latest execution error result keeps only bounded error fields", async () => {
  const bridge = new McpBridge({ timeoutMs: 500, idFactory: () => "execution-error-1" });
  try {
    await bridge.next({ listenerId: "desktop" });
    const pending = bridge.submit("getLatestSqlExecutionError", {});
    const request = await bridge.next({ listenerId: "desktop" });
    bridge.respond({
      id: request!.id,
      ok: true,
      result: { error: { message: "syntax error", code: "-32000", position: { start: 4, end: 9 } } },
    }, "desktop");
    assert.deepEqual(await pending, {
      error: { message: "syntax error", code: "-32000", position: { start: 4, end: 9 } },
    });

    const invalidPending = bridge.submit("getLatestSqlExecutionError", {});
    const invalidRequest = await bridge.next({ listenerId: "desktop" });
    assert.throws(() => bridge.respond({
      id: invalidRequest!.id,
      ok: true,
      result: { error: { message: "syntax error", sql: "SELECT secret", stack: "trace" } },
    }, "desktop"), hasCode("invalid"));
    await assert.rejects(invalidPending, hasCode("invalid"));
  } finally {
    bridge.close();
  }
});

test("MCP result schemas retain valid nested data and reject unsafe payloads", () => {
  assert.equal(isMcpToolName("getSchemaSummary"), true);
  assert.equal(isMcpToolName("unknown"), false);
  assert.equal(isMcpToolName(null), false);

  assert.deepEqual(
    validateMcpToolResult("getActiveConnectionContext", {
      connectionId: "connection-1",
      label: "Production",
      dialect: "postgres",
    }),
    { connectionId: "connection-1", label: "Production", dialect: "postgres" },
  );
  assert.deepEqual(
    validateMcpToolResult("getSchemaSummary", {
      connectionId: "connection-1",
      schemas: [{
        name: "public",
        relations: [{
          name: "orders",
          kind: "table",
          columns: [{ name: "id", dataType: "integer" }],
        }],
      }],
    }),
    {
      connectionId: "connection-1",
      schemas: [{
        name: "public",
        relations: [{
          name: "orders",
          kind: "table",
          columns: [{ name: "id", dataType: "integer" }],
        }],
      }],
    },
  );
  assert.deepEqual(
    validateMcpToolResult("getLatestSqlExecutionError", { error: null }),
    { error: null },
  );
  assert.deepEqual(
    validateMcpToolResult("getLatestSqlExecutionError", {
      error: { message: "syntax error", position: { start: 4 } },
    }),
    { error: { message: "syntax error", position: { start: 4 } } },
  );
  assert.deepEqual(validateMcpToolResult("proposeSqlEdit", { approved: false }), { approved: false });

  assert.throws(
    () => validateMcpToolResult("getActiveConnectionContext", {
      connectionId: "connection-1",
      label: "Production",
      dialect: "unsupported",
    }),
    hasCode("invalid"),
  );
  assert.throws(
    () => validateMcpToolResult("getSchemaSummary", {
      connectionId: "connection-1",
      schemas: [{ name: "public", relations: [{ name: "orders", kind: "index", columns: [] }] }],
    }),
    hasCode("invalid"),
  );
  assert.throws(
    () => validateMcpToolResult("getLatestSqlExecutionError", {
      error: { message: "syntax error", position: { start: 4, end: 3 } },
    }),
    hasCode("invalid"),
  );

  const cycle: { child?: unknown } = {};
  cycle.child = cycle;
  assert.throws(() => validateSafePayload(cycle, 1_000, "MCP result"), hasCode("invalid"));
  assert.throws(
    () => validateSafePayload({ password: "secret" }, 1_000, "MCP result"),
    hasCode("invalid"),
  );
});

test("MCP bridge rejects invalid listener options and releases pending work on close", async () => {
  const bridge = new McpBridge({ timeoutMs: 500, maxUiWaitMs: 5, idFactory: () => "reject-1" });
  try {
    await assert.rejects(bridge.next({ listenerId: "", waitMs: 0 }), hasCode("invalid"));
    await assert.rejects(bridge.next({ listenerId: "desktop", waitMs: 6 }), hasCode("invalid"));
    await bridge.next({ listenerId: "desktop" });
    await assert.rejects(
      bridge.next({ listenerId: "other" }),
      hasCode("rejected"),
    );

    const rejected = bridge.submit("getActiveSql", {});
    const request = await bridge.next({ listenerId: "desktop" });
    assert.deepEqual(
      bridge.respond({ id: request!.id, ok: false, error: { code: "rejected", message: "declined" } }, "desktop"),
      { accepted: true },
    );
    await assert.rejects(rejected, hasCode("rejected"));

    const pending = bridge.submit("getActiveSql", {});
    bridge.close();
    await assert.rejects(pending, hasCode("unavailable"));
  } finally {
    bridge.close();
  }
});

test("MCP value guards reject invalid required values and size bounds", () => {
  assert.throws(() => validateSafePayload("x".repeat(33_000), 1_000_000, "MCP result"), hasCode("invalid"));
  assert.throws(() => validateSafePayload({ value: "x".repeat(1_001) }, 1_000, "MCP result"), hasCode("invalid"));
  assert.throws(
    () => validateMcpToolResult("getActiveSql", { sql: 1, dialect: "postgres" }),
    hasCode("invalid"),
  );
  assert.throws(
    () => validateMcpToolResult("proposeSqlEdit", { approved: "yes" }),
    hasCode("invalid"),
  );
  assert.throws(
    () => validateMcpToolResult("getLatestSqlExecutionError", {
      error: { message: "syntax error", position: { start: -1 } },
    }),
    hasCode("invalid"),
  );
});
