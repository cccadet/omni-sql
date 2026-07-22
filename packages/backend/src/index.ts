import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
} from "./protocol.ts";
import { closeBackendResources, handlers } from "./handlers.ts";
import { timingSafeEqual } from "node:crypto";

const DEFAULT_PORT = Number(process.env.OMNI_SQL_PORT ?? 41920);
const AUTH_HEADER = "authorization";
const AUTH_TOKEN = process.env.OMNI_SQL_AUTH_TOKEN;
const ALLOWED_ORIGINS = new Set(
  (process.env.OMNI_SQL_ALLOWED_ORIGIN ?? (process.env.NODE_ENV === "production" ? "tauri://localhost" : "http://localhost:1420"))
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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
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
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
  res.writeHead(status, headers);
  res.end(payload);
}

function authorized(req: IncomingMessage): boolean {
  const supplied = req.headers[AUTH_HEADER];
  if (!AUTH_TOKEN || typeof supplied !== "string") return false;
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(supplied.trim());
  if (!match) return false;
  const token = match[1];
  if (!token) return false;
  const expected = Buffer.from(AUTH_TOKEN);
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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

// ─────────────────────────── Method dispatch (typed by RpcRouter)

async function dispatch(method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case "connection.add":
      return handlers["connection.add"](params as never);
    case "connection.list":
      return handlers["connection.list"]();
    case "connection.remove":
      return handlers["connection.remove"](params as never);
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

// ─────────────────────────── Server

export function startServer(port: number = DEFAULT_PORT): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      const headers: Record<string, string> = {
        "access-control-allow-methods": "POST, OPTIONS, GET",
        "access-control-allow-headers": "content-type, authorization",
        vary: "Origin",
      };
      if (req.headers.origin && ALLOWED_ORIGINS.has(req.headers.origin)) {
        headers["access-control-allow-origin"] = req.headers.origin;
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }
    if (!authorized(req)) {
      send(res, 401, { error: "unauthorized" }, req.headers.origin);
      return;
    }
    if (req.url === "/health") {
      send(res, 200, { status: "ok", port }, req.headers.origin);
      return;
    }
    if (req.method !== "POST" || req.url !== "/rpc") {
      send(res, 404, { error: "not found" }, req.headers.origin);
      return;
    }
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (e) {
      send(res, 400, errorResponse(null, -32700, "Parse error", String(e)), req.headers.origin);
      return;
    }
    let rpc: JsonRpcRequest;
    try {
      rpc = JSON.parse(raw) as JsonRpcRequest;
    } catch (e) {
      send(res, 400, errorResponse(null, -32700, "Parse error", String(e)), req.headers.origin);
      return;
    }
    try {
      const result = await dispatch(rpc.method, rpc.params);
      send(res, 200, { jsonrpc: "2.0", id: rpc.id, result } satisfies JsonRpcResponse, req.headers.origin);
    } catch (e) {
      if (e instanceof UnknownMethodError) {
        send(res, 200, errorResponse(rpc.id, -32601, e.message), req.headers.origin);
        return;
      }
      console.error(`[omni-sql] ${rpc.method} failed:`, e);
      send(res, 200, errorResponse(rpc.id, -32000, (e as Error).message, (e as Error).stack), req.headers.origin);
    }
  });

  server.listen(port, "127.0.0.1");
  servers.add(server);
  installShutdownHandlers();
  server.once("close", () => {
    servers.delete(server);
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
