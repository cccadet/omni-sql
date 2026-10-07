// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { backend } from "./backend";
import type { SqlExecutionError } from "@omni-sql/ts-types";
import { McpUiBridge, McpUiError, makeListenerId, type McpUiState } from "./mcp-ui-bridge";

function setup(state: McpUiState, approveExecution: (args: unknown) => Promise<"approved" | "rejected" | "stale"> = vi.fn(async () => "approved" as const)) {
  return new McpUiBridge({
    readState: () => state,
    getSchemaSummary: vi.fn(async (connectionId) => ({ connectionId, schemas: [] })),
    getTableIndexes: vi.fn(async (connectionId) => ({
      connectionId,
      indexes: [{ name: "orders_pkey", unique: true, primary: true, columns: ["id"] }],
    })),
    explainSql: vi.fn(async () => ({ textual: "Seq Scan on orders", format: "text" as const })),
    proposeEdit: vi.fn(async () => "approved" as const),
    approveExecution,
    onStatus: vi.fn(),
  }, "test-listener");
}

describe("MCP UI bridge tools", () => {
  it("returns no latest execution error when active tab has none", async () => {
    const bridge = setup({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT 1", latestSqlExecutionError: null },
      activeConnection: null,
      editor: null,
    });

    await expect(bridge.handleRequest({ id: "1", tool: "getLatestSqlExecutionError", args: {}, expiresAt: Date.now() + 60_000 }))
      .resolves.toEqual({ error: null });
    await expect(bridge.handleRequest({ id: "2", tool: "getActiveSql", args: {}, expiresAt: Date.now() + 60_000 }))
      .resolves.toEqual({ sql: "SELECT 1", dialect: null });
  });

  it("exposes failed execution and clears it after successful execution", async () => {
    let latestSqlExecutionError: SqlExecutionError | null = { message: "syntax error", code: "-32000", position: { start: 7, end: 12 } };
    const state: McpUiState = {
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT 1", latestSqlExecutionError },
      activeConnection: null,
      editor: null,
    };
    const bridge = setup(state);

    await expect(bridge.handleRequest({ id: "2", tool: "getLatestSqlExecutionError", args: {}, expiresAt: Date.now() + 60_000 }))
      .resolves.toEqual({ error: { message: "syntax error", code: "-32000", position: { start: 7, end: 12 } } });

    latestSqlExecutionError = null;
    state.activeTab!.latestSqlExecutionError = latestSqlExecutionError;
    await expect(bridge.handleRequest({ id: "3", tool: "getLatestSqlExecutionError", args: {}, expiresAt: Date.now() + 60_000 }))
      .resolves.toEqual({ error: null });
  });

  it("returns full active SQL and safe connection context", async () => {
    const bridge = setup({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT state" },
      activeConnection: { id: "opaque-id", label: "Warehouse", dialect: "postgres" },
      editor: { getAllText: () => "SELECT current", getSelectionOrCurrent: () => ({ sql: "SELECT current", start: 0 }) },
    });

    await expect(bridge.handleRequest({ id: "1", tool: "getActiveSql", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({ sql: "SELECT current", dialect: "postgres" });
    await expect(bridge.handleRequest({ id: "2", tool: "getActiveConnectionContext", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({
      connectionId: "opaque-id", label: "Warehouse", dialect: "postgres",
    });
  });


  it("returns exact grouped schema summary and rejects changed connection", async () => {
    let connectionId = "conn-1";
    let changeDuringRead = false;
    const bridge = new McpUiBridge({
      readState: () => ({ activeTab: null, activeConnection: { id: connectionId, label: "DB", dialect: "postgres" }, editor: null }),
      getSchemaSummary: vi.fn(async (id) => {
        if (id !== connectionId) throw new McpUiError("stale", "changed");
        if (changeDuringRead) connectionId = "conn-2";
        return { connectionId: id, schemas: [{ name: "public", relations: [] }] };
      }),
      getTableIndexes: vi.fn(),
      explainSql: vi.fn(),
      proposeEdit: vi.fn(),
      approveExecution: vi.fn(async () => "approved" as const),
    onStatus: vi.fn(),
    }, "test-listener");
    await expect(bridge.handleRequest({ id: "1", tool: "getSchemaSummary", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({
      connectionId: "conn-1", schemas: [{ name: "public", relations: [] }],
    });
    changeDuringRead = true;
    connectionId = "conn-1";
    await expect(bridge.handleRequest({ id: "2", tool: "getSchemaSummary", args: {}, expiresAt: Date.now() + 60_000 })).rejects.toMatchObject({ code: "stale" });
  });

  it("explains SQL and lists targeted indexes through the active connection", async () => {
    const bridge = setup({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT 1" },
      activeConnection: { id: "conn-1", label: "DB", dialect: "postgres" },
      editor: null,
    });

    await expect(bridge.handleRequest({
      id: "1",
      tool: "explainSql",
      args: { sql: "SELECT * FROM orders" },
      expiresAt: Date.now() + 60_000,
    })).resolves.toEqual({ textual: "Seq Scan on orders", format: "text" });
    await expect(bridge.handleRequest({
      id: "2",
      tool: "getTableIndexes",
      args: { schema: "public", table: "orders" },
      expiresAt: Date.now() + 60_000,
    })).resolves.toEqual({
      connectionId: "conn-1",
      indexes: [{ name: "orders_pkey", unique: true, primary: true, columns: ["id"] }],
    });
  });

  it("returns proposal approval and exposes stale guard errors", async () => {
    const bridge = setup({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT old" },
      activeConnection: null,
      editor: { getAllText: () => "SELECT old", getSelectionOrCurrent: () => ({ sql: "SELECT old", start: 0 }) },
    });
    await expect(bridge.handleRequest({ id: "1", tool: "proposeSqlEdit", args: { sql: "SELECT new", rationale: "Improve query" }, expiresAt: Date.now() + 60_000 })).resolves.toEqual({ approved: true });

    const stale = setup({ activeTab: null, activeConnection: null, editor: null });
    await expect(stale.handleRequest({ id: "2", tool: "proposeSqlEdit", args: { sql: "SELECT new", rationale: "Improve query" }, expiresAt: Date.now() + 60_000 })).rejects.toMatchObject({ code: "unavailable" });
    expect(new McpUiError("stale", "changed").code).toBe("stale");
  });

  it("rejects proposals inside safety window", async () => {
    const bridge = setup({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT old" },
      activeConnection: null,
      editor: null,
    });
    const request = { id: "3", tool: "proposeSqlEdit", args: { sql: "SELECT new", rationale: "Improve query" }, expiresAt: Date.now() + 500 } as const;
    await expect(bridge.handleRequest(request)).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("MCP UI listener IDs", () => {
  it("uses randomUUID when Web Crypto provides it", () => {
    const randomUUID = vi.fn(() => "listener-uuid");
    vi.stubGlobal("crypto", { randomUUID });
    try {
      expect(makeListenerId()).toBe("listener-uuid");
      expect(randomUUID).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses getRandomValues when randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((values: Uint32Array) => {
      values.set([1, 2, 3, 4]);
      return values;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      expect(makeListenerId()).toBe("omni-ui-1-2-3-4");
      expect(getRandomValues).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("MCP SQL approval", () => {
  it("binds approval to the tab and connection and never sends SQL in the approval RPC", async () => {
    const state: McpUiState = { activeTab: { id: "tab", title: "Query", sql: "SELECT original" }, activeConnection: { id: "connection", label: "Production", dialect: "postgres" }, editor: null };
    let approve!: (outcome: "approved") => void;
    const approval = vi.fn(() => new Promise<"approved">((resolve) => { approve = resolve; }));
    const bridge = setup(state, approval);
    const rpc = vi.spyOn(backend, "call").mockResolvedValue({ rows: [] });
    try {
      const pending = bridge.handleRequest({ id: "request", tool: "executeSql", args: { sql: "DELETE FROM users" }, expiresAt: Date.now() + 60_000 });
      expect(rpc).not.toHaveBeenCalled();
      expect(approval).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "connection", connectionLabel: "Production", sql: "DELETE FROM users", limit: 100 }));
      approve("approved");
      await pending;
      expect(rpc).toHaveBeenCalledWith("mcp.ui.execute", { id: "request", listenerId: "test-listener", connectionId: "connection" });
      rpc.mockClear();
      const stale = bridge.handleRequest({ id: "stale", tool: "executeSql", args: { sql: "SELECT 1" }, expiresAt: Date.now() + 60_000 });
      state.activeConnection = { id: "another", label: "Another", dialect: "postgres" };
      approve("approved");
      await expect(stale).rejects.toMatchObject({ code: "stale" });
      expect(rpc).not.toHaveBeenCalled();
    } finally { rpc.mockRestore(); }
  });

  it("continues serving reads while execution awaits approval", async () => {
    const state: McpUiState = { activeTab: { id: "tab", title: "Query", sql: "SELECT 1" }, activeConnection: { id: "connection", label: "DB", dialect: "postgres" }, editor: null };
    let rejectApproval!: (outcome: "rejected") => void;
    const bridge = setup(state, () => new Promise<"rejected">((resolve) => { rejectApproval = resolve; }));
    let polls = 0;
    const rpc = vi.spyOn(backend, "call").mockImplementation(async (method, _params, signal) => {
      if (method === "mcp.ui.next") {
        if (++polls === 1) return { id: "approval", tool: "executeSql", args: { sql: "SELECT 2" }, expiresAt: Date.now() + 60_000 };
        if (polls === 2) return { id: "read", tool: "getActiveSql", args: {}, expiresAt: Date.now() + 60_000 };
        return new Promise((resolve) => signal?.addEventListener("abort", () => resolve(null), { once: true }));
      }
      return { uiConnected: true, queueSize: 0, inFlight: 1 };
    });
    try {
      bridge.start();
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith("mcp.ui.respond", expect.objectContaining({ id: "read", ok: true, result: { sql: "SELECT 1", dialect: "postgres" } }), expect.any(AbortSignal)));
      rejectApproval("rejected");
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith("mcp.ui.respond", expect.objectContaining({ id: "approval", ok: false }), expect.any(AbortSignal)));
    } finally { bridge.stop(); rpc.mockRestore(); }
  });
});

it("reports DuckDB for MongoDB SQL tabs and prevents MCP from executing through the native adapter", async () => {
  const bridge = setup({ activeTab: { id: "tab", title: "Mongo SQL", sql: "SELECT 1", mongoSqlMode: true }, activeConnection: { id: "mongo", label: "MongoDB", dialect: "mongodb" }, editor: null });
  await expect(bridge.handleRequest({ id: "mode", tool: "getActiveSql", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({ sql: "SELECT 1", dialect: "duckdb" });
  await expect(bridge.handleRequest({ id: "execute", tool: "executeSql", args: { sql: '{"collection":"items","operation":"deleteMany","filter":{}}' }, expiresAt: Date.now() + 60_000 })).rejects.toThrow("query editor");
});
