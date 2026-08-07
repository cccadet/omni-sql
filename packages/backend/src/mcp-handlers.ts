import type {
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
  MCP_MAX_CONNECTION_ID_BYTES,
  MCP_MAX_ERROR_MESSAGE_BYTES,
  MCP_MAX_LISTENER_ID_BYTES,
  MCP_MAX_REQUEST_ID_BYTES,
  MCP_MAX_RATIONALE_BYTES,
  MCP_MAX_SQL_BYTES,
  MCP_MAX_STRING_BYTES,
  MCP_MAX_TITLE_BYTES,
} from "@omni-sql/ts-types";
import type {
  McpUiRouter,
  McpUiRequestContext,
} from "./protocol.ts";

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

  if (tool === "getActiveSql" || tool === "getActiveConnectionContext") {
    requireExactKeys(args, [], tool);
  } else if (tool === "getSchemaSummary") {
    requireExactKeys(args, [], tool);
  } else if (tool === "openSqlTab") {
    requireExactKeys(args, ["title", "sql", "connectionId"], tool);
    requireText(args.title, "openSqlTab.title", MCP_MAX_TITLE_BYTES);
    requireText(args.sql, "openSqlTab.sql", MCP_MAX_SQL_BYTES);
    if (args.connectionId !== undefined) {
      requireText(args.connectionId, "openSqlTab.connectionId", MCP_MAX_CONNECTION_ID_BYTES);
    }
  } else if (tool === "proposeSqlEdit") {
    requireExactKeys(args, ["sql", "rationale"], tool);
    requireText(args.sql, "proposeSqlEdit.sql", MCP_MAX_SQL_BYTES);
    requireText(args.rationale, "proposeSqlEdit.rationale", MCP_MAX_RATIONALE_BYTES);
  }
  return args as McpToolArgsByName[K];
}

export function validateMcpRequest(value: unknown): McpHttpRequest {
  const body = requireRecord(value, "MCP request");
  const keys = Object.keys(body).sort();
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

export async function handleMcpRequest(value: unknown): Promise<unknown> {
  const request = validateMcpRequest(value);
  return mcpBridge.submit(request);
}

export const mcpHandlers: McpUiRouter = {
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
};
