import assert from "node:assert/strict";
import { test } from "node:test";
import { MCP_MAX_BRIDGE_RESULT_BYTES } from "@omni-sql/ts-types";
import {
  BackendClientError,
  BackendMcpClient,
  BACKEND_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  mcpToolNames,
  parseRuntimeDescriptor,
} from "./backend-client.ts";
import {
  createMcpServer,
  emptyInputSchema,
  openSqlTabInputSchema,
  proposeSqlEditInputSchema,
} from "./index.ts";

test("advertises exactly five approved tools", async () => {
  const expectedTools = [
    "getActiveSql",
    "getActiveConnectionContext",
    "getSchemaSummary",
    "openSqlTab",
    "proposeSqlEdit",
  ];
  const client = new BackendMcpClient(
    { endpoint: "http://127.0.0.1:41920", token: "test-token", pid: 1234, startNonce: "run-1" },
    { fetchImpl: async () => new Response("{}") },
  );
  const server = createMcpServer(client);
  const registered = (server as unknown as {
    _registeredTools: Record<string, unknown>;
  })._registeredTools;

  assert.deepEqual(mcpToolNames, expectedTools);
  assert.deepEqual(Object.keys(registered), expectedTools);
  assert.equal(Object.keys(registered).length, expectedTools.length);
});

test("input schemas reject unknown fields and oversized values", () => {
  assert.throws(() => emptyInputSchema.parse({ extra: true }));
  assert.throws(() => openSqlTabInputSchema.parse({ title: "x", sql: "select 1", extra: true }));
  assert.throws(() => proposeSqlEditInputSchema.parse({ sql: "select 1", rationale: "" }));
  assert.throws(() => openSqlTabInputSchema.parse({ title: "x", sql: "x".repeat(32 * 1024 + 1) }));
});

test("descriptor has exact endpoint, token, pid, and startNonce shape", () => {
  const descriptor = {
    endpoint: "http://127.0.0.1:41920",
    token: "capability-token",
    pid: 1234,
    startNonce: "run-nonce",
  };
  assert.deepEqual(
    parseRuntimeDescriptor(descriptor),
    descriptor,
  );
  assert.throws(() => parseRuntimeDescriptor({ endpoint: "https://example.test", token: "secret" }));
  assert.throws(() => parseRuntimeDescriptor({ ...descriptor, endpoint: "http://127.0.0.1:41920/rpc" }));
  assert.throws(() => parseRuntimeDescriptor({ ...descriptor, extra: true }));
  assert.throws(() => parseRuntimeDescriptor({ ...descriptor, mcp_token: "secret" }));
});

test("backend client posts only approved tool request and unwraps result", async () => {
  let request: Request | undefined;
  const client = new BackendMcpClient(
    { endpoint: "http://127.0.0.1:41920", token: "test-token", pid: 1234, startNonce: "run-1" },
    {
      fetchImpl: async (_input, init) => {
        request = new Request(String(_input), init);
        return new Response(JSON.stringify({ result: { sql: "select 1" } }), { status: 200 });
      },
    },
  );

  const result = await client.call<{ sql: string }>("getActiveSql", {});
  assert.deepEqual(result, { sql: "select 1" });
  assert.equal(request?.method, "POST");
  assert.equal(new URL(request?.url ?? "").pathname, "/mcp");
  assert.equal(request?.headers.get("authorization"), "Bearer test-token");
  const body = await request?.json() as Record<string, unknown>;
  assert.deepEqual(body, { tool: "getActiveSql", args: {} });
  assert.deepEqual(Object.keys(body).sort(), ["args", "tool"]);
  assert.equal("params" in body, false);
});

test("backend client forwards all five approved tools", async () => {
  const called: string[] = [];
  const client = new BackendMcpClient(
    { endpoint: "http://127.0.0.1:41920", token: "test-token", pid: 1234, startNonce: "run-1" },
    {
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { tool: string };
        called.push(body.tool);
        return new Response(JSON.stringify({ result: body.tool }), { status: 200 });
      },
    },
  );

  for (const tool of mcpToolNames) {
    assert.equal(await client.call(tool, {}), tool);
  }
  assert.deepEqual(called, mcpToolNames);
});

test("response cap includes shared result limit and HTTP envelope overhead", async () => {
  const result = "x".repeat(MCP_MAX_BRIDGE_RESULT_BYTES - 2);
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= MCP_MAX_BRIDGE_RESULT_BYTES);
  const body = JSON.stringify({ result });
  assert.ok(Buffer.byteLength(body, "utf8") <= MAX_RESPONSE_BYTES);

  const client = new BackendMcpClient(
    { endpoint: "http://127.0.0.1:41920", token: "test-token", pid: 1234, startNonce: "run-1" },
    { fetchImpl: async () => new Response(body, { status: 200 }) },
  );
  assert.equal(await client.call("getActiveSql", {}), result);
});

test("oversized Content-Length is rejected before stream consumption", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([123, 125]));
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = new BackendMcpClient(
    { endpoint: "http://127.0.0.1:41920", token: "test-token", pid: 1234, startNonce: "run-1" },
    {
      fetchImpl: async () => new Response(stream, {
        status: 200,
        headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
      }),
    },
  );

  await assert.rejects(
    client.call("getActiveSql", {}),
    (error: unknown) => error instanceof BackendClientError && error.code === "too_large",
  );
  assert.equal(cancelled, true);
});

test("oversized streamed response is cancelled at cap", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = new BackendMcpClient(
    { endpoint: "http://127.0.0.1:41920", token: "test-token", pid: 1234, startNonce: "run-1" },
    { fetchImpl: async () => new Response(stream, { status: 200 }) },
  );

  await assert.rejects(
    client.call("getActiveSql", {}),
    (error: unknown) => error instanceof BackendClientError
      && error.code === "too_large"
      && error.status === 200,
  );
  assert.equal(cancelled, true);
});

test("backend timeout exceeds bridge confirmation timeout", () => {
  assert.ok(BACKEND_TIMEOUT_MS > 120_000);
});

test("backend typed errors map to safe client errors", async () => {
  const client = new BackendMcpClient(
    { endpoint: "http://127.0.0.1:41920", token: "test-token", pid: 1234, startNonce: "run-1" },
    {
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: "STALE_ACTIVE_TAB", message: "tab changed" } }), { status: 409 }),
    },
  );

  await assert.rejects(
    client.call("proposeSqlEdit", { sql: "select 1", rationale: "fix" }),
    (error: unknown) => error instanceof BackendClientError
      && error.code === "conflict"
      && error.status === 409
      && error.message === "tab changed",
  );
});
