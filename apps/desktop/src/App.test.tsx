import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webDarkTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import { LanguageProvider } from "./i18n";
import { backend } from "./lib/backend";

const editorMockState = vi.hoisted(() => ({
  selection: null as { sql: string; start: number } | null,
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("./theme", () => ({ useEditorMonacoTheme: () => "test-monaco-theme" }));
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
  editorMockState.selection = null;
  vi.mocked(getVersion).mockResolvedValue("0.1.0");
  vi.mocked(listen).mockResolvedValue(() => undefined);
  call.mockReset();
  call.mockImplementation(async (method) => {
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
        if (runError) {
          diagnosis = [{ message: "syntax error", severity: "error", start: 0, end: 1, source: "database" }];
          throw runError;
        }
        return {
          columns: [{ name: "id", dataType: "integer", nullable: false }],
          rows: [[42]],
          rowsMoreAvailable: false,
          elapsedMs: 3,
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

describe("App execution flow", () => {
  it("runs current SQL and renders returned rows", async () => {
    renderApp();

    await connectToDatabase();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith("query.run", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      limit: 1000,
    }));
    expect(await screen.findByText("42")).toBeTruthy();
    expect(screen.getByText("1 of 1 rows")).toBeTruthy();
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
    }));
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
    }));
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
    }));
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
    }));
  });

  it("shows execution errors in result messages", async () => {
    runError = new Error("query failed");
    renderApp();

    await connectToDatabase();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("query failed")).toBeTruthy();
    expect(call).toHaveBeenCalledWith("query.run", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      limit: 1000,
    });
    await waitFor(() => expect(call).toHaveBeenCalledWith("query.diagnose", {
      connectionId: "conn-1",
      sql: "SELECT 1",
    }));
    expect(await screen.findByText("syntax error")).toBeTruthy();
  });
});
