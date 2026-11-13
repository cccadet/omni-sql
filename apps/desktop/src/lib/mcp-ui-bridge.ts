import { analyzeExecutionRisk, analyzeReadOnlySql } from "@omni-sql/autocomplete-engine";
import type {
  DialectId,
  McpAccess,
  McpApproval,
  McpBridgeRequest,
  McpConnectionEnvironment,
  McpConnectionSummary,
  McpErrorCode,
  McpStatusResult,
  McpToolResultByName,
  McpToolArgsByName,
} from "@omni-sql/ts-types";
import { MCP_DEFAULT_QUERY_LIMIT, MCP_MAX_ERROR_MESSAGE_BYTES } from "@omni-sql/ts-types";
import { backend } from "./backend";

const POLL_WAIT_MS = 25_000;
const MCP_ACCESS_DISABLED_MESSAGE = "MCP access is disabled for this connection; enable it in the connection settings";
const RETRY_MS = 1_000;
const PROPOSAL_SAFETY_WINDOW_MS = 1_000;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export interface McpUiConnection {
  id: string;
  label: string;
  dialect: DialectId;
  mcpAccess: McpAccess;
  /** Effective approval mode for MCP SQL execution; missing means always ask. */
  mcpApproval?: McpApproval;
  environment?: McpConnectionEnvironment;
}

export type McpExecutionOutcome =
  | { outcome: "approved"; connectionId: string }
  | { outcome: "rejected" | "stale" };

function connectionSummary(connection: McpUiConnection & { mcpAccess: "read" | "write" }): McpConnectionSummary {
  return {
    connectionId: connection.id,
    label: connection.label,
    dialect: connection.dialect,
    mcpAccess: connection.mcpAccess,
    ...(connection.environment ? { environment: connection.environment } : {}),
  };
}

function isExposed(connection: McpUiConnection): connection is McpUiConnection & { mcpAccess: "read" | "write" } {
  return connection.mcpAccess !== "off";
}

/**
 * Whether the connection's approval mode runs this SQL without the desktop
 * dialog. Destructive SQL always asks, even with full permission.
 */
export function mcpAutoApproves(connection: McpUiConnection, sql: string): boolean {
  if (!isExposed(connection)) return false;
  const approval = connection.mcpApproval ?? "ask";
  if (approval === "ask") return false;
  if (analyzeExecutionRisk(sql, connection.dialect).level !== "none") return false;
  if (approval === "autoRead" || connection.mcpAccess === "read") return analyzeReadOnlySql(sql, connection.dialect).readOnly;
  return true;
}

interface ResolvedTarget {
  connection: McpUiConnection;
  /** True when the tool targeted the active connection implicitly (no connectionId). */
  implicit: boolean;
}

/** Resolve a tool's connection: the given id from `listConnections`, else the active one. */
export function resolveMcpTarget(state: McpUiState, connectionId: string | undefined): ResolvedTarget {
  if (connectionId === undefined) {
    const connection = state.activeConnection;
    if (!connection) throw new McpUiError("unavailable", "No database connection is active; pass a connectionId from listConnections");
    if (!isExposed(connection)) throw new McpUiError("rejected", MCP_ACCESS_DISABLED_MESSAGE);
    return { connection, implicit: true };
  }
  const connection = state.connections.find((candidate) => candidate.id === connectionId);
  if (!connection) throw new McpUiError("invalid", "Unknown connectionId; call listConnections");
  if (!isExposed(connection)) throw new McpUiError("rejected", MCP_ACCESS_DISABLED_MESSAGE);
  return { connection, implicit: false };
}

/** After an await, the target must still be the one the tool resolved. */
function assertTargetCurrent(target: ResolvedTarget, state: McpUiState, operation: string): void {
  if (target.implicit) {
    if (state.activeConnection?.id !== target.connection.id) throw new McpUiError("stale", `Active connection changed while ${operation}`);
    return;
  }
  const current = state.connections.find((candidate) => candidate.id === target.connection.id);
  if (!current || !isExposed(current)) throw new McpUiError("stale", `Connection changed while ${operation}`);
}

export interface McpUiState {
  activeTab: {
    id: string;
    title: string;
    sql: string;
    mongoSqlMode?: boolean;
    latestSqlExecutionError?: McpToolResultByName["getLatestSqlExecutionError"]["error"];
  } | null;
  activeConnection: McpUiConnection | null;
  /** Every saved connection; entries with `off` access are never exposed to MCP clients. */
  connections: readonly McpUiConnection[];
  editor: {
    getAllText: () => string;
    getSelectionOrCurrent: () => { sql: string; start: number };
  } | null;
}

type SchemaSummary = McpToolResultByName["getSchemaSummary"];

export interface McpUiBridgeHandlers {
  readState: () => McpUiState;
  getSchemaSummary: (connectionId: string, args?: McpToolArgsByName["getSchemaSummary"]) => Promise<SchemaSummary>;
  getTableIndexes: (connectionId: string, schema: string, table: string) => Promise<McpToolResultByName["getTableIndexes"]>;
  explainSql: (connectionId: string, sql: string) => Promise<McpToolResultByName["explainSql"]>;
  proposeEdit: (args: { sql: string; rationale: string; tabId: string; originalSql: string; expiresAt?: number }) => Promise<"approved" | "rejected" | "stale">;
  /** `connectionId` is preselected; `suggested` means the MCP client chose it rather than defaulting to the active one. */
  approveExecution: (args: { sql: string; limit: number; connectionId: string; suggested: boolean; expiresAt: number }) => Promise<McpExecutionOutcome>;  onStatus: (status: McpStatusResult | null, error?: string) => void;
}

export function makeListenerId(): string {
  const crypto = globalThis.crypto;
  if (!crypto) throw new Error("Web Crypto API is required to create an MCP UI listener");
  if (crypto.randomUUID) return crypto.randomUUID();
  return `omni-ui-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
}

export class McpUiBridge {
  private readonly listenerId: string;
  private readonly handlers: McpUiBridgeHandlers;
  private abortController: AbortController | null = null;
  private running = false;

  constructor(handlers: McpUiBridgeHandlers, listenerId = makeListenerId()) {
    this.handlers = handlers;
    this.listenerId = listenerId;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();
    void this.poll(this.abortController.signal);
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    void backend.call("mcp.ui.release", { listenerId: this.listenerId }).catch(() => undefined);
  }

  getListenerId(): string {
    return this.listenerId;
  }

  private async poll(signal: AbortSignal): Promise<void> {
    while (this.running && !signal.aborted) {
      try {
        const request = await backend.call<McpBridgeRequest | null>(
          "mcp.ui.next",
          { listenerId: this.listenerId, waitMs: POLL_WAIT_MS },
          signal,
        );
        if (signal.aborted || !this.running) return;
        if (request) void this.respond(request, signal).catch(() => { /* expired or cancelled requests may no longer accept a response */ });
        await this.refreshStatus(signal);
      } catch (error) {
        if (signal.aborted || !this.running) return;
        this.handlers.onStatus(null, error instanceof Error ? error.message : String(error));
        await wait(RETRY_MS, signal);
      }
    }
  }

  private async refreshStatus(signal?: AbortSignal): Promise<void> {
    try {
      const status = await backend.call<McpStatusResult>("mcp.status", undefined, signal);
      if (!signal?.aborted) this.handlers.onStatus(status);
    } catch (error) {
      if (!signal?.aborted) this.handlers.onStatus(null, error instanceof Error ? error.message : String(error));
    }
  }

  async refresh(): Promise<void> {
    await this.refreshStatus();
  }

  private async respond(request: McpBridgeRequest, signal: AbortSignal): Promise<void> {
    try {
      const result = await this.handleRequest(request);
      if (signal.aborted) return;
      await backend.call("mcp.ui.respond", { listenerId: this.listenerId, id: request.id, ok: true, result }, signal);
    } catch (error) {
      if (signal.aborted) return;
      const code: McpErrorCode = error instanceof McpUiError ? error.code : "rejected";
      let message = error instanceof Error ? error.message : String(error);
      while (new TextEncoder().encode(message).byteLength > MCP_MAX_ERROR_MESSAGE_BYTES) message = message.slice(0, -1);
      message ||= "MCP request failed";
      await backend.call("mcp.ui.respond", {
        listenerId: this.listenerId,
        id: request.id,
        ok: false,
        error: { code, message },
      }, signal);
    }
  }

  async handleRequest(request: McpBridgeRequest): Promise<unknown> {
    if (request.expiresAt <= Date.now() + PROPOSAL_SAFETY_WINDOW_MS) throw new McpUiError("timeout", "MCP request expired");
    const state = this.handlers.readState();
    const activeDisabled = state.activeConnection?.mcpAccess === "off";
    switch (request.tool) {
      case "getActiveSql": {
        // A tab bound to a connection without MCP access exposes nothing, not even its SQL text.
        if (activeDisabled) throw new McpUiError("rejected", MCP_ACCESS_DISABLED_MESSAGE);
        if (!state.activeTab) throw new McpUiError("unavailable", "No SQL tab is active");
        // Contract returns full SQL and its tab connection's dialect. Editor handle remains source of truth while mounted.
        return { sql: state.editor?.getAllText() ?? state.activeTab.sql, dialect: state.activeConnection?.dialect === "mongodb" && state.activeTab.mongoSqlMode ? "duckdb" : state.activeConnection?.dialect ?? null } satisfies McpToolResultByName["getActiveSql"];
      }
      case "getActiveConnectionContext": {
        const connection = state.activeConnection;
        if (!connection) throw new McpUiError("unavailable", "No database connection is active");
        if (!isExposed(connection)) throw new McpUiError("rejected", MCP_ACCESS_DISABLED_MESSAGE);
        return connectionSummary(connection) satisfies McpToolResultByName["getActiveConnectionContext"];
      }
      case "listConnections": {
        const active = state.activeConnection;
        return {
          activeConnectionId: active && isExposed(active) ? active.id : null,
          connections: state.connections.filter(isExposed).map(connectionSummary),
        } satisfies McpToolResultByName["listConnections"];
      }
      case "getSchemaSummary": {
        const { connectionId, ...args } = request.args;
        const target = resolveMcpTarget(state, connectionId);
        const result = await this.handlers.getSchemaSummary(target.connection.id, args);
        assertTargetCurrent(target, this.handlers.readState(), "reading schema");
        return result;
      }
      case "getTableIndexes": {
        const target = resolveMcpTarget(state, request.args.connectionId);
        const result = await this.handlers.getTableIndexes(target.connection.id, request.args.schema, request.args.table);
        assertTargetCurrent(target, this.handlers.readState(), "reading indexes");
        return result;
      }
      case "explainSql": {
        const target = resolveMcpTarget(state, request.args.connectionId);
        const result = await this.handlers.explainSql(target.connection.id, request.args.sql);
        assertTargetCurrent(target, this.handlers.readState(), "explaining SQL");
        return result;
      }
      case "getLatestSqlExecutionError":
        if (activeDisabled) throw new McpUiError("rejected", MCP_ACCESS_DISABLED_MESSAGE);
        return { error: state.activeTab?.latestSqlExecutionError ?? null } satisfies McpToolResultByName["getLatestSqlExecutionError"];
      case "executeSql": {
        const suggested = resolveMcpTarget(state, request.args.connectionId).connection;
        this.assertExecutable(state, suggested, request.args.sql);
        const autoApproved = mcpAutoApproves(suggested, request.args.sql);
        let chosenId = suggested.id;
        if (!autoApproved) {
          const approval = await this.handlers.approveExecution({
            sql: request.args.sql,
            limit: request.args.limit ?? MCP_DEFAULT_QUERY_LIMIT,
            connectionId: suggested.id,
            suggested: request.args.connectionId !== undefined,
            expiresAt: request.expiresAt,
          });
          if (approval.outcome !== "approved") throw new McpUiError(approval.outcome === "stale" ? "stale" : "rejected", "SQL execution was not approved");
          chosenId = approval.connectionId;
        }
        // The user may have picked another connection in the approval dialog; recheck it against current state.
        const current = this.handlers.readState();
        const chosen = current.connections.find((candidate) => candidate.id === chosenId);
        if (!chosen || !isExposed(chosen)) throw new McpUiError("stale", "Connection changed before execution");
        this.assertExecutable(current, chosen, request.args.sql);
        if (autoApproved && !mcpAutoApproves(chosen, request.args.sql)) throw new McpUiError("stale", "Connection approval mode changed before execution");
        if (request.expiresAt <= Date.now() + PROPOSAL_SAFETY_WINDOW_MS) throw new McpUiError("timeout", "SQL execution request expired");
        return backend.call<McpToolResultByName["executeSql"]>("mcp.ui.execute", {
          id: request.id,
          listenerId: this.listenerId,
          connectionId: chosen.id,
          ...(autoApproved ? { autoApproved: true } : {}),
        });
      }
      case "proposeSqlEdit": {
        if (activeDisabled) throw new McpUiError("rejected", MCP_ACCESS_DISABLED_MESSAGE);
        if (!state.activeTab) throw new McpUiError("unavailable", "No SQL tab is active");
        const originalSql = state.editor?.getAllText() ?? state.activeTab.sql;
        const expiresAt = typeof (request as McpBridgeRequest & { expiresAt?: number }).expiresAt === "number"
          ? (request as McpBridgeRequest & { expiresAt: number }).expiresAt
          : undefined;
        if (expiresAt !== undefined && expiresAt <= Date.now() + PROPOSAL_SAFETY_WINDOW_MS) throw new McpUiError("timeout", "MCP edit proposal expired");
        const outcome = await this.handlers.proposeEdit({ ...request.args, tabId: state.activeTab.id, originalSql, expiresAt });
        if (outcome === "stale") throw new McpUiError("stale", "SQL changed before edit was applied");
        return { approved: outcome === "approved" } satisfies McpToolResultByName["proposeSqlEdit"];
      }
    }
  }

  /** Refuse before (and again after) approval; the backend enforces access once more. */
  private assertExecutable(state: McpUiState, connection: McpUiConnection, sql: string): void {
    if (connection.dialect === "mongodb" && connection.id === state.activeConnection?.id && state.activeTab?.mongoSqlMode) {
      throw new McpUiError("unavailable", "Execute MongoDB SQL in the query editor; MCP cannot route this connection through DuckDB");
    }
    if (connection.mcpAccess === "read") {
      const analysis = analyzeReadOnlySql(sql, connection.dialect);
      if (!analysis.readOnly) throw new McpUiError("rejected", `This connection allows read-only MCP access. ${analysis.reason}`);
    }
  }
}

export class McpUiError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpUiError";
    this.code = code;
  }
}
