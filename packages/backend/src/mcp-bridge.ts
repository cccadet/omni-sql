import { randomUUID } from "node:crypto";
import type {
  McpBridgeRequest,
  McpBridgeResponse,
  McpErrorCode,
  McpHistoryEntry,
  McpHistoryResult,
  McpStatusResult,
  McpToolArgs,
  McpToolArgsByName,
  McpToolName,
  McpToolRequest,
  McpToolResultByName,
  McpUiNextParams,
  McpUiNextResult,
  McpUiRespondResult,
} from "@omni-sql/ts-types";
import {
  MCP_LISTENER_LEASE_MS as SHARED_MCP_LISTENER_LEASE_MS,
  MCP_MAX_ARGUMENT_BYTES as SHARED_MCP_MAX_ARGUMENT_BYTES,
  MCP_MAX_BRIDGE_RESULT_BYTES as SHARED_MCP_MAX_BRIDGE_RESULT_BYTES,
  MCP_MAX_HISTORY_ENTRIES as SHARED_MCP_MAX_HISTORY_ENTRIES,
  MCP_MAX_ERROR_MESSAGE_BYTES as SHARED_MCP_MAX_ERROR_MESSAGE_BYTES,
  MCP_MAX_LISTENER_ID_BYTES as SHARED_MCP_MAX_LISTENER_ID_BYTES,
  MCP_MAX_CONNECTION_ID_BYTES as SHARED_MCP_MAX_CONNECTION_ID_BYTES,
  MCP_MAX_SQL_BYTES as SHARED_MCP_MAX_SQL_BYTES,
  MCP_MAX_TITLE_BYTES as SHARED_MCP_MAX_TITLE_BYTES,
  MCP_MAX_QUEUE_SIZE as SHARED_MCP_MAX_QUEUE_SIZE,
  MCP_MAX_STRING_BYTES as SHARED_MCP_MAX_STRING_BYTES,
  MCP_MAX_UI_WAIT_MS as SHARED_MCP_MAX_UI_WAIT_MS,
  MCP_REQUEST_TIMEOUT_MS as SHARED_MCP_REQUEST_TIMEOUT_MS,
} from "@omni-sql/ts-types";

export const MCP_REQUEST_TIMEOUT_MS = SHARED_MCP_REQUEST_TIMEOUT_MS;
export const MCP_MAX_QUEUE_SIZE = SHARED_MCP_MAX_QUEUE_SIZE;
export const MCP_MAX_UI_WAIT_MS = SHARED_MCP_MAX_UI_WAIT_MS;
export const MCP_MAX_BRIDGE_RESULT_BYTES = SHARED_MCP_MAX_BRIDGE_RESULT_BYTES;
export const MCP_MAX_ARGUMENT_BYTES = SHARED_MCP_MAX_ARGUMENT_BYTES;
export const MCP_MAX_STRING_BYTES = SHARED_MCP_MAX_STRING_BYTES;
export const MCP_MAX_ERROR_MESSAGE_BYTES = SHARED_MCP_MAX_ERROR_MESSAGE_BYTES;
export const MCP_MAX_LISTENER_ID_BYTES = SHARED_MCP_MAX_LISTENER_ID_BYTES;
export const MCP_MAX_CONNECTION_ID_BYTES = SHARED_MCP_MAX_CONNECTION_ID_BYTES;
export const MCP_MAX_SQL_BYTES = SHARED_MCP_MAX_SQL_BYTES;
export const MCP_MAX_TITLE_BYTES = SHARED_MCP_MAX_TITLE_BYTES;
export const MCP_MAX_HISTORY_ENTRIES = SHARED_MCP_MAX_HISTORY_ENTRIES;
export const MCP_LISTENER_LEASE_MS = SHARED_MCP_LISTENER_LEASE_MS;

export const MCP_TOOL_NAMES: readonly McpToolName[] = [
  "getActiveSql",
  "getActiveConnectionContext",
  "getSchemaSummary",
  "getLatestSqlExecutionError",
  "proposeSqlEdit",
];

const SENSITIVE_KEY = /^(?:password|passwordslot|endpoint|user|options|secret|credential|token|dsn|connectionstring)$/i;
const MCP_DIALECT_NAMES = new Set([
  "postgres",
  "mysql",
  "mariadb",
  "sqlserver",
  "oracle",
  "jdbc-generic",
  "odbc",
]);

export class McpBridgeError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpBridgeError";
    this.code = code;
  }
}

interface PendingRequest {
  readonly request: McpBridgeRequest;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: McpBridgeError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  state: "queued" | "delivered";
  deliveredTo?: string;
}

interface WaitingListener {
  readonly listenerId: string;
  readonly resolve: (result: McpUiNextResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly abortCleanup: () => void;
}

/** Mutable mirror of the readonly wire type so settle can update entries in place. */
type MutableHistoryEntry = { -readonly [K in keyof McpHistoryEntry]: McpHistoryEntry[K] };

export interface McpBridgeOptions {
  maxQueueSize?: number;
  timeoutMs?: number;
  listenerTtlMs?: number;
  maxUiWaitMs?: number;
  idFactory?: () => string;
}

export function isMcpToolName(value: unknown): value is McpToolName {
  return typeof value === "string" && MCP_TOOL_NAMES.includes(value as McpToolName);
}

function byteLength(value: unknown): number {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    throw new McpBridgeError("invalid", "payload is not JSON serializable");
  }
  return Buffer.byteLength(json, "utf8");
}

/** Validate JSON payload shape without retaining attacker-controlled objects. */
export function validateSafePayload(value: unknown, maxBytes: number, label: string): void {
  if (byteLength(value) > maxBytes) {
    throw new McpBridgeError("invalid", `${label} is too large`);
  }

  const seen = new WeakSet<object>();
  const visit = (current: unknown, depth: number): void => {
    if (depth > 20) throw new McpBridgeError("invalid", `${label} is too deeply nested`);
    if (typeof current === "string") {
      if (Buffer.byteLength(current, "utf8") > MCP_MAX_STRING_BYTES) {
        throw new McpBridgeError("invalid", `${label} contains an oversized string`);
      }
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (seen.has(current)) throw new McpBridgeError("invalid", `${label} contains a cycle`);
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > 1_000) throw new McpBridgeError("invalid", `${label} contains too many items`);
      for (const item of current) visit(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(current)) {
      if (SENSITIVE_KEY.test(key)) {
        throw new McpBridgeError("invalid", `${label} contains a restricted field`);
      }
      visit(item, depth + 1);
    }
  };
  visit(value, 0);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resultObject(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new McpBridgeError("invalid", `${label} must be an object`);
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new McpBridgeError("invalid", `${label} contains unknown fields`);
  }
  if (requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new McpBridgeError("invalid", `${label} is missing required fields`);
  }
  return value;
}

function resultString(value: unknown, label: string, maxBytes = MCP_MAX_STRING_BYTES, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new McpBridgeError("invalid", `${label} must be a string within size limit`);
  }
  return value;
}

function resultArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new McpBridgeError("invalid", `${label} must be an array`);
  return value;
}

function resultRelationKind(value: unknown, label: string): "table" | "view" {
  const kind = resultString(value, label);
  if (kind !== "table" && kind !== "view") {
    throw new McpBridgeError("invalid", "getSchemaSummary relation kind is invalid");
  }
  return kind;
}

function resultDialect(value: unknown, label: string): McpToolResultByName["getActiveConnectionContext"]["dialect"] {
  const dialect = resultString(value, label);
  if (!MCP_DIALECT_NAMES.has(dialect)) {
    throw new McpBridgeError("invalid", `${label} is invalid`);
  }
  return dialect as McpToolResultByName["getActiveConnectionContext"]["dialect"];
}

function validateActiveSqlResult(value: unknown): McpToolResultByName["getActiveSql"] {
  const result = resultObject(value, ["sql", "dialect"], ["sql", "dialect"], "getActiveSql result");
  return {
    sql: resultString(result.sql, "getActiveSql.sql", MCP_MAX_SQL_BYTES, true),
    dialect: result.dialect === null ? null : resultDialect(result.dialect, "getActiveSql.dialect"),
  };
}

function validateActiveConnectionContextResult(value: unknown): McpToolResultByName["getActiveConnectionContext"] {
  const result = resultObject(
    value,
    ["connectionId", "label", "dialect"],
    ["connectionId", "label", "dialect"],
    "getActiveConnectionContext result",
  );
  return {
    connectionId: resultString(result.connectionId, "getActiveConnectionContext.connectionId", MCP_MAX_CONNECTION_ID_BYTES),
    label: resultString(result.label, "getActiveConnectionContext.label", MCP_MAX_TITLE_BYTES),
    dialect: resultDialect(result.dialect, "getActiveConnectionContext.dialect"),
  };
}

function validateSchemaSummaryResult(value: unknown): McpToolResultByName["getSchemaSummary"] {
  const result = resultObject(value, ["connectionId", "schemas"], ["connectionId", "schemas"], "getSchemaSummary result");
  const schemas = resultArray(result.schemas, "getSchemaSummary.schemas").map((schemaValue, schemaIndex) => {
    const schema = resultObject(
      schemaValue,
      ["name", "relations"],
      ["name", "relations"],
      `getSchemaSummary.schemas[${schemaIndex}]`,
    );
    const relations = resultArray(schema.relations, `getSchemaSummary.schemas[${schemaIndex}].relations`)
      .map((relationValue, relationIndex) => {
        const relation = resultObject(
          relationValue,
          ["name", "kind", "columns"],
          ["name", "kind", "columns"],
          `getSchemaSummary.schemas[${schemaIndex}].relations[${relationIndex}]`,
        );
        const kind = resultRelationKind(
          relation.kind,
          `getSchemaSummary.schemas[${schemaIndex}].relations[${relationIndex}].kind`,
        );
        const columns = resultArray(
          relation.columns,
          `getSchemaSummary.schemas[${schemaIndex}].relations[${relationIndex}].columns`,
        ).map((columnValue, columnIndex) => {
          const column = resultObject(
            columnValue,
            ["name", "dataType"],
            ["name", "dataType"],
            `getSchemaSummary.schemas[${schemaIndex}].relations[${relationIndex}].columns[${columnIndex}]`,
          );
          return {
            name: resultString(column.name, "schema column name"),
            dataType: resultString(column.dataType, "schema column dataType"),
          };
        });
        return {
          name: resultString(relation.name, "schema relation name"),
          kind,
          columns,
        };
      });
    return {
      name: resultString(schema.name, "schema name"),
      relations,
    };
  });
  return {
    connectionId: resultString(result.connectionId, "getSchemaSummary.connectionId", MCP_MAX_CONNECTION_ID_BYTES),
    schemas,
  };
}


function validateProposalResult(value: unknown): McpToolResultByName["proposeSqlEdit"] {
  const result = resultObject(value, ["approved"], ["approved"], "proposeSqlEdit result");
  if (typeof result.approved !== "boolean") {
    throw new McpBridgeError("invalid", "proposeSqlEdit.approved must be boolean");
  }
  return { approved: result.approved };
}

function validateExecutionErrorResult(value: unknown): McpToolResultByName["getLatestSqlExecutionError"] {
  const result = resultObject(value, ["error"], ["error"], "getLatestSqlExecutionError result");
  if (result.error === null) return { error: null };
  const error = resultObject(result.error, ["message", "code", "position"], ["message"], "getLatestSqlExecutionError.error");
  const message = resultString(error.message, "getLatestSqlExecutionError.error.message", MCP_MAX_ERROR_MESSAGE_BYTES);
  let code: string | undefined;
  if (error.code !== undefined) code = resultString(error.code, "getLatestSqlExecutionError.error.code", MCP_MAX_ERROR_MESSAGE_BYTES);

  let position: { start: number; end?: number } | undefined;
  if (error.position !== undefined) {
    const rawPosition = resultObject(
      error.position,
      ["start", "end"],
      ["start"],
      "getLatestSqlExecutionError.error.position",
    );
    const start = rawPosition.start;
    const end = rawPosition.end;
    if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0) {
      throw new McpBridgeError("invalid", "getLatestSqlExecutionError.error.position.start is invalid");
    }
    if (end !== undefined &&
      (typeof end !== "number" || !Number.isSafeInteger(end) || end < start)) {
      throw new McpBridgeError("invalid", "getLatestSqlExecutionError.error.position.end is invalid");
    }
    position = {
      start,
      ...(end === undefined ? {} : { end }),
    };
  }

  return {
    error: {
      message,
      ...(code === undefined ? {} : { code }),
      ...(position === undefined ? {} : { position }),
    },
  };
}

export function validateMcpToolResult<K extends McpToolName>(
  tool: K,
  value: unknown,
): McpToolResultByName[K] {
  validateSafePayload(value, MCP_MAX_BRIDGE_RESULT_BYTES, "MCP result");
  switch (tool) {
    case "getActiveSql":
      return validateActiveSqlResult(value) as McpToolResultByName[K];
    case "getActiveConnectionContext":
      return validateActiveConnectionContextResult(value) as McpToolResultByName[K];
    case "getSchemaSummary":
      return validateSchemaSummaryResult(value) as McpToolResultByName[K];
    case "getLatestSqlExecutionError":
      return validateExecutionErrorResult(value) as McpToolResultByName[K];
    case "proposeSqlEdit":
      return validateProposalResult(value) as McpToolResultByName[K];
  }
}

function normalizeListenerId(value: unknown): string {
  if (value === undefined) return "default";
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MCP_MAX_LISTENER_ID_BYTES) {
    throw new McpBridgeError(
      "invalid",
      `listenerId must be a non-empty string of at most ${MCP_MAX_LISTENER_ID_BYTES} bytes`,
    );
  }
  return value;
}

function normalizeWaitMs(value: unknown, maxUiWaitMs: number): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maxUiWaitMs) {
    throw new McpBridgeError("invalid", `waitMs must be an integer from 0 to ${maxUiWaitMs}`);
  }
  return value;
}

export class McpBridge {
  private readonly maxQueueSize: number;
  private readonly timeoutMs: number;
  private readonly listenerTtlMs: number;
  private readonly maxUiWaitMs: number;
  private readonly idFactory: () => string;
  private readonly queue: PendingRequest[] = [];
  private readonly pending = new Map<string, PendingRequest>();
  private readonly historyEntries: MutableHistoryEntry[] = [];
  private listenerId: string | undefined;
  private listenerExpiresAt = 0;
  private listenerTimer: ReturnType<typeof setTimeout> | undefined;
  private waitingListener: WaitingListener | undefined;

  constructor(options: McpBridgeOptions = {}) {
    this.maxQueueSize = Number.isSafeInteger(options.maxQueueSize) && options.maxQueueSize! > 0
      ? options.maxQueueSize!
      : MCP_MAX_QUEUE_SIZE;
    this.timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs! > 0
      ? Math.min(options.timeoutMs!, MCP_REQUEST_TIMEOUT_MS)
      : MCP_REQUEST_TIMEOUT_MS;
    this.listenerTtlMs = Number.isSafeInteger(options.listenerTtlMs) && options.listenerTtlMs! > 0
      ? Math.min(options.listenerTtlMs!, MCP_REQUEST_TIMEOUT_MS)
      : Math.min(MCP_LISTENER_LEASE_MS, this.timeoutMs);
    this.maxUiWaitMs = Number.isSafeInteger(options.maxUiWaitMs) && options.maxUiWaitMs! >= 0
      ? Math.min(options.maxUiWaitMs!, MCP_MAX_UI_WAIT_MS)
      : MCP_MAX_UI_WAIT_MS;
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async next(params: McpUiNextParams | undefined, signal?: AbortSignal): Promise<McpUiNextResult> {
    this.expireListenerIfNeeded();
    const listenerId = normalizeListenerId(params?.listenerId);
    const waitMs = normalizeWaitMs(params?.waitMs, this.maxUiWaitMs);
    if (signal?.aborted) return null;
    this.claimListener(listenerId);

    if (this.waitingListener) {
      if (this.waitingListener.listenerId !== listenerId) {
        throw new McpBridgeError("rejected", "another UI poll is already waiting");
      }
      this.releaseWaiting(null);
    }

    const request = this.takeNext();
    if (request) return request;
    if (waitMs === 0) return null;

    return new Promise<McpUiNextResult>((resolve) => {
      const waitingRef: { current?: WaitingListener } = {};
      const onAbort = (): void => this.releaseWaiting(null, waitingRef.current);
      const timer = setTimeout(() => this.releaseWaiting(null, waitingRef.current), waitMs);
      const abortCleanup = signal
        ? (): void => signal.removeEventListener("abort", onAbort)
        : (): void => undefined;
      const waiting: WaitingListener = { listenerId, resolve, timer, abortCleanup };
      waitingRef.current = waiting;
      this.waitingListener = waiting;
      signal?.addEventListener("abort", onAbort);
    });
  }

  submit<K extends McpToolName>(request: McpToolRequest<K>): Promise<unknown>;
  submit<K extends McpToolName>(tool: K, args: McpToolArgsByName[K]): Promise<unknown>;
  submit(toolOrRequest: McpToolName | McpToolRequest, args?: McpToolArgs): Promise<unknown> {
    this.expireListenerIfNeeded();
    const requestArgs = typeof toolOrRequest === "string" ? args : toolOrRequest.args;
    const tool = typeof toolOrRequest === "string" ? toolOrRequest : toolOrRequest.tool;
    if (!isMcpToolName(tool)) throw new McpBridgeError("invalid", "unsupported MCP tool");
    if (!this.listenerId) throw new McpBridgeError("unavailable", "desktop UI listener unavailable");
    if (this.pending.size >= this.maxQueueSize) {
      throw new McpBridgeError("rejected", "MCP request queue is full");
    }

    const request: McpBridgeRequest = {
      id: this.idFactory(),
      expiresAt: Date.now() + this.timeoutMs,
      tool,
      args: requestArgs as McpToolArgs,
    } as McpBridgeRequest;
    let resolvePending!: (result: unknown) => void;
    let rejectPending!: (error: McpBridgeError) => void;
    const promise = new Promise<unknown>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    const timer = setTimeout(() => {
      const current = this.pending.get(request.id);
      if (!current) return;
      this.pending.delete(request.id);
      const queueIndex = this.queue.indexOf(current);
      if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
      rejectPending(new McpBridgeError("timeout", "desktop UI did not respond before timeout"));
      this.settleHistory(request.id, { status: "error", code: "timeout" });
    }, this.timeoutMs);
    const pending: PendingRequest = {
      request,
      resolve: resolvePending,
      reject: rejectPending,
      timer,
      state: "queued",
    };
    this.pending.set(request.id, pending);
    this.recordHistory(request);

    if (this.waitingListener?.listenerId === this.listenerId) {
      const waiting = this.waitingListener;
      this.waitingListener = undefined;
      clearTimeout(waiting.timer);
      waiting.abortCleanup();
      pending.state = "delivered";
      pending.deliveredTo = this.listenerId;
      waiting.resolve(request);
    } else {
      this.queue.push(pending);
    }
    return promise;
  }

  respond(response: McpBridgeResponse, listenerIdValue?: unknown): McpUiRespondResult {
    this.expireListenerIfNeeded();
    const listenerId = normalizeListenerId(listenerIdValue);
    const pending = this.pending.get(response.id);
    if (!pending || pending.state !== "delivered" || pending.deliveredTo !== listenerId) {
      throw new McpBridgeError("stale", "MCP request is stale or already completed");
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.ok) {
      try {
        const result = validateMcpToolResult(pending.request.tool, response.result);
        pending.resolve(result);
        this.settleHistory(response.id, { status: "completed" });
      } catch (error) {
        const invalid = error instanceof McpBridgeError
          ? error
          : new McpBridgeError("invalid", "desktop UI returned an invalid result");
        pending.reject(invalid);
        this.settleHistory(response.id, { status: "error", code: "invalid" });
        throw invalid;
      }
    } else {
      const error = response.error;
      if (!error || typeof error.message !== "string" || error.message.length === 0 ||
        Buffer.byteLength(error.message, "utf8") > MCP_MAX_ERROR_MESSAGE_BYTES) {
        pending.reject(new McpBridgeError("invalid", "desktop UI returned an invalid error"));
        this.settleHistory(response.id, { status: "error", code: "invalid" });
      } else {
        const code = error.code === "invalid" || error.code === "unavailable" || error.code === "rejected" ||
          error.code === "stale" || error.code === "timeout" ? error.code : "rejected";
        pending.reject(new McpBridgeError(code, error.message));
        this.settleHistory(response.id, { status: "error", code, message: error.message });
      }
    }
    return { accepted: true };
  }

  status(): McpStatusResult {
    this.expireListenerIfNeeded();
    return {
      uiConnected: this.listenerId !== undefined,
      queueSize: this.queue.length,
      inFlight: [...this.pending.values()].filter((item) => item.state === "delivered").length,
      maxQueueSize: this.maxQueueSize,
      timeoutMs: this.timeoutMs,
    };
  }

  history(): McpHistoryResult {
    return { entries: [...this.historyEntries].reverse() }; // newest first
  }

  close(): void {
    if (this.listenerTimer) clearTimeout(this.listenerTimer);
    this.listenerTimer = undefined;
    this.releaseWaiting(null);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new McpBridgeError("unavailable", "desktop UI listener unavailable"));
      this.settleHistory(pending.request.id, { status: "error", code: "unavailable" });
    }
    this.pending.clear();
    this.queue.length = 0;
    this.listenerId = undefined;
    this.listenerExpiresAt = 0;
  }

  private recordHistory(request: McpBridgeRequest): void {
    if (request.tool !== "proposeSqlEdit") return;
    const args = request.args as { sql?: unknown; rationale?: unknown } | undefined;
    if (typeof args?.sql !== "string" || typeof args.rationale !== "string") return;
    this.historyEntries.push({
      id: request.id,
      tool: request.tool,
      receivedAt: Date.now(),
      status: "pending",
      sql: args.sql,
      rationale: args.rationale,
    });
    if (this.historyEntries.length > MCP_MAX_HISTORY_ENTRIES) this.historyEntries.shift();
  }

  private settleHistory(
    id: string,
    outcome: { status: "completed" } | { status: "error"; code: McpErrorCode; message?: string },
  ): void {
    const entry = this.historyEntries.find((item) => item.id === id);
    if (!entry) return; // evicted or never recorded
    entry.status = outcome.status;
    entry.completedAt = Date.now();
    if (outcome.status === "error") {
      entry.errorCode = outcome.code;
      if (outcome.message) entry.errorMessage = outcome.message;
    }
  }

  private claimListener(listenerId: string): void {
    if (this.listenerId && this.listenerId !== listenerId) {
      throw new McpBridgeError("rejected", "another desktop UI listener is already connected");
    }
    this.listenerId = listenerId;
    this.listenerExpiresAt = Date.now() + this.listenerTtlMs;
    if (this.listenerTimer) clearTimeout(this.listenerTimer);
    this.listenerTimer = setTimeout(() => this.expireListener(), this.listenerTtlMs);
    this.listenerTimer.unref?.();
  }

  private takeNext(): McpBridgeRequest | null {
    const pending = this.queue.shift();
    if (!pending) return null;
    pending.state = "delivered";
    pending.deliveredTo = this.listenerId;
    return pending.request;
  }

  private releaseWaiting(result: McpUiNextResult, expected?: WaitingListener): void {
    const waiting = this.waitingListener;
    if (!waiting || (expected && waiting !== expected)) return;
    this.waitingListener = undefined;
    clearTimeout(waiting.timer);
    waiting.abortCleanup();
    waiting.resolve(result);
  }

  private expireListenerIfNeeded(): void {
    if (this.listenerId && Date.now() >= this.listenerExpiresAt) this.expireListener();
  }

  private expireListener(): void {
    this.listenerId = undefined;
    this.listenerExpiresAt = 0;
    if (this.listenerTimer) clearTimeout(this.listenerTimer);
    this.listenerTimer = undefined;
    this.releaseWaiting(null);
    for (const [id, pending] of this.pending) {
      if (pending.state === "delivered") continue;
      clearTimeout(pending.timer);
      pending.reject(new McpBridgeError("unavailable", "desktop UI listener unavailable"));
      this.settleHistory(id, { status: "error", code: "unavailable" });
      this.pending.delete(id);
    }
    this.queue.length = 0;
  }
}
