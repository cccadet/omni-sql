import assert from "node:assert/strict";
import { test } from "node:test";
import { McpBridge, McpBridgeError } from "./mcp-bridge.ts";
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

    bridge.respond({ id: "request-1", ok: true, result: { sql: "select 1" } }, "desktop");
    assert.deepEqual(await pending, { sql: "select 1" });
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
    const pending = bridge.submit("openSqlTab", { title: "Draft", sql: "select 1" });
    await assert.rejects(
      Promise.resolve().then(() => bridge.submit("openSqlTab", { title: "Draft 2", sql: "select 2" })),
      hasCode("rejected"),
    );
    const next = await bridge.next({ listenerId: "desktop" });
    assert.equal(next?.id, "request-timeout");
    await assert.rejects(pending, hasCode("timeout"));
    assert.throws(
      () => bridge.respond({ id: "request-timeout", ok: true, result: { opened: true } }, "desktop"),
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
        result: { sql: "select 1", secret: "nope" },
      }, "desktop"),
      hasCode("invalid"),
    );
    await assert.rejects(sqlPending, hasCode("invalid"));
  } finally {
    bridge.close();
  }
});
