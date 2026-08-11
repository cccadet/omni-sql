import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  BackendClientError,
  BackendMcpClient,
  MAX_CONNECTION_ID_BYTES,
  MAX_REQUEST_BYTES,
  MAX_RATIONALE_BYTES,
  MAX_SQL_BYTES,
  MAX_TITLE_BYTES,
  MAX_TOKEN_LENGTH,
  readRuntimeDescriptor,
  type RuntimeDescriptor,
} from "./backend-client.ts";

export { BackendClientError, BackendMcpClient, mcpToolNames, readRuntimeDescriptor } from "./backend-client.ts";
export type { RuntimeDescriptor } from "./backend-client.ts";

export type McpTransportMode = "stdio" | "streamable-http";

export interface StreamableHttpServerOptions {
  host?: string;
  port?: number;
  httpToken?: string;
  /** @deprecated Use httpToken. Kept for callers of initial Streamable HTTP API. */
  authToken?: string;
  maxSessions?: number;
  sessionIdleTimeoutMs?: number;
}

export const DEFAULT_MCP_HTTP_HOST = "127.0.0.1";
export const DEFAULT_MCP_HTTP_PORT = 41922;
export const MCP_HTTP_PATH = "/mcp";
export const DEFAULT_MCP_HTTP_MAX_SESSIONS = 16;
export const DEFAULT_MCP_HTTP_SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1_000;

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "localhost") return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return normalized.split(".")[0] === "127";
  return ipVersion === 6 && normalized === "::1";
}

function requireLoopbackHost(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new Error("MCP HTTP host must be loopback (127.0.0.0/8, ::1, or localhost)");
  }
}

const boundedText = (maxBytes: number, name: string) =>
  z.string()
    .min(1, `${name} must not be empty`)
    .refine((value) => Buffer.byteLength(value, "utf8") <= maxBytes, `${name} is too large`);

export const emptyInputSchema = z.object({}).strict();
export const getLatestSqlExecutionErrorInputSchema = emptyInputSchema;
export const openSqlTabInputSchema = z.object({
  title: boundedText(MAX_TITLE_BYTES, "title"),
  sql: boundedText(MAX_SQL_BYTES, "sql"),
  connectionId: boundedText(MAX_CONNECTION_ID_BYTES, "connectionId").optional(),
}).strict();
export const proposeSqlEditInputSchema = z.object({
  sql: boundedText(MAX_SQL_BYTES, "sql"),
  rationale: boundedText(MAX_RATIONALE_BYTES, "rationale"),
}).strict();

type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};

function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "null";
}

function errorText(error: unknown): string {
  if (error instanceof BackendClientError) {
    return JSON.stringify({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return JSON.stringify({ code: "invalid_request", message: "invalid tool input" });
  }
  return JSON.stringify({ code: "backend_error", message: "MCP backend request failed" });
}

function success(value: unknown): ToolResult {
  return { content: [{ type: "text", text: resultText(value) }] };
}

function failure(error: unknown): ToolResult {
  return { content: [{ type: "text", text: errorText(error) }], isError: true };
}

async function invoke<T>(operation: () => Promise<T>): Promise<ToolResult> {
  try {
    return success(await operation());
  } catch (error) {
    return failure(error);
  }
}

export function createMcpServer(client: BackendMcpClient): McpServer {
  const server = new McpServer({ name: "omni-sql", version: "0.0.0" });

  server.registerTool(
    "getActiveSql",
    {
      description: "Read SQL from active Omni SQL tab.",
      inputSchema: emptyInputSchema,
    },
    async (input) => invoke(() => {
      emptyInputSchema.parse(input);
      return client.call("getActiveSql", {});
    }),
  );

  server.registerTool(
    "getActiveConnectionContext",
    {
      description: "Read safe context for active Omni SQL connection.",
      inputSchema: emptyInputSchema,
    },
    async (input) => invoke(() => {
      emptyInputSchema.parse(input);
      return client.call("getActiveConnectionContext", {});
    }),
  );

  server.registerTool(
    "getSchemaSummary",
    {
      description: "Read permitted schema summary for active Omni SQL connection.",
      inputSchema: emptyInputSchema,
    },
    async (input) => invoke(() => {
      emptyInputSchema.parse(input);
      return client.call("getSchemaSummary", {});
    }),
  );

  server.registerTool(
    "getLatestSqlExecutionError",
    {
      description: "Read latest failed SQL execution error from active Omni SQL tab.",
      inputSchema: getLatestSqlExecutionErrorInputSchema,
    },
    async (input) => invoke(() => {
      getLatestSqlExecutionErrorInputSchema.parse(input);
      return client.call("getLatestSqlExecutionError", {});
    }),
  );

  server.registerTool(
    "openSqlTab",
    {
      description: "Request a new Omni SQL tab without executing SQL.",
      inputSchema: openSqlTabInputSchema,
    },
    async (input) => invoke(() => {
      const parsed = openSqlTabInputSchema.parse(input);
      return client.call("openSqlTab", parsed);
    }),
  );

  server.registerTool(
    "proposeSqlEdit",
    {
      description: "Propose SQL edit for explicit UI approval; never applies it automatically.",
      inputSchema: proposeSqlEditInputSchema,
    },
    async (input) => invoke(() => {
      const parsed = proposeSqlEditInputSchema.parse(input);
      return client.call("proposeSqlEdit", parsed);
    }),
  );

  return server;
}

export async function startMcpServer(
  descriptor: RuntimeDescriptor,
  transport = new StdioServerTransport(),
): Promise<void> {
  await createMcpServer(new BackendMcpClient(descriptor)).connect(transport);
}

type HttpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  idleTimer?: ReturnType<typeof setTimeout>;
  activeRequests: number;
  tracked: boolean;
  disposed: boolean;
};

type HttpServerState = {
  sessions: Map<string, HttpSession>;
  maxSessions: number;
  sessionIdleTimeoutMs: number;
  pendingInitializations: number;
};

class HttpRequestError extends Error {
  readonly status: number;

  constructor(
    status: number,
    message: string,
  ) {
    super(message);
    this.status = status;
  }
}

function writeHttpError(response: ServerResponse, status: number, message: string): void {
  if (response.headersSent) return;
  response.writeHead(status, {
    "content-type": "application/json",
    ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
  });
  response.end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: status === 413 ? -32000 : -32700, message },
    id: null,
  }));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hasHttpAuthorization(request: IncomingMessage, authToken: string | undefined): boolean {
  if (!authToken) return false;
  return headerValue(request.headers.authorization) === `Bearer ${authToken}`;
}

function isValidHostHeader(value: string): boolean {
  if (!value || value !== value.trim() || /[,/\\?#@]/u.test(value)) return false;
  try {
    const parsed = new URL(`http://${value}`);
    return parsed.hostname.length > 0
      && parsed.pathname === "/"
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

function isValidOrigin(value: string): boolean {
  if (value === "null") return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && !parsed.username
      && !parsed.password
      && parsed.pathname === "/"
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

function validateIngressHeaders(request: IncomingMessage): void {
  const host = request.headers.host;
  if (Array.isArray(host) || (host !== undefined && !isValidHostHeader(host))) {
    throw new HttpRequestError(400, "invalid host header");
  }
  const origin = request.headers.origin;
  if (Array.isArray(origin) || (origin !== undefined && !isValidOrigin(origin))) {
    throw new HttpRequestError(400, "invalid origin header");
  }
}

function parseIngressUrl(request: IncomingMessage): URL {
  const rawUrl = request.url;
  if (!rawUrl || !rawUrl.startsWith("/") || rawUrl.startsWith("//") || rawUrl.includes("#")) {
    throw new HttpRequestError(400, "invalid request URL");
  }
  const queryIndex = rawUrl.indexOf("?");
  const rawPath = queryIndex < 0 ? rawUrl : rawUrl.slice(0, queryIndex);
  if (rawPath !== MCP_HTTP_PATH) {
    throw new HttpRequestError(404, "not found");
  }
  try {
    const parsed = new URL(rawUrl, "http://127.0.0.1");
    if (parsed.pathname !== MCP_HTTP_PATH) throw new Error("path mismatch");
    return parsed;
  } catch {
    throw new HttpRequestError(400, "invalid request URL");
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const rawContentLength = request.headers["content-length"];
  if (Array.isArray(rawContentLength)) {
    throw new HttpRequestError(400, "invalid content length");
  }
  const contentLength = rawContentLength;
  if (contentLength !== undefined) {
    const declared = Number(contentLength);
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(declared) || declared < 0) {
      throw new HttpRequestError(400, "invalid content length");
    }
    if (declared > MAX_REQUEST_BYTES) {
      request.resume();
      throw new HttpRequestError(413, "request is too large");
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      request.resume();
      throw new HttpRequestError(413, "request is too large");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpRequestError(400, "invalid JSON");
  }
}

function isInitializeRequest(value: unknown): boolean {
  const messages = Array.isArray(value) ? value : [value];
  return messages.some((message) => (
    typeof message === "object"
    && message !== null
    && !Array.isArray(message)
    && "method" in message
    && message.method === "initialize"
  ));
}

function forgetSession(state: HttpServerState, session: HttpSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = undefined;
  session.tracked = false;
  for (const [sessionId, candidate] of state.sessions) {
    if (candidate === session) state.sessions.delete(sessionId);
  }
}

function armSessionIdleTimer(state: HttpServerState, session: HttpSession): void {
  if (session.disposed || !session.tracked || session.activeRequests > 0) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    session.idleTimer = undefined;
    if (session.activeRequests > 0) return;
    void disposeSession(state, session);
  }, state.sessionIdleTimeoutMs);
  session.idleTimer.unref?.();
}

function touchSession(state: HttpServerState, session: HttpSession): void {
  armSessionIdleTimer(state, session);
}

function beginSessionRequest(session: HttpSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = undefined;
  session.activeRequests += 1;
}

function endSessionRequest(state: HttpServerState, session: HttpSession): void {
  session.activeRequests = Math.max(0, session.activeRequests - 1);
  if (session.activeRequests === 0) touchSession(state, session);
}

async function disposeSession(state: HttpServerState, session: HttpSession): Promise<void> {
  if (session.disposed) return;
  session.disposed = true;
  forgetSession(state, session);
  try {
    await session.server.close();
  } catch {
    await session.transport.close().catch(() => undefined);
  }
}

function sessionOptions(options: StreamableHttpServerOptions): {
  httpToken: string;
  maxSessions: number;
  sessionIdleTimeoutMs: number;
} {
  const httpToken = options.httpToken ?? options.authToken;
  if (typeof httpToken !== "string" || !httpToken || httpToken.length > MAX_TOKEN_LENGTH) {
    throw new Error("MCP HTTP token must be configured with OMNI_SQL_MCP_HTTP_TOKEN");
  }
  const maxSessions = options.maxSessions ?? DEFAULT_MCP_HTTP_MAX_SESSIONS;
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) {
    throw new Error("MCP HTTP max sessions must be a positive integer");
  }
  const sessionIdleTimeoutMs = options.sessionIdleTimeoutMs ?? DEFAULT_MCP_HTTP_SESSION_IDLE_TIMEOUT_MS;
  if (!Number.isSafeInteger(sessionIdleTimeoutMs) || sessionIdleTimeoutMs < 1) {
    throw new Error("MCP HTTP session idle timeout must be a positive integer");
  }
  return { httpToken, maxSessions, sessionIdleTimeoutMs };
}

async function handleStreamableHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  client: BackendMcpClient,
  state: HttpServerState,
  options: StreamableHttpServerOptions,
): Promise<void> {
  try {
    parseIngressUrl(request);
    validateIngressHeaders(request);
  } catch (error) {
    request.resume();
    if (error instanceof HttpRequestError) {
      writeHttpError(response, error.status, error.message);
      return;
    }
    throw error;
  }
  if (!hasHttpAuthorization(request, options.authToken)) {
    request.resume();
    writeHttpError(response, 401, "unauthorized");
    return;
  }
  if (request.method !== "POST" && request.method !== "GET" && request.method !== "DELETE") {
    request.resume();
    response.writeHead(405, { allow: "GET, POST, DELETE" });
    response.end();
    return;
  }

  const sessionId = headerValue(request.headers["mcp-session-id"]);
  const session = sessionId ? state.sessions.get(sessionId) : undefined;
  if (sessionId && !session) {
    request.resume();
    writeHttpError(response, 404, "session not found");
    return;
  }

  if (request.method === "POST") {
    let parsedBody: unknown;
    try {
      parsedBody = await readJsonBody(request);
    } catch (error) {
      if (error instanceof HttpRequestError) {
        writeHttpError(response, error.status, error.message);
        return;
      }
      throw error;
    }

    if (!sessionId && isInitializeRequest(parsedBody)) {
      if (state.sessions.size + state.pendingInitializations >= state.maxSessions) {
        writeHttpError(response, 503, "MCP session capacity reached");
        return;
      }
      state.pendingInitializations += 1;
      const sessionRef: { session?: HttpSession } = {};
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (initializedSessionId) => {
          if (sessionRef.session) {
            state.sessions.set(initializedSessionId, sessionRef.session);
            sessionRef.session.tracked = true;
            touchSession(state, sessionRef.session);
          }
        },
        onsessionclosed: (closedSessionId) => {
          const closedSession = state.sessions.get(closedSessionId);
          if (closedSession) forgetSession(state, closedSession);
        },
        enableJsonResponse: true,
      });
      const server = createMcpServer(client);
      const newSession: HttpSession = {
        server,
        transport,
        activeRequests: 0,
        tracked: false,
        disposed: false,
      };
      sessionRef.session = newSession;
      beginSessionRequest(newSession);
      try {
        await server.connect(transport);
        await transport.handleRequest(request, response, parsedBody);
        if (response.statusCode >= 400) await disposeSession(state, newSession);
      } catch (error) {
        await disposeSession(state, newSession);
        throw error;
      } finally {
        endSessionRequest(state, newSession);
        state.pendingInitializations -= 1;
      }
      return;
    }

    if (!session) {
      writeHttpError(response, 400, "valid MCP session is required");
      return;
    }
    beginSessionRequest(session);
    try {
      await session.transport.handleRequest(request, response, parsedBody);
    } finally {
      endSessionRequest(state, session);
    }
    return;
  }

  if (!session) {
    writeHttpError(response, 400, "valid MCP session is required");
    return;
  }
  beginSessionRequest(session);
  try {
    await session.transport.handleRequest(request, response);
  } finally {
    endSessionRequest(state, session);
  }
}

const serverSessionClosers = new WeakMap<HttpServer, () => Promise<void>>();
const serverClosePromises = new WeakMap<HttpServer, Promise<void>>();

function validateHttpPort(port: number): void {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("MCP HTTP port must be an integer from 0 to 65535");
  }
}

function closeHttpListener(server: HttpServer): Promise<void> {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export function createStreamableHttpServer(
  client: BackendMcpClient,
  options: StreamableHttpServerOptions = {},
): HttpServer {
  requireLoopbackHost(options.host ?? DEFAULT_MCP_HTTP_HOST);
  validateHttpPort(options.port ?? DEFAULT_MCP_HTTP_PORT);
  const { httpToken, maxSessions, sessionIdleTimeoutMs } = sessionOptions(options);
  const state: HttpServerState = {
    sessions: new Map(),
    maxSessions,
    sessionIdleTimeoutMs,
    pendingInitializations: 0,
  };
  const server = createServer((request, response) => {
    handleStreamableHttpRequest(request, response, client, state, { ...options, authToken: httpToken }).catch(() => {
      writeHttpError(response, 500, "MCP request failed");
    });
  });
  const closeSessions = async (): Promise<void> => {
    await Promise.all([...state.sessions.values()].map((session) => disposeSession(state, session)));
  };
  serverSessionClosers.set(server, closeSessions);
  server.once("close", () => {
    void closeSessions();
  });
  return server;
}

export async function closeStreamableHttpServer(server: HttpServer): Promise<void> {
  const existing = serverClosePromises.get(server);
  if (existing) return existing;
  const closing = (async () => {
    await serverSessionClosers.get(server)?.();
    await closeHttpListener(server);
  })();
  serverClosePromises.set(server, closing);
  await closing;
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

export async function startMcpHttpServer(
  descriptor: RuntimeDescriptor,
  options: StreamableHttpServerOptions = {},
): Promise<HttpServer> {
  const host = options.host ?? DEFAULT_MCP_HTTP_HOST;
  const port = options.port ?? DEFAULT_MCP_HTTP_PORT;
  requireLoopbackHost(host);
  validateHttpPort(port);
  const httpToken = options.httpToken ?? options.authToken;
  if (!httpToken) throw new Error("MCP HTTP token must be configured with OMNI_SQL_MCP_HTTP_TOKEN");
  const server = createStreamableHttpServer(new BackendMcpClient(descriptor), { ...options, httpToken });
  try {
    await listen(server, host, port);
  } catch (error) {
    await closeStreamableHttpServer(server).catch(() => undefined);
    throw error;
  }
  return server;
}

function parseTransportMode(value: string | undefined): McpTransportMode {
  switch (value) {
    case undefined:
    case "stdio":
      return "stdio";
    case "http":
    case "streamable-http":
      return "streamable-http";
    default:
      throw new Error("MCP transport must be stdio or streamable-http");
  }
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MCP_HTTP_PORT;
  if (!/^\d+$/.test(value)) throw new Error("MCP HTTP port must be an integer from 0 to 65535");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("MCP HTTP port must be an integer from 0 to 65535");
  }
  return port;
}

export interface McpCliOptions {
  descriptorPath: string;
  transport: McpTransportMode;
  httpHost: string;
  httpPort: number;
  httpToken?: string;
}

export function parseMcpCliOptions(argv: string[], env: NodeJS.ProcessEnv): McpCliOptions {
  let descriptorPath: string | undefined;
  let explicitTransport: string | undefined;
  let explicitHost: string | undefined;
  let explicitPort: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) throw new Error("usage: node dist/index.js [runtime-descriptor-path] [options]");
    if (argument === "--streamable-http" || argument === "--http") {
      explicitTransport = "streamable-http";
      continue;
    }
    if (argument === "--transport" || argument === "--http-transport") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("usage: node dist/index.js [runtime-descriptor-path] [options]");
      explicitTransport = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--transport=") || argument.startsWith("--http-transport=")) {
      explicitTransport = argument.slice(argument.indexOf("=") + 1);
      continue;
    }
    if (argument === "--host" || argument === "--http-host") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("usage: node dist/index.js [runtime-descriptor-path] [options]");
      explicitHost = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--host=") || argument.startsWith("--http-host=")) {
      explicitHost = argument.slice(argument.indexOf("=") + 1);
      continue;
    }
    if (argument === "--port" || argument === "--http-port") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("usage: node dist/index.js [runtime-descriptor-path] [options]");
      explicitPort = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--port=") || argument.startsWith("--http-port=")) {
      explicitPort = argument.slice(argument.indexOf("=") + 1);
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error("usage: node dist/index.js [runtime-descriptor-path] [options]");
    }
    if (descriptorPath !== undefined) {
      throw new Error("usage: node dist/index.js [runtime-descriptor-path] [options]");
    }
    descriptorPath = argument;
  }

  const resolvedDescriptorPath = descriptorPath ?? env.OMNI_SQL_MCP_DESCRIPTOR;
  if (!resolvedDescriptorPath) throw new Error("runtime descriptor path is required");
  const transport = parseTransportMode(explicitTransport ?? env.OMNI_SQL_MCP_TRANSPORT);
  const httpHost = explicitHost ?? env.OMNI_SQL_MCP_HTTP_HOST ?? DEFAULT_MCP_HTTP_HOST;
  requireLoopbackHost(httpHost);
  const httpToken = transport === "streamable-http"
    ? env.OMNI_SQL_MCP_HTTP_TOKEN
    : undefined;
  if (transport === "streamable-http" && (!httpToken || httpToken.length > MAX_TOKEN_LENGTH)) {
    throw new Error("MCP HTTP token must be configured by OMNI_SQL_MCP_HTTP_TOKEN");
  }
  return {
    descriptorPath: resolvedDescriptorPath,
    transport,
    httpHost,
    httpPort: transport === "streamable-http"
      ? parsePort(explicitPort ?? env.OMNI_SQL_MCP_HTTP_PORT)
      : DEFAULT_MCP_HTTP_PORT,
    ...(httpToken ? { httpToken } : {}),
  };
}

function diagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "startup failed";
  return [...message]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? " " : character;
    })
    .join("");
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const options = parseMcpCliOptions(argv, env);
  const descriptor = await readRuntimeDescriptor(options.descriptorPath);
  if (options.transport === "stdio") {
    await startMcpServer(descriptor);
    return;
  }
  const server = await startMcpHttpServer(descriptor, {
    host: options.httpHost,
    port: options.httpPort,
    httpToken: options.httpToken,
  });
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): void => {
    shutdownPromise ??= closeStreamableHttpServer(server).catch((error: unknown) => {
      process.stderr.write(`[omni-sql-mcp] ${diagnostic(error)}\n`);
    }).finally(() => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const address = server.address();
  if (address && typeof address !== "string") {
    process.stderr.write(`[omni-sql-mcp] Streamable HTTP listening at http://${address.address}:${address.port}${MCP_HTTP_PATH}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`[omni-sql-mcp] ${diagnostic(error)}\n`);
    process.exitCode = 1;
  });
}
