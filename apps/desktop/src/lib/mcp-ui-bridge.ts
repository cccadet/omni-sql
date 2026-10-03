import type {
  DialectId,
  McpBridgeRequest,
  McpErrorCode,
  McpStatusResult,
  McpToolResultByName,
  McpToolArgsByName,
} from "@omni-sql/ts-types";
import { MCP_DEFAULT_QUERY_LIMIT, MCP_MAX_ERROR_MESSAGE_BYTES } from "@omni-sql/ts-types";
import { backend } from "./backend";

const POLL_WAIT_MS = 25_000;
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

export interface McpUiState {
  activeTab: {
    id: string;
    title: string;
    sql: string;
    mongoSqlMode?: boolean;
    latestSqlExecutionError?: McpToolResultByName["getLatestSqlExecutionError"]["error"];
  } | null;
  activeConnection: { id: string; label: string; dialect: DialectId } | null;
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
  approveExecution: (args: { sql: string; limit: number; tabId: string; connectionId: string; connectionLabel: string; expiresAt: number }) => Promise<"approved" | "rejected" | "stale">;
  onStatus: (status: McpStatusResult | null, error?: string) => void;
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
    switch (request.tool) {
      case "getActiveSql": {
        if (!state.activeTab) throw new McpUiError("unavailable", "No SQL tab is active");
        // Contract returns full SQL and its tab connection's dialect. Editor handle remains source of truth while mounted.
        return { sql: state.editor?.getAllText() ?? state.activeTab.sql, dialect: state.activeConnection?.dialect === "mongodb" && state.activeTab.mongoSqlMode ? "duckdb" : state.activeConnection?.dialect ?? null } satisfies McpToolResultByName["getActiveSql"];
      }
      case "getActiveConnectionContext": {
        const connection = state.activeConnection;
        if (!connection) throw new McpUiError("unavailable", "No database connection is active");
        return { connectionId: connection.id, label: connection.label, dialect: connection.dialect } satisfies McpToolResultByName["getActiveConnectionContext"];
      }
      case "getSchemaSummary": {
        const connectionId = state.activeConnection?.id;
        if (!connectionId) throw new McpUiError("unavailable", "No database connection is active");
        const result = await this.handlers.getSchemaSummary(connectionId, request.args);
        if (this.handlers.readState().activeConnection?.id !== connectionId) {
          throw new McpUiError("stale", "Active connection changed while reading schema");
        }
        return result;
      }
      case "getTableIndexes": {
        const connectionId = state.activeConnection?.id;
        if (!connectionId) throw new McpUiError("unavailable", "No database connection is active");
        const result = await this.handlers.getTableIndexes(connectionId, request.args.schema, request.args.table);
        if (this.handlers.readState().activeConnection?.id !== connectionId) {
          throw new McpUiError("stale", "Active connection changed while reading indexes");
        }
        return result;
      }
      case "explainSql": {
        const connectionId = state.activeConnection?.id;
        if (!connectionId) throw new McpUiError("unavailable", "No database connection is active");
        const result = await this.handlers.explainSql(connectionId, request.args.sql);
        if (this.handlers.readState().activeConnection?.id !== connectionId) {
          throw new McpUiError("stale", "Active connection changed while explaining SQL");
        }
        return result;
      }
      case "getLatestSqlExecutionError":
        return { error: state.activeTab?.latestSqlExecutionError ?? null } satisfies McpToolResultByName["getLatestSqlExecutionError"];
      case "executeSql": {
        const connection = state.activeConnection;
        const tab = state.activeTab;
        if (!connection || !tab) throw new McpUiError("unavailable", "No connected SQL tab is active");
        if (connection.dialect === "mongodb" && tab.mongoSqlMode) throw new McpUiError("unavailable", "Execute MongoDB SQL in the query editor; MCP cannot route this connection through DuckDB");
        const outcome = await this.handlers.approveExecution({ sql: request.args.sql, limit: request.args.limit ?? MCP_DEFAULT_QUERY_LIMIT, tabId: tab.id, connectionId: connection.id, connectionLabel: connection.label, expiresAt: request.expiresAt });
        if (outcome !== "approved") throw new McpUiError(outcome === "stale" ? "stale" : "rejected", "SQL execution was not approved");
        const current = this.handlers.readState();
        if (current.activeConnection?.id !== connection.id || current.activeTab?.id !== tab.id) throw new McpUiError("stale", "Active tab or connection changed before execution");
        if (request.expiresAt <= Date.now() + PROPOSAL_SAFETY_WINDOW_MS) throw new McpUiError("timeout", "SQL execution request expired");
        return backend.call<McpToolResultByName["executeSql"]>("mcp.ui.execute", { id: request.id, listenerId: this.listenerId, connectionId: connection.id });
      }
      case "proposeSqlEdit": {
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
}

export class McpUiError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpUiError";
    this.code = code;
  }
}
