import { describe, expect, it, vi } from "vitest";
import { McpUiBridge, McpUiError, type McpUiState } from "./mcp-ui-bridge";

function setup(state: McpUiState) {
  return new McpUiBridge({
    readState: () => state,
    getSchemaSummary: vi.fn(async (connectionId) => ({ connectionId, schemas: [] })),
    openTab: vi.fn(() => true),
    proposeEdit: vi.fn(async () => "approved" as const),
    onStatus: vi.fn(),
  }, "test-listener");
}

describe("MCP UI bridge tools", () => {
  it("returns full active SQL and safe connection context", async () => {
    const bridge = setup({
      activeTab: { id: "tab-1", title: "Query", sql: "SELECT state" },
      activeConnection: { id: "opaque-id", label: "Warehouse", dialect: "postgres" },
      editor: { getAllText: () => "SELECT current", getSelectionOrCurrent: () => ({ sql: "SELECT current", start: 0 }) },
    });

    await expect(bridge.handleRequest({ id: "1", tool: "getActiveSql", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({ sql: "SELECT current" });
    await expect(bridge.handleRequest({ id: "2", tool: "getActiveConnectionContext", args: {}, expiresAt: Date.now() + 60_000 })).resolves.toEqual({
      connectionId: "opaque-id", label: "Warehouse", dialect: "postgres",
    });
  });

  it("opens new tab without mutating existing tab", async () => {
    const openTab = vi.fn(() => true);
    const bridge = new McpUiBridge({
      readState: () => ({ activeTab: { id: "old", title: "Old", sql: "SELECT old" }, activeConnection: null, editor: null }),
      getSchemaSummary: vi.fn(async (connectionId) => ({ connectionId, schemas: [] })),
      openTab,
      proposeEdit: vi.fn(),
      onStatus: vi.fn(),
    }, "test-listener");
    await expect(bridge.handleRequest({ id: "1", tool: "openSqlTab", args: { title: "New", sql: "SELECT new" }, expiresAt: Date.now() + 60_000 })).resolves.toEqual({ opened: true });
    expect(openTab).toHaveBeenCalledWith({ title: "New", sql: "SELECT new" });
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
      openTab: vi.fn(() => true),
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
