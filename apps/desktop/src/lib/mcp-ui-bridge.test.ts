// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { backend } from "./backend";
import type { SqlExecutionError } from "@omni-sql/ts-types";
import { McpUiBridge, McpUiError, makeListenerId, type McpExecutionOutcome, type McpUiConnection, type McpUiState } from "./mcp-ui-bridge";

type ApproveExecution = (args: { sql: string; limit: number; connectionId: string; suggested: boolean; expiresAt: number }) => Promise<McpExecutionOutcome>;

const approveAsSuggested: ApproveExecution = async (args) => ({ outcome: "approved", connectionId: args.connectionId });

/** Connections default to the active one, matching a desktop with a single saved connection. */
function withConnections(state: Omit<McpUiState, "connections"> & { connections?: McpUiConnection[] }): McpUiState {
  return { ...state, connections: state.connections ?? (state.activeConnection ? [state.activeConnection] : []) };
}

function setup(state: McpUiState, approveExecution: ApproveExecution = vi.fn(approveAsSuggested)) {
  return new McpUiBridge({
    readState: () => state,
    getSchemaSummary: vi.fn(async (connectionId) => ({ connectionId, schemas: [] })),
    getTableIndexes: vi.fn(async (connectionId) => ({
      connectionId,
      indexes: [{ name: "orders_pkey", unique: true, primary: true, columns: ["id"] }],
    })),
    explainSql: vi.fn(async (connectionId) => ({ connectionId, textual: "Seq Scan on orders", format: "text" as const })),
    proposeEdit: vi.fn(async () => "approved" as const),
    approveExecution,
    onStatus: vi.fn(),
  }, "test-listener");
}

const request = (id: string, tool: string, args: Record<string, unknown> = {}) => ({ id, tool, args, expiresAt: Date.now() + 60_000 }) as Parameters<McpUiBridge["handleRequest"]>[0];

describe("MCP UI bridge tools", () => {
  it("returns no latest execution error when active tab has none", async () => {
    const bridge = setup(withConnections({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT 1", latestSqlExecutionError: null },
      activeConnection: null,
      editor: null,
    }));

    await expect(bridge.handleRequest({ id: "1", tool: "getLatestSqlExecutionError", args: {}, expiresAt: Date.now() + 60_000 }))
      .resolves.toEqual({ error: null });
    await expect(bridge.handleRequest({ id: "2", tool: "getActiveSql", args: {}, expiresAt: Date.now() + 60_000 }))
      .resolves.toEqual({ sql: "SELECT 1", dialect: null });
  });

  it("exposes failed execution and clears it after successful execution", async () => {
    let latestSqlExecutionError: SqlExecutionError | null = { message: "syntax error", code: "-32000", position: { start: 7, end: 12 } };
    const state = withConnections({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT 1", latestSqlExecutionError },
      activeConnection: null,
      editor: null,
    });
    const bridge = setup(state);

    await expect(bridge.handleRequest({ id: "2", tool: "getLatestSqlExecutionError", args: {}, expiresAt: Date.now() + 60_000 }))
      .resolves.toEqual({ error: { message: "syntax error", code: "-32000", position: { start: 7, end: 12 } } });

    latestSqlExecutionError = null;
    state.activeTab!.latestSqlExecutionError = latestSqlExecutionError;
    await expect(bridge.handleRequest({ id: "3", tool: "getLatestSqlExecutionError", args: {}, expiresAt: Date.now() + 60_000 }))
      .resolves.toEqual({ error: null });
  });

  it("returns full active SQL and safe connection context with access and environment", async () => {
    const bridge = setup(withConnections({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT state" },
      activeConnection: { id: "opaque-id", label: "Warehouse", dialect: "postgres", mcpAccess: "read", environment: { id: "staging", name: "Homologação" } },
      editor: { getAllText: () => "SELECT current", getSelectionOrCurrent: () => ({ sql: "SELECT current", start: 0 }) },
    }));

    await expect(bridge.handleRequest({ id: "1", tool: "getActiveSql", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({ sql: "SELECT current", dialect: "postgres" });
    await expect(bridge.handleRequest({ id: "2", tool: "getActiveConnectionContext", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({
      connectionId: "opaque-id", label: "Warehouse", dialect: "postgres", mcpAccess: "read", environment: { id: "staging", name: "Homologação" },
    });
  });


  it("returns exact grouped schema summary and rejects changed connection", async () => {
    let connectionId = "conn-1";
    let changeDuringRead = false;
    const bridge = new McpUiBridge({
      readState: () => withConnections({ activeTab: null, activeConnection: { id: connectionId, label: "DB", dialect: "postgres", mcpAccess: "read" }, editor: null }),
      getSchemaSummary: vi.fn(async (id) => {
        if (changeDuringRead) connectionId = "conn-2";
        return { connectionId: id, schemas: [{ name: "public", relations: [] }] };
      }),
      getTableIndexes: vi.fn(),
      explainSql: vi.fn(),
      proposeEdit: vi.fn(),
      approveExecution: vi.fn(approveAsSuggested),
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
    const bridge = setup(withConnections({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT 1" },
      activeConnection: { id: "conn-1", label: "DB", dialect: "postgres", mcpAccess: "read" },
      editor: null,
    }));

    await expect(bridge.handleRequest({
      id: "1",
      tool: "explainSql",
      args: { sql: "SELECT * FROM orders" },
      expiresAt: Date.now() + 60_000,
    })).resolves.toEqual({ connectionId: "conn-1", textual: "Seq Scan on orders", format: "text" });
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
    const bridge = setup(withConnections({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT old" },
      activeConnection: null,
      editor: { getAllText: () => "SELECT old", getSelectionOrCurrent: () => ({ sql: "SELECT old", start: 0 }) },
    }));
    await expect(bridge.handleRequest({ id: "1", tool: "proposeSqlEdit", args: { sql: "SELECT new", rationale: "Improve query" }, expiresAt: Date.now() + 60_000 })).resolves.toEqual({ approved: true });

    const stale = setup(withConnections({ activeTab: null, activeConnection: null, editor: null }));
    await expect(stale.handleRequest({ id: "2", tool: "proposeSqlEdit", args: { sql: "SELECT new", rationale: "Improve query" }, expiresAt: Date.now() + 60_000 })).rejects.toMatchObject({ code: "unavailable" });
    expect(new McpUiError("stale", "changed").code).toBe("stale");
  });

  it("rejects proposals inside safety window", async () => {
    const bridge = setup(withConnections({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT old" },
      activeConnection: null,
      editor: null,
    }));
    const proposal = { id: "3", tool: "proposeSqlEdit", args: { sql: "SELECT new", rationale: "Improve query" }, expiresAt: Date.now() + 500 } as const;
    await expect(bridge.handleRequest(proposal)).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("MCP connection choice", () => {
  const dev: McpUiConnection = { id: "dev", label: "Orders dev", dialect: "postgres", mcpAccess: "write", environment: { id: "development", name: "Development" } };
  const prod: McpUiConnection = { id: "prod", label: "Orders prod", dialect: "postgres", mcpAccess: "read", environment: { id: "production", name: "Production" } };
  const hr: McpUiConnection = { id: "hr", label: "HR", dialect: "mysql", mcpAccess: "off" };

  it("lists exposed connections with environments and hides those with access off", async () => {
    const bridge = setup(withConnections({ activeTab: null, activeConnection: dev, connections: [dev, prod, hr], editor: null }));
    await expect(bridge.handleRequest(request("list", "listConnections"))).resolves.toEqual({
      activeConnectionId: "dev",
      connections: [
        { connectionId: "dev", label: "Orders dev", dialect: "postgres", mcpAccess: "write", environment: { id: "development", name: "Development" } },
        { connectionId: "prod", label: "Orders prod", dialect: "postgres", mcpAccess: "read", environment: { id: "production", name: "Production" } },
      ],
    });

    const hidden = setup(withConnections({ activeTab: null, activeConnection: hr, connections: [dev, hr], editor: null }));
    await expect(hidden.handleRequest(request("list", "listConnections"))).resolves.toMatchObject({ activeConnectionId: null, connections: [{ connectionId: "dev" }] });
  });

  it("reads another connection by id even when the active one is disabled", async () => {
    const bridge = setup(withConnections({ activeTab: { id: "tab", title: "Secrets", sql: "SELECT 1" }, activeConnection: hr, connections: [dev, prod, hr], editor: null }));
    await expect(bridge.handleRequest(request("schema", "getSchemaSummary", { connectionId: "prod" }))).resolves.toEqual({ connectionId: "prod", schemas: [] });
    await expect(bridge.handleRequest(request("explain", "explainSql", { connectionId: "dev", sql: "SELECT 1" }))).resolves.toMatchObject({ connectionId: "dev" });
    await expect(bridge.handleRequest(request("off", "getTableIndexes", { connectionId: "hr", schema: "s", table: "t" }))).rejects.toMatchObject({ code: "rejected" });
    await expect(bridge.handleRequest(request("unknown", "getTableIndexes", { connectionId: "nope", schema: "s", table: "t" }))).rejects.toMatchObject({ code: "invalid" });
  });

  it("preselects the suggested connection and runs on the one the user picks", async () => {
    const approval = vi.fn<ApproveExecution>(async () => ({ outcome: "approved", connectionId: "dev" }));
    const bridge = setup(withConnections({ activeTab: null, activeConnection: prod, connections: [dev, prod], editor: null }), approval);
    const rpc = vi.spyOn(backend, "call").mockResolvedValue({ rows: [] });
    try {
      await bridge.handleRequest(request("run", "executeSql", { connectionId: "prod", sql: "SELECT 1" }));
      expect(approval).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "prod", suggested: true, sql: "SELECT 1" }));
      expect(rpc).toHaveBeenCalledWith("mcp.ui.execute", { id: "run", listenerId: "test-listener", connectionId: "dev" });

      await bridge.handleRequest(request("default", "executeSql", { sql: "SELECT 2" }));
      expect(approval).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: "prod", suggested: false }));
    } finally { rpc.mockRestore(); }
  });

  it("refuses a write when the user picks a read-only connection", async () => {
    const approval = vi.fn<ApproveExecution>(async () => ({ outcome: "approved", connectionId: "prod" }));
    const bridge = setup(withConnections({ activeTab: null, activeConnection: dev, connections: [dev, prod], editor: null }), approval);
    const rpc = vi.spyOn(backend, "call");
    try {
      await expect(bridge.handleRequest(request("write", "executeSql", { sql: "DELETE FROM orders" }))).rejects.toMatchObject({ code: "rejected", message: expect.stringContaining("read-only") });
      expect(approval).toHaveBeenCalledOnce();
      expect(rpc).not.toHaveBeenCalled();
    } finally { rpc.mockRestore(); }
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
  it("binds approval to the chosen connection and never sends SQL in the approval RPC", async () => {
    const state = withConnections({ activeTab: { id: "tab", title: "Query", sql: "SELECT original" }, activeConnection: { id: "connection", label: "Production", dialect: "postgres", mcpAccess: "write" }, editor: null });
    let approve!: (outcome: McpExecutionOutcome) => void;
    const approval = vi.fn<ApproveExecution>(() => new Promise((resolve) => { approve = resolve; }));
    const bridge = setup(state, approval);
    const rpc = vi.spyOn(backend, "call").mockResolvedValue({ rows: [] });
    try {
      const pending = bridge.handleRequest({ id: "request", tool: "executeSql", args: { sql: "DELETE FROM users" }, expiresAt: Date.now() + 60_000 });
      expect(rpc).not.toHaveBeenCalled();
      expect(approval).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "connection", suggested: false, sql: "DELETE FROM users", limit: 100 }));
      approve({ outcome: "approved", connectionId: "connection" });
      await pending;
      expect(rpc).toHaveBeenCalledWith("mcp.ui.execute", { id: "request", listenerId: "test-listener", connectionId: "connection" });
      rpc.mockClear();
      const stale = bridge.handleRequest({ id: "stale", tool: "executeSql", args: { sql: "SELECT 1" }, expiresAt: Date.now() + 60_000 });
      // The chosen connection lost MCP access while the dialog was open.
      state.connections = [{ id: "connection", label: "Production", dialect: "postgres", mcpAccess: "off" }];
      approve({ outcome: "approved", connectionId: "connection" });
      await expect(stale).rejects.toMatchObject({ code: "stale" });
      expect(rpc).not.toHaveBeenCalled();
    } finally { rpc.mockRestore(); }
  });

  it("continues serving reads while execution awaits approval", async () => {
    const state = withConnections({ activeTab: { id: "tab", title: "Query", sql: "SELECT 1" }, activeConnection: { id: "connection", label: "DB", dialect: "postgres", mcpAccess: "read" }, editor: null });
    let rejectApproval!: (outcome: McpExecutionOutcome) => void;
    const bridge = setup(state, () => new Promise((resolve) => { rejectApproval = resolve; }));
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
      rejectApproval({ outcome: "rejected" });
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith("mcp.ui.respond", expect.objectContaining({ id: "approval", ok: false }), expect.any(AbortSignal)));
    } finally { bridge.stop(); rpc.mockRestore(); }
  });
});

describe("MCP connection access", () => {
  it("exposes nothing from a tab whose connection has MCP access off", async () => {
    const approval = vi.fn(approveAsSuggested);
    const bridge = setup(withConnections({ activeTab: { id: "tab", title: "Secrets", sql: "SELECT * FROM salaries" }, activeConnection: { id: "hr", label: "HR", dialect: "postgres", mcpAccess: "off" }, editor: null }), approval);
    const rpc = vi.spyOn(backend, "call");
    try {
      for (const [tool, args] of [
        ["getActiveSql", {}], ["getActiveConnectionContext", {}], ["getSchemaSummary", {}], ["getTableIndexes", { schema: "public", table: "salaries" }],
        ["explainSql", { sql: "SELECT 1" }], ["getLatestSqlExecutionError", {}], ["proposeSqlEdit", { sql: "SELECT 2", rationale: "x" }], ["executeSql", { sql: "SELECT 1" }],
        ["executeSql", { sql: "SELECT 1", connectionId: "hr" }],
      ] as const) {
        await expect(bridge.handleRequest(request(tool, tool, args))).rejects.toMatchObject({ code: "rejected", message: expect.stringContaining("MCP access is disabled") });
      }
      await expect(bridge.handleRequest(request("list", "listConnections"))).resolves.toEqual({ activeConnectionId: null, connections: [] });
      expect(approval).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    } finally { rpc.mockRestore(); }
  });

  it("read-only access refuses writes before asking for approval and lets reads through", async () => {
    const approval = vi.fn(approveAsSuggested);
    const bridge = setup(withConnections({ activeTab: { id: "tab", title: "Query", sql: "SELECT 1" }, activeConnection: { id: "ro", label: "Replica", dialect: "postgres", mcpAccess: "read" }, editor: null }), approval);
    const rpc = vi.spyOn(backend, "call").mockResolvedValue({ rows: [] });
    try {
      for (const sql of ["DELETE FROM users", "UPDATE users SET admin = true", "DROP TABLE users", "SELECT 1; DELETE FROM users", "SELECT * FROM users FOR UPDATE"]) {
        await expect(bridge.handleRequest(request(sql, "executeSql", { sql }))).rejects.toMatchObject({ code: "rejected", message: expect.stringContaining("read-only") });
      }
      expect(approval).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
      await bridge.handleRequest(request("read", "executeSql", { sql: "SELECT id FROM users" }));
      expect(approval).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith("mcp.ui.execute", { id: "read", listenerId: "test-listener", connectionId: "ro" });
    } finally { rpc.mockRestore(); }
  });

  it("read and write access still requires desktop approval for writes", async () => {
    const approval = vi.fn<ApproveExecution>(async () => ({ outcome: "rejected" }));
    const bridge = setup(withConnections({ activeTab: { id: "tab", title: "Query", sql: "SELECT 1" }, activeConnection: { id: "rw", label: "Dev", dialect: "postgres", mcpAccess: "write" }, editor: null }), approval);
    const rpc = vi.spyOn(backend, "call");
    try {
      await expect(bridge.handleRequest(request("write", "executeSql", { sql: "DELETE FROM users" }))).rejects.toMatchObject({ code: "rejected" });
      expect(approval).toHaveBeenCalledWith(expect.objectContaining({ sql: "DELETE FROM users" }));
      expect(rpc).not.toHaveBeenCalled();
    } finally { rpc.mockRestore(); }
  });
});

it("reports DuckDB for MongoDB SQL tabs and prevents MCP from executing through the native adapter", async () => {
  const bridge = setup(withConnections({ activeTab: { id: "tab", title: "Mongo SQL", sql: "SELECT 1", mongoSqlMode: true }, activeConnection: { id: "mongo", label: "MongoDB", dialect: "mongodb", mcpAccess: "read" }, editor: null }));
  await expect(bridge.handleRequest({ id: "mode", tool: "getActiveSql", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({ sql: "SELECT 1", dialect: "duckdb" });
  await expect(bridge.handleRequest({ id: "execute", tool: "executeSql", args: { sql: '{"collection":"items","operation":"deleteMany","filter":{}}' }, expiresAt: Date.now() + 60_000 })).rejects.toThrow("query editor");
});
