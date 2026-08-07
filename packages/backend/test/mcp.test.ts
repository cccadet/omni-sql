import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-mcp-"));
process.env.OMNI_SQL_METADATA_DB = path.join(tmpDir, "metadata.db");
process.env.OMNI_SQL_DEV_KEYRING_FILE = path.join(tmpDir, "keyring.json");
process.env.OMNI_SQL_AUTH_TOKEN = "desktop-mcp-test-token";
process.env.OMNI_SQL_MCP_AUTH_TOKEN = "mcp-test-token";

const { startServer } = await import("../src/index.ts");

const port = 14_560;
const baseUrl = `http://127.0.0.1:${port}`;
const desktopHeaders = { authorization: "Bearer desktop-mcp-test-token" };
const mcpHeaders = { authorization: "Bearer mcp-test-token" };

function jsonRecord(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function post(pathname: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function rpc(method: string, params?: unknown): Promise<any> {
  return (await post("/rpc", {
    jsonrpc: "2.0",
    id: Math.random(),
    method,
    ...(params !== undefined ? { params } : {}),
  }, desktopHeaders)).body;
}

test("MCP endpoint isolates tokens, rejects generic RPC, and bridges one UI response", async () => {
  const server = startServer(port);
  try {
    const desktopOnMcp = await post("/mcp", { tool: "getActiveSql", args: {} }, desktopHeaders);
    assert.equal(desktopOnMcp.status, 401);

    const mcpOnRpc = await post("/rpc", { jsonrpc: "2.0", id: 1, method: "connection.list" }, mcpHeaders);
    assert.equal(mcpOnRpc.status, 401);

    const genericMcp = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "connection.list" }, mcpHeaders);
    assert.equal(genericMcp.status, 400);
    assert.equal(genericMcp.body.error.code, "invalid");

    const noListener = await post("/mcp", { tool: "getActiveSql", args: {} }, mcpHeaders);
    assert.equal(noListener.status, 503);
    assert.equal(noListener.body.error.code, "unavailable");

    const nextPromise = rpc("mcp.ui.next", { listenerId: "desktop", waitMs: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const mcpPromise = post("/mcp", { tool: "getActiveSql", args: {} }, mcpHeaders);
    const next = await nextPromise;
    const request = next.result as { id: string; tool: string; args: unknown };
    assert.equal(request.tool, "getActiveSql");
    assert.deepEqual(request.args, {});

    const accepted = await rpc("mcp.ui.respond", {
      listenerId: "desktop",
      id: request.id,
      ok: true,
      result: { sql: "select 1" },
    });
    assert.equal(accepted.result.accepted, true);
    const mcpResult = await mcpPromise;
    assert.deepEqual(mcpResult, { status: 200, body: { result: { sql: "select 1" } } });

    const stale = await rpc("mcp.ui.respond", {
      listenerId: "desktop",
      id: request.id,
      ok: true,
      result: {},
    });
    assert.equal(stale.error.code, -32001);
    assert.match(stale.error.message, /stale/i);

    const status = await rpc("mcp.status");
    assert.equal(status.result.uiConnected, true);
    assert.equal(status.result.queueSize, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("MCP endpoint bounds request body", async () => {
  const server = startServer(port + 1);
  try {
    const oversized = await fetch(`http://127.0.0.1:${port + 1}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", ...mcpHeaders },
      body: JSON.stringify({ tool: "getActiveSql", args: { value: "x".repeat(70 * 1024) } }),
    });
    assert.equal(oversized.status, 413);
    const oversizedBody = jsonRecord(await oversized.json());
    assert.equal(jsonRecord(oversizedBody.error).code, "invalid");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("aborted UI poll releases listener wait for StrictMode remount", async () => {
  const pollPort = port + 2;
  const server = startServer(pollPort);
  const pollUrl = `http://127.0.0.1:${pollPort}/rpc`;
  try {
    const controller = new AbortController();
    const poll = fetch(pollUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...desktopHeaders },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "mcp.ui.next",
        params: { listenerId: "strict-mode", waitMs: 5_000 },
      }),
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await assert.rejects(poll);

    const replacement = await fetch(pollUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...desktopHeaders },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "mcp.ui.next",
        params: { listenerId: "strict-mode", waitMs: 1 },
      }),
    });
    assert.equal(replacement.status, 200);
    assert.equal(jsonRecord(await replacement.json()).result, null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
