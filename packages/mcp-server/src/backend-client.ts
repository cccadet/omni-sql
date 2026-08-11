import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import type { McpHttpRequest, McpToolName } from "@omni-sql/ts-types";
import { MCP_MAX_BRIDGE_RESULT_BYTES } from "@omni-sql/ts-types";

export const MAX_DESCRIPTOR_BYTES = 16 * 1024;
export const MAX_ENDPOINT_LENGTH = 2_048;
export const MAX_TOKEN_LENGTH = 4_096;
export const MAX_SQL_BYTES = 32 * 1024;
export const MAX_TITLE_BYTES = 256;
export const MAX_RATIONALE_BYTES = 8 * 1024;
export const MAX_CONNECTION_ID_BYTES = 256;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_RESPONSE_ENVELOPE_BYTES = 2 * 1024;
export const MAX_RESPONSE_BYTES = MCP_MAX_BRIDGE_RESULT_BYTES + MAX_RESPONSE_ENVELOPE_BYTES;
export const BACKEND_TIMEOUT_MS = 125_000;

const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export const runtimeDescriptorSchema = z.object({
  endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH),
  token: z.string().min(1).max(MAX_TOKEN_LENGTH),
  pid: z.number().int().positive().max(0xffff_ffff),
  startNonce: z.string().min(1).max(256),
}).strict();

export type RuntimeDescriptor = z.infer<typeof runtimeDescriptorSchema>;

export const mcpToolNames = [
  "getActiveSql",
  "getActiveConnectionContext",
  "getSchemaSummary",
  "getLatestSqlExecutionError",
  "proposeSqlEdit",
] as const satisfies readonly McpToolName[];

export type { McpToolName } from "@omni-sql/ts-types";

export type BackendToolRequest = McpHttpRequest;

export type BackendErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "too_large"
  | "rate_limited"
  | "unavailable"
  | "backend_error";

export interface BackendErrorPayload {
  code: BackendErrorCode;
  message: string;
  status?: number;
}

export class BackendClientError extends Error {
  readonly code: BackendErrorCode;
  readonly status?: number;

  constructor(payload: BackendErrorPayload) {
    super(payload.message);
    this.name = "BackendClientError";
    this.code = payload.code;
    this.status = payload.status;
  }
}

export function normalizeMcpEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("descriptor endpoint must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("descriptor endpoint must use http or https");
  }
  if (!localHosts.has(url.hostname.toLowerCase())) {
    throw new Error("descriptor endpoint must target the local backend");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("descriptor endpoint must not contain credentials, query, or fragment");
  }
  if (url.pathname !== "" && url.pathname !== "/" && url.pathname !== "/mcp") {
    throw new Error("descriptor endpoint must target the backend root or /mcp");
  }

  url.pathname = "/mcp";
  return url.href;
}

export function parseRuntimeDescriptor(value: unknown): RuntimeDescriptor {
  const parsed = runtimeDescriptorSchema.safeParse(value);
  if (!parsed.success) throw new Error("descriptor must contain exactly endpoint, token, pid, and startNonce");
  normalizeMcpEndpoint(parsed.data.endpoint);
  return parsed.data;
}

export async function readRuntimeDescriptor(descriptorPath: string): Promise<RuntimeDescriptor> {
  if (!descriptorPath || descriptorPath.length > MAX_ENDPOINT_LENGTH) {
    throw new Error("descriptor path is missing or too long");
  }

  const metadata = await stat(descriptorPath);
  if (!metadata.isFile()) throw new Error("descriptor path must be a file");
  if (metadata.size > MAX_DESCRIPTOR_BYTES) throw new Error("descriptor is too large");

  let raw: string;
  try {
    raw = await readFile(descriptorPath, "utf8");
  } catch {
    throw new Error("descriptor could not be read");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_DESCRIPTOR_BYTES) {
    throw new Error("descriptor is too large");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("descriptor is not valid JSON");
  }
  return parseRuntimeDescriptor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedMessage(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "backend request failed";
  return value.length > 1_024 ? `${value.slice(0, 1_024)}…` : value;
}

function codeFromStatus(status: number): BackendErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "backend_error";
}

function codeFromValue(value: unknown, status: number): BackendErrorCode {
  if (typeof value !== "string") return codeFromStatus(status);
  const normalized = value.toLowerCase();
  if (normalized.includes("unauthor")) return "unauthorized";
  if (normalized.includes("invalid") || normalized.includes("validation")) return "invalid_request";
  if (normalized.includes("not_found") || normalized.includes("not found")) return "not_found";
  if (normalized.includes("conflict") || normalized.includes("stale")) return "conflict";
  if (normalized.includes("too_large") || normalized.includes("too large")) return "too_large";
  if (normalized.includes("rate")) return "rate_limited";
  if (normalized.includes("unavailable") || normalized.includes("timeout")) return "unavailable";
  return codeFromStatus(status);
}

function errorFromPayload(payload: unknown, status: number): BackendClientError {
  const candidate = isRecord(payload) && "error" in payload ? payload.error : payload;
  if (isRecord(candidate)) {
    return new BackendClientError({
      code: codeFromValue(candidate.code, status),
      message: boundedMessage(candidate.message),
      status,
    });
  }
  if (typeof candidate === "string") {
    return new BackendClientError({ code: codeFromStatus(status), message: boundedMessage(candidate), status });
  }
  return new BackendClientError({ code: codeFromStatus(status), message: "backend request failed", status });
}

async function readResponseJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      await cancelResponseBody(response);
      throw new BackendClientError({ code: "backend_error", message: "backend returned invalid content length", status: response.status });
    }
    if (declared > MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new BackendClientError({ code: "too_large", message: "backend response is too large", status: response.status });
    }
  }

  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new BackendClientError({ code: "too_large", message: "backend response is too large", status: response.status });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new BackendClientError({ code: "backend_error", message: "backend returned invalid JSON", status: response.status });
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Best effort: size check already prevents retaining response data.
  }
}

function unwrapResponse<T>(payload: unknown, status: number): T {
  if (isRecord(payload)) {
    if (payload.ok === false || "error" in payload) throw errorFromPayload(payload, status);
    if ("result" in payload) return payload.result as T;
    if (payload.ok === true && "data" in payload) return payload.data as T;
  }
  return payload as T;
}

export class BackendMcpClient {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    descriptor: RuntimeDescriptor,
    options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.url = normalizeMcpEndpoint(descriptor.endpoint);
    this.token = descriptor.token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? BACKEND_TIMEOUT_MS;
  }

  private readonly timeoutMs: number;

  async call<T>(tool: McpToolName, args: Record<string, unknown>): Promise<T> {
    if (!mcpToolNames.includes(tool)) throw new Error("unsupported MCP tool");
    const body = { tool, args } as BackendToolRequest;
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
      throw new BackendClientError({ code: "too_large", message: "backend request is too large" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: serialized,
        signal: controller.signal,
      });
      const payload = await readResponseJson(response);
      if (!response.ok) throw errorFromPayload(payload, response.status);
      return unwrapResponse<T>(payload, response.status);
    } catch (error) {
      if (error instanceof BackendClientError) throw error;
      if (controller.signal.aborted) {
        throw new BackendClientError({ code: "unavailable", message: "backend request timed out" });
      }
      throw new BackendClientError({ code: "unavailable", message: "backend is unavailable" });
    } finally {
      clearTimeout(timeout);
    }
  }
}
