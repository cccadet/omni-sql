import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
} from "./protocol.ts";
import { handlers } from "./handlers.ts";

const DEFAULT_PORT = Number(process.env.OMNI_SQL_PORT ?? 41920);

// ─────────────────────────── JSON helpers

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
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
    case "query.run":
      return handlers["query.run"](params as never);
    case "query.cancel":
      return handlers["query.cancel"](params as never);
    case "query.explain":
      return handlers["query.explain"](params as never);
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
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS, GET",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return;
    }
    if (req.url === "/health") {
      send(res, 200, { status: "ok", port });
      return;
    }
    if (req.method !== "POST" || req.url !== "/rpc") {
      send(res, 404, { error: "not found" });
      return;
    }
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (e) {
      send(res, 400, errorResponse(null, -32700, "Parse error", String(e)));
      return;
    }
    let rpc: JsonRpcRequest;
    try {
      rpc = JSON.parse(raw) as JsonRpcRequest;
    } catch (e) {
      send(res, 400, errorResponse(null, -32700, "Parse error", String(e)));
      return;
    }
    try {
      const result = await dispatch(rpc.method, rpc.params);
      send(res, 200, { jsonrpc: "2.0", id: rpc.id, result } satisfies JsonRpcResponse);
    } catch (e) {
      if (e instanceof UnknownMethodError) {
        send(res, 200, errorResponse(rpc.id, -32601, e.message));
        return;
      }
      console.error(`[omni-sql] ${rpc.method} failed:`, e);
      send(res, 200, errorResponse(rpc.id, -32000, (e as Error).message, (e as Error).stack));
    }
  });

  server.listen(port, "127.0.0.1");
  console.log(`[omni-sql] backend HTTP listening on http://127.0.0.1:${port}/rpc`);
  return server;
}

// Auto-start when executed via `pnpm start`.
// Use pathToFileURL so the comparison works on Windows (argv[1] uses
// backslashes, import.meta.url uses forward slashes and three slashes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}