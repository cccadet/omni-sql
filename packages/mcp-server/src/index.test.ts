import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server as HttpServer } from "node:http";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCP_MAX_BRIDGE_RESULT_BYTES } from "@omni-sql/ts-types";
import {
  BackendClientError,
  BackendMcpClient,
  BACKEND_TIMEOUT_MS,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  mcpToolNames,
  parseRuntimeDescriptor,
} from "./backend-client.ts";
import {
  createMcpServer,
  closeStreamableHttpServer,
  createStreamableHttpServer,
  DEFAULT_MCP_HTTP_PORT,
  emptyInputSchema,
  getLatestSqlExecutionErrorInputSchema,
  isLoopbackHost,
  parseMcpCliOptions,
  proposeSqlEditInputSchema,
  startMcpServer,
} from "./index.ts";

const descriptor = {
  endpoint: "http://127.0.0.1:41920",
  token: "test-token",
  pid: 1234,
  startNonce: "run-1",
};
const httpToken = "http-token";

async function listen(server: HttpServer): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

async function initializeSession(port: number, token = httpToken, headers: Record<string, string> = {}): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.0" },
      },
    }),
  });
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  const sessionId = response.headers.get("mcp-session-id");
  assert.ok(sessionId);
  return sessionId;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("STDIO remains default and accepts explicit transport selection", async () => {
  assert.deepEqual(
    parseMcpCliOptions(["runtime.json"], {}),
    {
      descriptorPath: "runtime.json",
      transport: "stdio",
      httpHost: "127.0.0.1",
      httpPort: DEFAULT_MCP_HTTP_PORT,
    },
  );
  assert.deepEqual(
    parseMcpCliOptions(["runtime.json", "--transport", "streamable-http"], { OMNI_SQL_MCP_HTTP_TOKEN: httpToken }),
    {
      descriptorPath: "runtime.json",
      transport: "streamable-http",
      httpHost: "127.0.0.1",
      httpPort: DEFAULT_MCP_HTTP_PORT,
      httpToken,
    },
  );
  assert.equal(
    parseMcpCliOptions(["runtime.json"], { OMNI_SQL_MCP_TRANSPORT: "http", OMNI_SQL_MCP_HTTP_TOKEN: httpToken }).transport,
    "streamable-http",
  );
  assert.equal(
    parseMcpCliOptions(["--transport=streamable-http", "--port=0"], {
      OMNI_SQL_MCP_DESCRIPTOR: "runtime.json",
      OMNI_SQL_MCP_HTTP_TOKEN: httpToken,
    }).httpPort,
    0,
  );
  assert.throws(() => parseMcpCliOptions(["runtime.json"], { OMNI_SQL_MCP_TRANSPORT: "websocket" }));
  assert.throws(() => parseMcpCliOptions(["runtime.json", "--host", "0.0.0.0"], {}));
  assert.throws(() => parseMcpCliOptions(["runtime.json"], { OMNI_SQL_MCP_HTTP_HOST: "192.168.1.10" }));
  assert.throws(() => parseMcpCliOptions(["runtime.json", "--transport", "http"], {}));
  assert.equal(isLoopbackHost("127.0.0.2"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);

  let started = false;
  const transport = {
    start: async () => {
      started = true;
    },
  } as unknown as StdioServerTransport;
  await startMcpServer(descriptor, transport);
  assert.equal(started, true);
});

test("advertises exactly five approved tools", async () => {
  const expectedTools = [
    "getActiveSql",
    "getActiveConnectionContext",
    "getSchemaSummary",
    "getLatestSqlExecutionError",
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
  assert.throws(() => getLatestSqlExecutionErrorInputSchema.parse({ extra: true }));
  assert.throws(() => proposeSqlEditInputSchema.parse({ sql: "select 1", rationale: "" }));
  assert.throws(() => proposeSqlEditInputSchema.parse({ sql: "x".repeat(32 * 1024 + 1), rationale: "reason" }));
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

test("Streamable HTTP initializes, lists approved tools, and forwards a tool call", async () => {
  let bridgeTool: string | undefined;
  const client = new BackendMcpClient(descriptor, {
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { tool: string };
      bridgeTool = body.tool;
      return new Response(JSON.stringify({ result: { sql: "select 1" } }), { status: 200 });
    },
  });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${httpToken}` } },
  });
  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });

  try {
    await mcpClient.connect(transport);
    const tools = await mcpClient.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), mcpToolNames);
    const result = await mcpClient.callTool({ name: "getActiveSql", arguments: {} });
    assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify({ sql: "select 1" }) }]);
    assert.equal(bridgeTool, "getActiveSql");
    await transport.terminateSession();
  } finally {
    await mcpClient.close();
    await close(server);
  }
});

test("Streamable HTTP rejects missing authorization and oversized payloads", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const oversized = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${httpToken}`,
        "content-type": "application/json",
      },
      body: "x".repeat(MAX_REQUEST_BYTES + 1),
    });
    assert.equal(oversized.status, 413);
  } finally {
    await close(server);
  }
});

test("Streamable HTTP keeps fixed path and accepts tunnel-forwarded host and origin", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  try {
    const wrongPath = await fetch(`http://127.0.0.1:${port}/mcp/`, {
      method: "POST",
      headers: { authorization: `Bearer ${httpToken}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(wrongPath.status, 404);

    const sessionId = await initializeSession(port, httpToken, {
      host: "mcp-tunnel.example",
      origin: "https://chatgpt.example",
    });
    const controller = new AbortController();
    const sse = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${httpToken}`,
        "mcp-session-id": sessionId,
        origin: "https://chatgpt.example",
      },
      signal: controller.signal,
    });
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get("content-type") ?? "", /^text\/event-stream/u);
    controller.abort();
  } finally {
    await closeStreamableHttpServer(server);
  }
});

test("unknown MCP session IDs return 404", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${httpToken}`,
        "mcp-session-id": "missing-session",
      },
    });
    assert.equal(response.status, 404);
  } finally {
    await closeStreamableHttpServer(server);
  }
});

test("MCP sessions have bounded capacity, failed init does not consume it, and idle sessions expire", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  const server = createStreamableHttpServer(client, {
    httpToken,
    maxSessions: 1,
    sessionIdleTimeoutMs: 30,
  });
  const port = await listen(server);
  try {
    const invalidInit = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${httpToken}`, "content-type": "application/json" },
      body: "{",
    });
    assert.equal(invalidInit.status, 400);

    const sessionId = await initializeSession(port);
    const atCapacity = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${httpToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }),
    });
    assert.equal(atCapacity.status, 503);

    await wait(75);
    const expired = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: {
        authorization: `Bearer ${httpToken}`,
        "mcp-session-id": sessionId,
      },
    });
    assert.equal(expired.status, 404);
  } finally {
    await closeStreamableHttpServer(server);
  }
});

test("HTTP ingress token is separate from descriptor backend token", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(response.status, 401);
  } finally {
    await closeStreamableHttpServer(server);
  }
});

test("graceful HTTP close disposes listener and MCP sessions", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  await initializeSession(port);
  await closeStreamableHttpServer(server);
  assert.equal(server.listening, false);
});
