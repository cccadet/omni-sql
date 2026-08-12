import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  normalizeMcpEndpoint,
  parseRuntimeDescriptor,
  readRuntimeDescriptor,
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
  startMcpHttpServer,
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

async function rawPost(
  port: number,
  path: string,
  headers: Record<string, string>,
  body: string,
  method = "POST",
): Promise<{ status: number; body: string }> {
  const request = httpRequest({
    hostname: "127.0.0.1",
    port,
    path,
    method,
    headers,
  });
  request.end(body);
  const [response] = await once(request, "response") as [IncomingMessage];
  response.setEncoding("utf8");
  let responseBody = "";
  for await (const chunk of response) responseBody += chunk;
  return { status: response.statusCode ?? 0, body: responseBody };
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

test("CLI and HTTP server option validation reject invalid startup inputs", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  assert.throws(() => createStreamableHttpServer(client));
  assert.throws(() => createStreamableHttpServer(client, { httpToken: "x".repeat(4_097) }));
  assert.throws(() => createStreamableHttpServer(client, { httpToken, maxSessions: 0 }));
  assert.throws(() => createStreamableHttpServer(client, { httpToken, maxSessions: 1.5 }));
  assert.throws(() => createStreamableHttpServer(client, { httpToken, sessionIdleTimeoutMs: 0 }));
  assert.throws(() => createStreamableHttpServer(client, { httpToken, sessionIdleTimeoutMs: 1.5 }));
  assert.throws(() => createStreamableHttpServer(client, { httpToken, port: -1 }));
  assert.throws(() => createStreamableHttpServer(client, { httpToken, port: 65_536 }));
  assert.throws(() => createStreamableHttpServer(client, { httpToken, host: "0.0.0.0" }));
  const server = createStreamableHttpServer(client, { authToken: httpToken, port: 0 });
  await closeStreamableHttpServer(server);

  const httpEnv = { OMNI_SQL_MCP_HTTP_TOKEN: httpToken };
  assert.equal(parseMcpCliOptions(["runtime.json", "--streamable-http"], httpEnv).transport, "streamable-http");
  assert.equal(parseMcpCliOptions(["runtime.json", "--http"], httpEnv).transport, "streamable-http");
  assert.equal(parseMcpCliOptions(["runtime.json", "--http-transport=http"], httpEnv).transport, "streamable-http");
  assert.equal(parseMcpCliOptions(["runtime.json", "--http", "--http-host=localhost"], httpEnv).httpHost, "localhost");
  assert.equal(parseMcpCliOptions(["runtime.json", "--http", "--http-port=65535"], httpEnv).httpPort, 65_535);
  assert.throws(() => parseMcpCliOptions([] as string[], {}));
  assert.throws(() => parseMcpCliOptions(["runtime.json", "other.json"], {}));
  assert.throws(() => parseMcpCliOptions(["runtime.json", "--unknown"], {}));
  assert.throws(() => parseMcpCliOptions(["runtime.json", "--transport"], {}));
  assert.throws(() => parseMcpCliOptions(["runtime.json", "--host"], {}));
  assert.throws(() => parseMcpCliOptions(["runtime.json", "--port"], {}));
  assert.throws(() => parseMcpCliOptions(["runtime.json", "--http", "--port=-1"], httpEnv));
  assert.throws(() => parseMcpCliOptions(["runtime.json", "--http", "--port=65536"], httpEnv));
});

test("HTTP startup binds valid ephemeral listeners and rejects absent token", async () => {
  await assert.rejects(startMcpHttpServer(descriptor, { port: 0 }));
  const server = await startMcpHttpServer(descriptor, { httpToken, port: 0 });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string" && address.port > 0);
  } finally {
    await closeStreamableHttpServer(server);
  }
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

test("runtime descriptors accept only local MCP endpoints and bounded files", async () => {
  assert.equal(normalizeMcpEndpoint("https://LOCALHOST:41920"), "https://localhost:41920/mcp");
  for (const endpoint of [
    "ftp://127.0.0.1:41920",
    "http://example.test:41920",
    "http://user@127.0.0.1:41920",
    "http://127.0.0.1:41920?token=secret",
    "http://127.0.0.1:41920/rpc",
  ]) assert.throws(() => normalizeMcpEndpoint(endpoint));

  const directory = await mkdtemp(join(tmpdir(), "omni-sql-mcp-"));
  const descriptorPath = join(directory, "runtime.json");
  const descriptor = { endpoint: "http://localhost:41920", token: "test-token", pid: 1234, startNonce: "run-1" };
  try {
    await writeFile(descriptorPath, JSON.stringify(descriptor));
    assert.deepEqual(await readRuntimeDescriptor(descriptorPath), descriptor);
    await writeFile(descriptorPath, "{");
    await assert.rejects(readRuntimeDescriptor(descriptorPath), /not valid JSON/u);
    await writeFile(descriptorPath, "x".repeat(16 * 1024 + 1));
    await assert.rejects(readRuntimeDescriptor(descriptorPath), /too large/u);
    await assert.rejects(readRuntimeDescriptor(directory), /must be a file/u);
    await assert.rejects(readRuntimeDescriptor(""), /missing or too long/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("backend client preserves supported success envelopes and rejects malformed responses", async () => {
  for (const [body, expected] of [
    [JSON.stringify({ ok: true, data: { sql: "select 1" } }), { sql: "select 1" }],
    [JSON.stringify({ column: "value" }), { column: "value" }],
  ] as const) {
    const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response(body) });
    assert.deepEqual(await client.call("getActiveSql", {}), expected);
  }
  const emptyClient = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response(null) });
  assert.equal(await emptyClient.call("getActiveSql", {}), null);
  const malformedClient = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{") });
  await assert.rejects(
    malformedClient.call("getActiveSql", {}),
    (error: unknown) => error instanceof BackendClientError && error.message === "backend returned invalid JSON",
  );
  const invalidLengthClient = new BackendMcpClient(descriptor, {
    fetchImpl: async () => new Response("{}", { headers: { "content-length": "not-a-number" } }),
  });
  await assert.rejects(
    invalidLengthClient.call("getActiveSql", {}),
    (error: unknown) => error instanceof BackendClientError && error.message === "backend returned invalid content length",
  );
});

test("backend client maps backend status and error payloads to its stable error contract", async () => {
  const cases: Array<[number, unknown, BackendClientError["code"]]> = [
    [401, { error: { code: "UNAUTHORIZED", message: "denied" } }, "unauthorized"],
    [422, { error: { code: "validation_error", message: "invalid input" } }, "invalid_request"],
    [404, { error: { code: "NOT_FOUND", message: "missing" } }, "not_found"],
    [413, { error: { code: "TOO_LARGE", message: "large" } }, "too_large"],
    [429, { error: { code: "RATE_LIMITED", message: "slow down" } }, "rate_limited"],
    [503, { error: { code: "TIMEOUT", message: "late" } }, "unavailable"],
    [418, "unexpected", "backend_error"],
  ];
  for (const [status, body, code] of cases) {
    const client = new BackendMcpClient(descriptor, {
      fetchImpl: async () => new Response(JSON.stringify(body), { status }),
    });
    await assert.rejects(
      client.call("getActiveSql", {}),
      (error: unknown) => error instanceof BackendClientError && error.code === code && error.status === status,
    );
  }
  const longMessageClient = new BackendMcpClient(descriptor, {
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "x".repeat(1_025) } }), { status: 500 }),
  });
  await assert.rejects(
    longMessageClient.call("getActiveSql", {}),
    (error: unknown) => error instanceof BackendClientError && error.message.endsWith("…"),
  );
});

test("backend client rejects unsupported and oversized requests before fetch", async () => {
  let fetched = false;
  const client = new BackendMcpClient(descriptor, {
    fetchImpl: async () => {
      fetched = true;
      return new Response("{}");
    },
  });
  await assert.rejects(client.call("unknown" as "getActiveSql", {}), /unsupported MCP tool/u);
  await assert.rejects(
    client.call("proposeSqlEdit", { sql: "x".repeat(MAX_REQUEST_BYTES) }),
    (error: unknown) => error instanceof BackendClientError && error.code === "too_large",
  );
  assert.equal(fetched, false);
});

test("Streamable HTTP rejects invalid ingress before MCP session dispatch", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const headers = { authorization: `Bearer ${httpToken}`, "content-type": "application/json" };
  try {
    const noSession = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(noSession.status, 400);

    const invalidJson = await fetch(endpoint, { method: "POST", headers, body: "{" });
    assert.equal(invalidJson.status, 400);

    const invalidOrigin = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, origin: "null" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(invalidOrigin.status, 400);

    const invalidMethod = await fetch(endpoint, { method: "PUT", headers });
    assert.equal(invalidMethod.status, 405);

    const missingPath = await fetch(`http://127.0.0.1:${port}/other`, { method: "POST", headers });
    assert.equal(missingPath.status, 404);
  } finally {
    await closeStreamableHttpServer(server);
  }
});

test("Streamable HTTP rejects malformed raw ingress headers and chunked oversized bodies", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  try {
    const headers = {
      authorization: `Bearer ${httpToken}`,
      "content-type": "application/json",
    };
    assert.equal((await rawPost(port, "/mcp", { ...headers, host: "tunnel.example/path" }, body)).status, 400);
    assert.equal((await rawPost(port, "/mcp", { ...headers, origin: "file:///tmp/mcp" }, body)).status, 400);
    assert.equal((await rawPost(port, "//mcp", headers, body)).status, 400);
    const oversized = await rawPost(port, "/mcp", headers, "x".repeat(MAX_REQUEST_BYTES + 1));
    assert.equal(oversized.status, 413);
    assert.match(oversized.body, /request is too large/u);
  } finally {
    await close(server);
  }
});
test("Streamable HTTP validates request methods and session requirements", async () => {
  const client = new BackendMcpClient(descriptor, { fetchImpl: async () => new Response("{}") });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  const headers = { authorization: `Bearer ${httpToken}`, "content-type": "application/json" };
  try {
    assert.equal((await rawPost(port, "/mcp", headers, "", "GET")).status, 400);
    assert.equal((await rawPost(port, "/mcp", headers, "", "DELETE")).status, 400);
    assert.equal((await rawPost(port, "/mcp", headers, "", "PUT")).status, 405);
    assert.equal((await rawPost(port, "/mcp", headers, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).status, 400);
  } finally {
    await close(server);
  }
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

test("Streamable HTTP exposes backend failures as safe tool errors", async () => {
  const client = new BackendMcpClient(descriptor, {
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: "unavailable", message: "backend is starting" },
    }), { status: 503 }),
  });
  const server = createStreamableHttpServer(client, { httpToken });
  const port = await listen(server);
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${httpToken}` } },
  });
  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });

  try {
    await mcpClient.connect(transport);
    const result = await mcpClient.callTool({ name: "getActiveSql", arguments: {} });
    assert.equal(result.isError, true);
    assert.deepEqual(result.content, [{
      type: "text",
      text: JSON.stringify({ code: "unavailable", message: "backend is starting" }),
    }]);
    await transport.terminateSession();
  } finally {
    await mcpClient.close();
    await close(server);
  }
});

test("Streamable HTTP forwards every remaining approved tool with validated arguments", async () => {
  const forwarded: Array<{ tool: string; args: unknown }> = [];
  const client = new BackendMcpClient(descriptor, {
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { tool: string; args: unknown };
      forwarded.push(body);
      return new Response(JSON.stringify({ result: body }), { status: 200 });
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
    for (const [name, args] of [
      ["getActiveConnectionContext", {}],
      ["getSchemaSummary", {}],
      ["getLatestSqlExecutionError", {}],
      ["proposeSqlEdit", { sql: "SELECT 1", rationale: "Use a literal" }],
    ] as const) {
      const result = await mcpClient.callTool({ name, arguments: args });
      assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify({ tool: name, args }) }]);
    }
    assert.deepEqual(forwarded, [
      { tool: "getActiveConnectionContext", args: {} },
      { tool: "getSchemaSummary", args: {} },
      { tool: "getLatestSqlExecutionError", args: {} },
      { tool: "proposeSqlEdit", args: { sql: "SELECT 1", rationale: "Use a literal" } },
    ]);
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
