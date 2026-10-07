import type {
  McpHistoryResult,
  McpHttpStatus,
  McpHttpStartParams,
  McpExecuteApproval,
  McpToolResultByName,
  QueryResult,
  McpHttpRequest,
  McpToolArgsByName,
  McpToolName,
  McpUiNextParams,
  McpUiNextResult,
  McpUiRespondParams,
  McpUiRespondResult,
} from "@omni-sql/ts-types";
import {
  MCP_MAX_ARGUMENT_BYTES,
  McpBridge,
  McpBridgeError,
  isMcpToolName,
  validateSafePayload,
} from "./mcp-bridge.ts";
import {
  MCP_MAX_ERROR_MESSAGE_BYTES,
  MCP_MAX_BRIDGE_RESULT_BYTES,
  MCP_DEFAULT_QUERY_LIMIT,
  MCP_MAX_QUERY_LIMIT,
  MCP_MAX_LISTENER_ID_BYTES,
  MCP_MAX_REQUEST_ID_BYTES,
  MCP_MAX_RATIONALE_BYTES,
  MCP_MAX_SQL_BYTES,
  MCP_MAX_STRING_BYTES,
} from "@omni-sql/ts-types";
import type {
  McpUiRouter,
  McpUiRequestContext,
} from "./protocol.ts";

import type { Server } from "node:http";
import { startMcpHttpServer, closeStreamableHttpServer, getHttpSessionCount } from "@omni-sql/mcp-server";
import { handlers } from "./handlers.ts";

let httpServer: Server | undefined;
let startingHttp = false;
export async function closeMcpHttp(): Promise<void> {
  const server = httpServer;
  httpServer = undefined;
  if (server) await closeStreamableHttpServer(server);
}
function httpStatus(): McpHttpStatus {
  const address = httpServer?.address();
  return { endpoint: address && typeof address !== "string" ? `http://127.0.0.1:${address.port}/mcp` : null, sessions: httpServer ? getHttpSessionCount(httpServer) : 0 };
}

/** Query values are data, not connection configuration: preserve positional cells. */
export function boundMcpQueryResult(connectionId: string, result: QueryResult, limit = MCP_MAX_QUERY_LIMIT): McpToolResultByName["executeSql"] {
  const output: McpToolResultByName["executeSql"] = { connectionId, columns: result.columns, rows: [], ...(result.rowsAffected === undefined ? {} : { rowsAffected: result.rowsAffected }), rowsMoreAvailable: result.rowsMoreAvailable, elapsedMs: result.elapsedMs, truncated: result.rowsMoreAvailable };
  const rows: unknown[][] = [];
  let bytes = Buffer.byteLength(JSON.stringify(output));
  if (bytes > MCP_MAX_BRIDGE_RESULT_BYTES) throw new McpBridgeError("invalid", "SQL columns exceed the MCP response limit");
  for (const source of result.rows) {
    const row = source.map((cell) => cell === null || typeof cell === "string" || typeof cell === "boolean" || (typeof cell === "number" && Number.isFinite(cell)) ? cell : typeof cell === "bigint" ? cell.toString() : cell === undefined ? null : JSON.stringify(cell));
    const rowBytes = Buffer.byteLength(JSON.stringify(row)) + (rows.length ? 1 : 0);
    if (bytes + rowBytes > MCP_MAX_BRIDGE_RESULT_BYTES - 32 || rows.length >= limit) return { ...output, rows, rowsMoreAvailable: true, truncated: true };
    rows.push(row);
    bytes += rowBytes;
  }
  return { ...output, rows };
}

export const mcpBridge = new McpBridge();

export function closeMcpBridge(): void {
  mcpBridge.close();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new McpBridgeError("invalid", `${label} must be an object`);
  return value;
}

function requireText(value: unknown, label: string, maxBytes = MCP_MAX_STRING_BYTES): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new McpBridgeError("invalid", `${label} must be a non-empty string within size limit`);
  }
  return value;
}

function requireExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new McpBridgeError("invalid", `${label} contains unknown fields`);
  }
}

function validateToolArgs<K extends McpToolName>(tool: K, value: unknown): McpToolArgsByName[K] {
  const args = requireRecord(value, "args");
  validateSafePayload(args, MCP_MAX_ARGUMENT_BYTES, "MCP args");

  if (tool === "getActiveSql" || tool === "getActiveConnectionContext" || tool === "getLatestSqlExecutionError") {
    requireExactKeys(args, [], tool);
  } else if (tool === "getSchemaSummary") {
    requireExactKeys(args, ["schema", "table", "offset", "limit"], tool);
    if (args.schema !== undefined) requireText(args.schema, "schema");
    if (args.table !== undefined) requireText(args.table, "table");
    if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || Number(args.offset) < 0)) throw new McpBridgeError("invalid", "invalid schema offset");
    if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 100)) throw new McpBridgeError("invalid", "invalid schema limit");
  } else if (tool === "executeSql") {
    requireExactKeys(args, ["sql", "limit"], tool);
    requireText(args.sql, "executeSql.sql", MCP_MAX_SQL_BYTES);
    if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > MCP_MAX_QUERY_LIMIT)) throw new McpBridgeError("invalid", "invalid SQL row limit");
  } else if (tool === "getTableIndexes") {
    requireExactKeys(args, ["schema", "table"], tool);
    requireText(args.schema, "getTableIndexes.schema");
    requireText(args.table, "getTableIndexes.table");
  } else if (tool === "explainSql") {
    requireExactKeys(args, ["sql"], tool);
    requireText(args.sql, "explainSql.sql", MCP_MAX_SQL_BYTES);
  } else if (tool === "proposeSqlEdit") {
    requireExactKeys(args, ["sql", "rationale"], tool);
    requireText(args.sql, "proposeSqlEdit.sql", MCP_MAX_SQL_BYTES);
    requireText(args.rationale, "proposeSqlEdit.rationale", MCP_MAX_RATIONALE_BYTES);
  }
  return args as McpToolArgsByName[K];
}

export function validateMcpRequest(value: unknown): McpHttpRequest {
  const body = requireRecord(value, "MCP request");
  const keys = Object.keys(body).sort((left, right) => left.localeCompare(right));
  if (keys.length !== 2 || keys[0] !== "args" || keys[1] !== "tool") {
    throw new McpBridgeError("invalid", "MCP request must contain only tool and args");
  }
  if (!isMcpToolName(body.tool)) throw new McpBridgeError("invalid", "unsupported MCP tool");
  return { tool: body.tool, args: validateToolArgs(body.tool, body.args) } as McpHttpRequest;
}

function validateNextParams(value: unknown): McpUiNextParams | undefined {
  if (value === undefined) return undefined;
  const params = requireRecord(value, "mcp.ui.next params");
  const allowed = new Set(["listenerId", "waitMs"]);
  if (Object.keys(params).some((key) => !allowed.has(key))) {
    throw new McpBridgeError("invalid", "invalid mcp.ui.next params");
  }
  if (params.listenerId !== undefined) requireText(params.listenerId, "listenerId", MCP_MAX_LISTENER_ID_BYTES);
  return params as McpUiNextParams;
}

function validateBridgeResponse(value: unknown): McpUiRespondParams {
  const response = requireRecord(value, "mcp.ui.respond params");
  const allowed = new Set(["id", "ok", "result", "error", "listenerId"]);
  if (Object.keys(response).some((key) => !allowed.has(key))) {
    throw new McpBridgeError("invalid", "invalid mcp.ui.respond params");
  }
  const id = requireText(response.id, "response.id", MCP_MAX_REQUEST_ID_BYTES);
  if (typeof response.ok !== "boolean") throw new McpBridgeError("invalid", "response.ok must be boolean");
  if (response.ok) {
    if (response.error !== undefined) throw new McpBridgeError("invalid", "successful response cannot contain error");
    if (!("result" in response)) throw new McpBridgeError("invalid", "successful response must contain result");
  } else {
    if (response.result !== undefined) throw new McpBridgeError("invalid", "failed response cannot contain result");
    const error = requireRecord(response.error, "response.error");
    requireExactKeys(error, ["code", "message"], "response.error");
    requireText(error.message, "response.error.message", MCP_MAX_ERROR_MESSAGE_BYTES);
    if (!["invalid", "unavailable", "rejected", "stale", "timeout"].includes(String(error.code))) {
      throw new McpBridgeError("invalid", "response.error.code is invalid");
    }
    if (!("error" in response)) throw new McpBridgeError("invalid", "failed response must contain error");
  }
  if (response.listenerId !== undefined) requireText(response.listenerId, "listenerId", MCP_MAX_LISTENER_ID_BYTES);
  return { ...response, id, ok: response.ok } as McpUiRespondParams;
}

export async function handleMcpRequest(value: unknown, signal?: AbortSignal): Promise<unknown> {
  const request = validateMcpRequest(value);
  return mcpBridge.submit(request.tool, request.args, signal);
}

export const mcpHandlers: McpUiRouter = {
  async "mcp.http.status"() { return httpStatus(); },
  async "mcp.http.stop"() {
    if (startingHttp) throw new McpBridgeError("rejected", "HTTP listener is starting");
    await closeMcpHttp();
    return httpStatus();
  },
  async "mcp.http.start"(value: McpHttpStartParams) {
    const params = requireRecord(value, "HTTP options");
    requireExactKeys(params, ["token", "port", "allowedOrigins"], "HTTP options");
    const token = requireText(params.token, "HTTP token", 4_096);
    if (/\s/u.test(token) || token.length < 16 || token === process.env.OMNI_SQL_AUTH_TOKEN || token === process.env.OMNI_SQL_MCP_AUTH_TOKEN) throw new McpBridgeError("invalid", "Use a separate HTTP token with at least 16 characters and no whitespace");
    const port = params.port ?? 41922;
    if (!Number.isSafeInteger(port) || Number(port) < 0 || Number(port) > 65535) throw new McpBridgeError("invalid", "invalid HTTP port");
    const origins = params.allowedOrigins ?? [];
    if (!Array.isArray(origins) || origins.length > 16 || origins.some((item) => {
      if (typeof item !== "string") return true;
      try { const url = new URL(item); return !/^https?:$/.test(url.protocol) || url.origin !== item || Boolean(url.username || url.password); } catch { return true; }
    })) throw new McpBridgeError("invalid", "invalid allowed origins");
    if (httpServer || startingHttp) throw new McpBridgeError("rejected", "HTTP listener is already running or starting");
    const backendToken = process.env.OMNI_SQL_MCP_AUTH_TOKEN;
    if (!backendToken || backendToken === process.env.OMNI_SQL_AUTH_TOKEN) throw new McpBridgeError("unavailable", "MCP backend authentication is unavailable");
    startingHttp = true;
    try {
      httpServer = await startMcpHttpServer({ endpoint: `http://127.0.0.1:${process.env.OMNI_SQL_PORT ?? 41920}/mcp`, token: backendToken, pid: process.pid, startNonce: "desktop-http" }, { port: Number(port), httpToken: token, allowedOrigins: origins, allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, ...origins.map((origin: string) => new URL(origin).host)] });
      return httpStatus();
    } finally { startingHttp = false; }
  },
  async "mcp.ui.release"(value: { listenerId: string }) {
    const params = requireRecord(value, "release params");
    requireExactKeys(params, ["listenerId"], "release params");
    return mcpBridge.release(requireText(params.listenerId, "listenerId", MCP_MAX_LISTENER_ID_BYTES));
  },
  async "mcp.ui.execute"(value: McpExecuteApproval) {
    const params = requireRecord(value, "execution approval");
    requireExactKeys(params, ["id", "listenerId", "connectionId"], "execution approval");
    const id = requireText(params.id, "id", MCP_MAX_REQUEST_ID_BYTES);
    const listenerId = requireText(params.listenerId, "listenerId", MCP_MAX_LISTENER_ID_BYTES);
    const connectionId = requireText(params.connectionId, "connectionId", 256);
    const { args, signal } = mcpBridge.approveExecution(id, listenerId);
    const result = await handlers["query.run"]({ connectionId, sql: args.sql, limit: args.limit ?? MCP_DEFAULT_QUERY_LIMIT, executionRiskAccepted: true }, signal);
    return boundMcpQueryResult(connectionId, result, args.limit ?? MCP_DEFAULT_QUERY_LIMIT);
  },
  async "mcp.ui.next"(params?: McpUiNextParams, context?: McpUiRequestContext): Promise<McpUiNextResult> {
    return mcpBridge.next(validateNextParams(params), context?.signal);
  },

  async "mcp.ui.respond"(params: McpUiRespondParams): Promise<McpUiRespondResult> {
    const response = validateBridgeResponse(params);
    return mcpBridge.respond(response, response.listenerId);
  },

  async "mcp.status"() {
    return mcpBridge.status();
  },

  async "mcp.history"(): Promise<McpHistoryResult> {
    return mcpBridge.history();
  },
};
