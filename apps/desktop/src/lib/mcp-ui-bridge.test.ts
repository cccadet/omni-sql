import { describe, expect, it, vi } from "vitest";
import type { SqlExecutionError } from "@omni-sql/ts-types";
import { McpUiBridge, McpUiError, makeListenerId, type McpUiState } from "./mcp-ui-bridge";

function setup(state: McpUiState) {
  return new McpUiBridge({
    readState: () => state,
    getSchemaSummary: vi.fn(async (connectionId) => ({ connectionId, schemas: [] })),
    proposeEdit: vi.fn(async () => "approved" as const),
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
      proposeEdit: vi.fn(),
      onStatus: vi.fn(),
    }, "test-listener");
    await expect(bridge.handleRequest({ id: "1", tool: "getSchemaSummary", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({
      connectionId: "conn-1", schemas: [{ name: "public", relations: [] }],
    });
    changeDuringRead = true;
    connectionId = "conn-1";
    await expect(bridge.handleRequest({ id: "2", tool: "getSchemaSummary", args: {}, expiresAt: Date.now() + 60_000 })).rejects.toMatchObject({ code: "stale" });
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
