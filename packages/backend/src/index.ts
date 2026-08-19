import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
} from "./protocol.ts";
import { closeBackendResources, handlers } from "./handlers.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { RpcValidationError } from "./rpc-errors.ts";
import { closeMcpBridge, handleMcpRequest, mcpHandlers } from "./mcp-handlers.ts";
import { McpBridgeError } from "./mcp-bridge.ts";
import {
  MCP_MAX_HTTP_BODY_BYTES,
  type McpErrorCode,
  type McpHttpErrorCode,
} from "@omni-sql/ts-types";

const DEFAULT_PORT = Number(process.env.OMNI_SQL_PORT ?? 41920);
const AUTH_HEADER = "authorization";
const MAX_RPC_BODY_BYTES = 1_048_576;
const HEALTH_CHALLENGE_RE = /^[a-f0-9]{64}$/i;
export function defaultAllowedOrigin(
  nodeEnv = process.env.NODE_ENV,
  platform = process.platform,
): string {
  if (nodeEnv === "production") return platform === "win32" ? "http://tauri.localhost" : "tauri://localhost";
  return "http://localhost:1420";
}

const ALLOWED_ORIGINS = new Set(
  (process.env.NODE_ENV === "production"
    ? defaultAllowedOrigin()
    : (process.env.OMNI_SQL_ALLOWED_ORIGIN ?? defaultAllowedOrigin()))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
if (ALLOWED_ORIGINS.has("*")) throw new Error("OMNI_SQL_ALLOWED_ORIGIN cannot contain wildcard origin");
const servers = new Set<ReturnType<typeof createServer>>();
let shutdownStarted = false;

async function gracefulShutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  closeMcpBridge();
  await closeBackendResources();
}

const onSigint = (): void => {
  void gracefulShutdown().finally(() => process.exit(0));
};
const onSigterm = (): void => {
  void gracefulShutdown().finally(() => process.exit(0));
};

function installShutdownHandlers(): void {
  if (servers.size === 1) {
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  }
}

function removeShutdownHandlers(): void {
  if (servers.size === 0) {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

// ─────────────────────────── JSON helpers

class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "BodyTooLargeError";
  }
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const contentLength = req.headers["content-length"];
  if (typeof contentLength === "string") {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) throw new RpcValidationError("invalid content length");
    if (declared > maxBytes) {
      req.resume();
      throw new BodyTooLargeError();
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const chunk = c as Buffer;
    size += chunk.byteLength;
    if (size > maxBytes) {
      req.resume();
      throw new BodyTooLargeError();
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function allowedOrigin(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return [...ALLOWED_ORIGINS].find((configuredOrigin) => configuredOrigin === value);
}

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(payload)),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    vary: "Origin",
  };
  if (origin) headers["access-control-allow-origin"] = origin;
  res.writeHead(status, headers);
  res.end(payload);
}

function authorized(req: IncomingMessage, expectedToken: string | undefined): boolean {
  const supplied = req.headers[AUTH_HEADER];
  if (!expectedToken || typeof supplied !== "string") return false;
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(supplied.trim());
  if (!match) return false;
  const token = match[1];
  if (!token) return false;
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function mcpAuthorized(req: IncomingMessage): boolean {
  const mcpToken = process.env.OMNI_SQL_MCP_AUTH_TOKEN;
  if (!mcpToken || mcpToken === process.env.OMNI_SQL_AUTH_TOKEN) return false;
  return authorized(req, mcpToken);
}

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  const err: JsonRpcError = { code, message, ...(data !== undefined ? { data } : {}) };
  return { jsonrpc: "2.0", id, error: err };
}

const INTERNAL_ERROR_MESSAGE = "Internal error";

function logSafe(value: unknown): string {
  return String(value).replace(
    new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, "g"),
    (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function logFailure(method: string, error: unknown, elapsedMs: number): void {
  const name = error instanceof Error ? error.name : "NonError";
  // Deliberately omit error details: NODE_ENV is not guaranteed by release launchers.
  const jdbcDetail = jdbcDebugDetail(method, error);
  console.error(`[omni-sql] rpc failed method=${logSafe(method)} error=${logSafe(name)} elapsedMs=${elapsedMs}${jdbcDetail}`);
}

/** Opt-in local diagnosis for JDBC metadata drivers; never enabled by release launchers. */
function jdbcDebugDetail(method: string, error: unknown): string {
  if (process.env.OMNI_SQL_DEBUG_JDBC !== "1") return "";
  if (method !== "metadata.introspect" && method !== "connection.listSchemas") return "";
  if (!(error instanceof Error) || !error.message) return "";
  return ` detail=${logSafe(redactJdbcError(error.message))}`;
}

function redactJdbcError(message: string): string {
  return message
    .replace(/(jdbc:[^\s]*\/\/[^\s:;@]+:)[^@\s;]+@/gi, "$1***@")
    .replace(/\b(password|pwd)\s*=\s*[^;\s]*/gi, "$1=***");
}

// ─────────────────────────── Method dispatch (typed by RpcRouter)

async function dispatch(method: string, params: unknown, context?: { readonly signal: AbortSignal }): Promise<unknown> {
  switch (method) {
    case "connection.add":
      return handlers["connection.add"](params as never);
    case "connection.list":
      return handlers["connection.list"]();
    case "connection.remove":
      return handlers["connection.remove"](params as never);
    case "connectionGroup.list":
      return handlers["connectionGroup.list"]();
    case "connectionGroup.create":
      return handlers["connectionGroup.create"](params as never);
    case "connectionGroup.rename":
      return handlers["connectionGroup.rename"](params as never);
    case "connectionGroup.delete":
      return handlers["connectionGroup.delete"](params as never);
    case "connection.move":
      return handlers["connection.move"](params as never);
    case "connection.test":
      return handlers["connection.test"](params as never);
    case "connection.status":
      return handlers["connection.status"](params as never);
    case "query.run":
      return handlers["query.run"](params as never);
    case "query.cancel":
      return handlers["query.cancel"](params as never);
    case "query.explain":
      return handlers["query.explain"](params as never);
    case "query.diagnose":
      return handlers["query.diagnose"](params as never);
    case "query.analyzeEditability":
      return handlers["query.analyzeEditability"](params as never);
    case "row.update":
      return handlers["row.update"](params as never);
    case "metadata.introspect":
      return handlers["metadata.introspect"](params as never);
    case "metadata.listRelations":
      return handlers["metadata.listRelations"](params as never);
    case "metadata.listFunctions":
      return handlers["metadata.listFunctions"](params as never);
    case "metadata.listIndexes":
      return handlers["metadata.listIndexes"](params as never);
    case "metadata.getDefinition":
      return handlers["metadata.getDefinition"](params as never);
    case "connection.listSchemas":
      return handlers["connection.listSchemas"](params as never);
    case "completion.get":
      return handlers["completion.get"](params as never);
    case "update.check":
      return handlers["update.check"](params as never);
    case "mcp.ui.next":
      return mcpHandlers["mcp.ui.next"](params as never, context);
    case "mcp.ui.respond":
      return mcpHandlers["mcp.ui.respond"](params as never);
    case "mcp.status":
      return mcpHandlers["mcp.status"]();
    case "mcp.history":
      return mcpHandlers["mcp.history"]();
    default:
      throw new UnknownMethodError(method);
  }
}

class UnknownMethodError extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`unknown method: ${method}`);
    this.name = "UnknownMethodError";
    this.method = method;
  }
}

function trackRequestAbort(
  req: IncomingMessage,
  res: ServerResponse,
): { readonly signal: AbortSignal; readonly cleanup: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  req.once("aborted", abort);
  res.once("close", abort);
  if (req.aborted) abort();
  return {
    signal: controller.signal,
    cleanup: (): void => {
      req.off("aborted", abort);
      res.off("close", abort);
    },
  };
}

// ─────────────────────────── Server

function mcpErrorStatus(code: McpErrorCode): number {
  switch (code) {
    case "invalid": return 400;
    case "unavailable": return 503;
    case "rejected": return 409;
    case "stale": return 409;
    case "timeout": return 504;
  }
}

function sendMcpError(
  res: ServerResponse,
  status: number,
  code: McpHttpErrorCode,
  message: string,
  origin?: string,
): void {
  send(res, status, { error: { code, message } }, origin);
}

export function startServer(port: number = DEFAULT_PORT): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      const headers: Record<string, string> = {
        "access-control-allow-methods": "POST, OPTIONS, GET",
        "access-control-allow-headers": "content-type, authorization",
        vary: "Origin",
      };
      const origin = allowedOrigin(req.headers.origin);
      if (origin) headers["access-control-allow-origin"] = origin;
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const route = req.url;
    const origin = allowedOrigin(req.headers.origin);
    if (route === "/mcp") {
      if (!mcpAuthorized(req)) {
        sendMcpError(res, 401, "unauthorized", "unauthorized", origin);
        return;
      }
      if (req.method !== "POST") {
        sendMcpError(res, 405, "invalid", "method not allowed", origin);
        return;
      }

      let raw: string;
      try {
        raw = await readBody(req, MCP_MAX_HTTP_BODY_BYTES);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          sendMcpError(res, 413, "invalid", "request body too large", origin);
        } else {
          sendMcpError(res, 400, "invalid", "invalid request body", origin);
        }
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        sendMcpError(res, 400, "invalid", "invalid JSON body", origin);
        return;
      }

      try {
        const result = await handleMcpRequest(body);
        send(res, 200, { result }, origin);
      } catch (error) {
        const mcpError = error instanceof McpBridgeError
          ? error
          : new McpBridgeError("unavailable", "MCP request unavailable");
        send(
          res,
          mcpErrorStatus(mcpError.code),
          { error: { code: mcpError.code, message: mcpError.message } },
          origin,
        );
      }
      return;
    }

    const requestUrl = new URL(route ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/health") {
      const challenge = requestUrl.searchParams.get("challenge");
      const healthToken = process.env.OMNI_SQL_HEALTH_TOKEN;
      if (challenge && healthToken && HEALTH_CHALLENGE_RE.test(challenge)) {
        const proof = createHmac("sha256", healthToken).update(challenge).digest("hex");
        send(res, 200, { status: "ok", port, proof }, origin);
        return;
      }
      if (!authorized(req, process.env.OMNI_SQL_AUTH_TOKEN)) {
        send(res, 401, { error: "unauthorized" }, origin);
        return;
      }
      send(res, 200, { status: "ok", port }, origin);
      return;
    }
    if (!authorized(req, process.env.OMNI_SQL_AUTH_TOKEN)) {
      send(res, 401, { error: "unauthorized" }, origin);
      return;
    }
    if (req.method !== "POST" || route !== "/rpc") {
      send(res, 404, { error: "not found" }, origin);
      return;
    }
    let raw: string;
    try {
      raw = await readBody(req, MAX_RPC_BODY_BYTES);
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        send(res, 413, errorResponse(null, -32600, "Request too large"), origin);
        return;
      }
      send(res, 400, errorResponse(null, -32700, "Parse error"), origin);
      return;
    }
    let rpc: JsonRpcRequest;
    try {
      rpc = JSON.parse(raw) as JsonRpcRequest;
    } catch {
      send(res, 400, errorResponse(null, -32700, "Parse error"), origin);
      return;
    }
    const t0 = Date.now();
    const requestAbort = trackRequestAbort(req, res);
    try {
      console.log(`[omni-sql] rpc ← method=${logSafe(rpc.method)}`);
      const result = await dispatch(rpc.method, rpc.params, requestAbort);
      const elapsed = Date.now() - t0;
      // Methods we want to see how long they took even on success; skip
      // query.run and similar that fire on every keystroke.
      if (rpc.method !== "query.run") {
        console.log(`[omni-sql] rpc → method=${logSafe(rpc.method)} ok (${elapsed}ms)`);
      }
      send(res, 200, { jsonrpc: "2.0", id: rpc.id, result } satisfies JsonRpcResponse, origin);
    } catch (e) {
      if (e instanceof UnknownMethodError) {
        send(res, 200, errorResponse(rpc.id, -32601, "Method not found"), origin);
        return;
      }
      logFailure(rpc.method, e, Date.now() - t0);
      const isSafeError = e instanceof RpcValidationError || e instanceof McpBridgeError;
      const message = isSafeError ? e.message : INTERNAL_ERROR_MESSAGE;
      const code = e instanceof McpBridgeError ? -32001 : -32000;
      send(res, 200, errorResponse(rpc.id, code, message), origin);
    } finally {
      requestAbort.cleanup();
    }
  });

  server.listen(port, "127.0.0.1");
  servers.add(server);
  installShutdownHandlers();
  server.once("close", () => {
    servers.delete(server);
    if (servers.size === 0) closeMcpBridge();
    removeShutdownHandlers();
  });
  console.log(`[omni-sql] backend HTTP listening on http://127.0.0.1:${port}/rpc`);
  return server;
}

// Auto-start when executed via `pnpm start`.
// Use pathToFileURL so the comparison works on Windows (argv[1] uses
// backslashes, import.meta.url uses forward slashes and three slashes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
