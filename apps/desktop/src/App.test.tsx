import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webDarkTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import { LanguageProvider } from "./i18n";
import { backend } from "./lib/backend";
import { pickOpenPath, pickSavePath, readSqlFile, writeSqlFile } from "./lib/file-io";
import { MCP_MAX_ERROR_MESSAGE_BYTES } from "@omni-sql/ts-types";

const editorMockState = vi.hoisted(() => ({
  selection: null as { sql: string; start: number } | null,
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("./theme", () => ({ useEditorMonacoTheme: () => "test-monaco-theme" }));
vi.mock("./lib/file-io", () => ({
  basenameNoExt: (path: string) => path.split("/").at(-1)?.replace(/\.sql$/u, "") ?? path,
  pickOpenPath: vi.fn(),
  pickSavePath: vi.fn(),
  readSqlFile: vi.fn(),
  writeSqlFile: vi.fn(),
}));
vi.mock("./components/Editor", async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import("react");
  const { splitStatements } = await import("./lib/sql-statements");
  const Editor = forwardRef<{
    insertAtCursor: () => void;
    getRunTarget: () => { selectionText: null; cursorOffset: number; currentStatement: null };
    getStatements: () => { text: string; start: number; end: number }[];
    getCurrentStatement: () => { text: string; start: number; end: number };
    getAllText: () => string;
    getSelectionOrCurrent: () => { sql: string; start: number };
    formatDocument: () => void;
    replaceTextRange: () => void;
  }, {
    value: string;
    onRun?: () => void;
    onRunAll?: () => void;
    diagnostics?: readonly { message: string }[];
  }>(({ value, onRun, onRunAll, diagnostics }, ref) => {
    useImperativeHandle(ref, () => ({
      insertAtCursor: () => undefined,
      getRunTarget: () => ({ selectionText: null, cursorOffset: value.length, currentStatement: null }),
      getStatements: () => splitStatements(value),
      getCurrentStatement: () => ({ text: value, start: 0, end: value.length }),
      getAllText: () => value,
      getSelectionOrCurrent: () => editorMockState.selection ?? { sql: value, start: 0 },
      formatDocument: () => undefined,
      replaceTextRange: () => undefined,
    }), [value]);
    return createElement(
      "div",
      null,
      createElement("textarea", { "aria-label": "SQL editor", readOnly: true, value }),
      createElement("button", { type: "button", "aria-label": "Editor run current", onClick: onRun }, "Editor run current"),
      createElement("button", { type: "button", "aria-label": "Editor run all", onClick: onRunAll }, "Editor run all"),
      diagnostics?.map((diagnostic) => createElement("div", { key: diagnostic.message }, diagnostic.message)),
    );
  });
  return { Editor };
});

const call = vi.mocked(backend.call);
let runError: Error | null;
let diagnosis: { message: string; severity: "error"; start: number; end: number; source: "database" }[];
let blockQueryRun: boolean;
let rejectBlockedQueryRun: ((reason?: unknown) => void) | null;

function seedSession(sql: string, queryLimit = 1000, connectionId: string | null = null) {
  localStorage.setItem("omni-sql:session", JSON.stringify({
    tabs: [{
      id: "tab-1",
      title: "Query 1",
      sql,
      queryLimit,
      connectionId,
      filePath: null,
      savedSql: null,
      error: null,
    }],
    activeTabId: "tab-1",
    counter: 1,
  }));
}

function renderApp() {
  return render(
    <FluentProvider theme={webDarkTheme}>
      <LanguageProvider>
        <App themeName="dark" onToggleTheme={vi.fn()} />
      </LanguageProvider>
    </FluentProvider>,
  );
}

async function connectToDatabase() {
  fireEvent.click(await screen.findByRole("option", { name: "Local Postgres" }));
  fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("connection.status", { connectionId: "conn-1" }));
}

beforeEach(() => {
  localStorage.clear();
  runError = null;
  diagnosis = [];
  blockQueryRun = false;
  rejectBlockedQueryRun = null;
  editorMockState.selection = null;
  vi.mocked(getVersion).mockResolvedValue("0.1.0");
  vi.mocked(listen).mockResolvedValue(() => undefined);
  call.mockReset();
  vi.mocked(pickOpenPath).mockResolvedValue(null);
  vi.mocked(pickSavePath).mockResolvedValue(null);
  vi.mocked(readSqlFile).mockResolvedValue("");
  vi.mocked(writeSqlFile).mockResolvedValue();
  call.mockImplementation(async (method, _params, signal) => {
    switch (method) {
      case "mcp.ui.next":
        throw new Error("MCP UI polling disabled in test");
      case "mcp.status":
        return { uiConnected: false, queueSize: 0, inFlight: 0 };
      case "connection.list":
        return {
          configs: [{ id: "conn-1", label: "Local Postgres", dialect: "postgres", endpoint: "localhost", user: "user" }],
        };
      case "connectionGroup.list":
        return { groups: [] };
      case "update.check":
        return { available: false };
      case "connection.status":
        return { online: true };
      case "metadata.listRelations":
        return { relations: [] };
      case "metadata.listFunctions":
        return { functions: [] };
      case "query.run":
        if (blockQueryRun) {
          return new Promise<never>((_resolve, reject) => {
            rejectBlockedQueryRun = reject;
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          });
        }
        if (runError) {
          diagnosis = [{ message: "syntax error", severity: "error", start: 0, end: 1, source: "database" }];
          throw runError;
        }
        return {
          columns: [{ name: "id", dataType: "integer", nullable: false }],
          rows: [[42]],
          rowsMoreAvailable: false,
          elapsedMs: 3,
          sql: "SELECT remote_payload_must_not_be_persisted",
        };
      case "query.analyzeEditability":
        return { editable: false, reason: null, table: null, pkColumns: [], selectStar: false, columns: [] };
      case "query.diagnose":
        return { diagnostics: diagnosis };
      default:
        return {};
    }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});


describe("App history persistence", () => {
  it("drops malformed storage entries while retaining valid legacy history", async () => {
    localStorage.setItem("omni-sql:history", JSON.stringify([
      "SELECT legacy",
      { sql: "SELECT failed", status: "failure" },
      { sql: "   " },
      { sql: 42 },
      { sql: "x".repeat(32 * 1024 + 1) },
      { sql: "SELECT unknown status", status: "unknown" },
    ]));

    renderApp();

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("omni-sql:history") ?? "null")).toEqual([
        { sql: "SELECT legacy" },
        { sql: "SELECT failed", ok: false },
        { sql: "SELECT unknown status" },
      ]);
    });
  });
});
describe("App execution flow", () => {
  it("runs current SQL and renders returned rows", async () => {
    renderApp();

    await connectToDatabase();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith("query.run", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      limit: 1000,
    }, expect.any(AbortSignal)));
    expect(await screen.findByText("42")).toBeTruthy();
    expect(screen.getByText("1 of 1 rows")).toBeTruthy();
  });

  it("persists only editor SQL when the backend response has untrusted fields", async () => {
    renderApp();
    await connectToDatabase();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("omni-sql:history") ?? "null")).toEqual([
        { sql: "SELECT 1", ok: true },
      ]);
    });
  });

  it("cancels active query from toolbar", async () => {
    blockQueryRun = true;
    renderApp();

    await connectToDatabase();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });

    fireEvent.click(cancel);
    fireEvent.click(cancel);

    await waitFor(() => expect(call).toHaveBeenCalledWith("query.cancel", { connectionId: "conn-1" }));
    expect(call.mock.calls.filter(([method]) => method === "query.cancel")).toHaveLength(1);
    expect(rejectBlockedQueryRun).toBeTruthy();
  });

  it("restores a persisted connection from the listed connections", async () => {
    seedSession("SELECT 1", 1000, "conn-1");
    renderApp();

    expect((await screen.findAllByText("Local Postgres")).length).toBeGreaterThan(0);
    await waitFor(() => expect(call).toHaveBeenCalledWith("connection.status", { connectionId: "conn-1" }));
  });

  it("runs selected current statement without other statements", async () => {
    seedSession("SELECT 1;\nSELECT 2");
    editorMockState.selection = { sql: "SELECT 1", start: 0 };
    renderApp();
    await connectToDatabase();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith("query.run", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      limit: 1000,
    }, expect.any(AbortSignal)));
  });

  it("runs all statements when editor requests it", async () => {
    seedSession("SELECT 1;\nSELECT 2");
    renderApp();
    await connectToDatabase();

    fireEvent.click(screen.getByRole("button", { name: "Editor run all" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith("query.run", {
      connectionId: "conn-1",
      sql: "SELECT 1;\nSELECT 2",
      limit: 1000,
    }, expect.any(AbortSignal)));
  });

  it("collects variables before running and substitutes submitted values", async () => {
    seedSession("SELECT * FROM users WHERE id = :id");
    renderApp();
    await connectToDatabase();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Value for :id"), { target: { value: "42" } });
    const submit = within(dialog).getByText("Run", { selector: "button" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(call).toHaveBeenCalledWith("query.run", {
      connectionId: "conn-1",
      sql: "SELECT * FROM users WHERE id = '42'",
      limit: 1000,
    }, expect.any(AbortSignal)));
  });

  it("sends configured query limit", async () => {
    renderApp();
    await connectToDatabase();

    fireEvent.change(screen.getByRole("combobox", { name: "Row limit" }), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith("query.run", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      limit: 500,
    }, expect.any(AbortSignal)));
  });

  it("shows execution errors in result messages", async () => {
    runError = Object.assign(new Error("query failed"), { code: -32000 });
    renderApp();

    await connectToDatabase();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("query failed")).toBeTruthy();
    expect(call).toHaveBeenCalledWith("query.run", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      limit: 1000,
    }, expect.any(AbortSignal));
    await waitFor(() => expect(call).toHaveBeenCalledWith("query.diagnose", {
      connectionId: "conn-1",
      sql: "SELECT 1",
    }));
    expect(await screen.findByText("syntax error")).toBeTruthy();

    await waitFor(() => {
      const session = JSON.parse(localStorage.getItem("omni-sql:session") ?? "null") as { tabs: Array<{ latestSqlExecutionError?: unknown }> };
      expect(session.tabs[0]?.latestSqlExecutionError).toEqual({
        message: "query failed",
        code: "-32000",
        position: { start: 0, end: 1 },
      });
    });

    runError = null;
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("42");
    await waitFor(() => {
      const session = JSON.parse(localStorage.getItem("omni-sql:session") ?? "null") as { tabs: Array<{ latestSqlExecutionError?: unknown }> };
      expect(session.tabs[0]?.latestSqlExecutionError).toBeNull();
    });
  });

  it("bounds persisted Unicode execution errors by UTF-8 byte length", async () => {
    runError = new Error("🚀".repeat(MCP_MAX_ERROR_MESSAGE_BYTES));
    renderApp();

    await connectToDatabase();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      const session = JSON.parse(localStorage.getItem("omni-sql:session") ?? "null") as {
        tabs: Array<{ latestSqlExecutionError?: { message?: string } }>;
      };
      const message = session.tabs[0]?.latestSqlExecutionError?.message;
      expect(message).toBeDefined();
      expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(MCP_MAX_ERROR_MESSAGE_BYTES);
      expect(message?.includes("\uFFFD")).toBe(false);
    });
  });
});

  it("confirms metadata refresh in an application dialog", async () => {
    renderApp();
    await connectToDatabase();

    fireEvent.click(screen.getByRole("button", { name: "Refresh metadata" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Do you want to force refresh this connection's metadata?")).toBeTruthy();
    expect(call).not.toHaveBeenCalledWith("metadata.introspect", { connectionId: "conn-1" });

    fireEvent.click(within(dialog).getByText("Refresh", { selector: "button" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("metadata.introspect", { connectionId: "conn-1" }));

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByPlaceholderText("Folder name"), { target: { value: "Reporting" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("connectionGroup.create", { name: "Reporting" }));
    expect(call).toHaveBeenCalledWith("connectionGroup.list", {});
  });

  it("writes Save As and opens selected SQL files in new tabs", async () => {
    vi.mocked(pickSavePath).mockResolvedValue("/tmp/report.sql");
    vi.mocked(pickOpenPath).mockResolvedValue("/tmp/import.sql");
    vi.mocked(readSqlFile).mockResolvedValue("SELECT imported");
    renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Save Tab" }));
    await waitFor(() => expect(writeSqlFile).toHaveBeenCalledWith("/tmp/report.sql", "SELECT 1"));
    expect(await screen.findByText("report")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open saved tab" }));
    await waitFor(() => expect(readSqlFile).toHaveBeenCalledWith("/tmp/import.sql"));
    expect(await screen.findByText("import")).toBeTruthy();
  });

describe("App update event listener", () => {
  it("reports an event-triggered update check as up to date", async () => {
    let checkForUpdates: (() => Promise<void>) | null = null;
    vi.mocked(listen).mockImplementation(async (_event, listener) => {
      checkForUpdates = listener as unknown as () => Promise<void>;
      return () => undefined;
    });

    renderApp();
    await waitFor(() => expect(checkForUpdates).not.toBeNull());

    await act(async () => {
      await checkForUpdates!();
    });

    expect((await screen.findByRole("status")).textContent).toBe("Omni SQL is up to date.");
    expect(call).toHaveBeenCalledWith("update.check", { currentVersion: "0.1.0" });
  });
});
