import { test, assert, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { createCopilotVsCodeMcpConfig, StatusBar } from "./StatusBar";
import type { ConnectionEntry } from "../lib/backend";
import { LanguageProvider } from "../i18n";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

test("StatusBar: shows connection and result info", () => {
  const connection: ConnectionEntry = {
    id: "c1",
    label: "Local Postgres",
    dialect: "postgres",
    endpoint: "localhost",
    user: "postgres",
  };

  renderWithLanguage(
    <StatusBar
      connection={connection}
      result={{
        columns: [{ name: "id", dataType: "int", nullable: false }],
        rows: [[1], [2]],
        rowsMoreAvailable: false,
        elapsedMs: 12,
      }}
      cursorPosition={{ line: 3, column: 10 }}
    />,
  );

  assert.ok(screen.getByText("Local Postgres"));
  assert.ok(screen.getByText("PostgreSQL"));
  assert.ok(screen.getByText(/2 row\(s\)/));
  assert.ok(screen.getByText(/1 column\(s\)/));
  assert.ok(screen.getByText(/12ms/));
  assert.ok(screen.getByText("Ln 3, Col 10"));
});

test("StatusBar: shows no connection when empty", () => {
  renderWithLanguage(<StatusBar />);
  assert.ok(screen.getByText("No results"));
});

test("StatusBar: makes offline database health explicit", () => {
  renderWithLanguage(<StatusBar connection={{ id: "c1", label: "Warehouse", dialect: "postgres", endpoint: "db", user: "u" }} health="offline" />);
  assert.ok(screen.getByText("Failure"));
});

test("StatusBar: makes online database health explicit", () => {
  renderWithLanguage(<StatusBar connection={{ id: "c1", label: "Warehouse", dialect: "postgres", endpoint: "db", user: "u" }} health="online" />);
  assert.ok(screen.getByText("Success"));
});

test("StatusBar: shows and opens available update", () => {
  vi.mocked(openUrl).mockResolvedValue(undefined);
  vi.stubGlobal("confirm", vi.fn(() => true));
  renderWithLanguage(<StatusBar update={{ available: true, version: "v1.2.3", releaseUrl: "https://example.com/release" }} />);

  const update = screen.getByRole("button", { name: "Update v1.2.3 available" });
  fireEvent.click(update);
  assert.deepEqual(vi.mocked(openUrl).mock.calls[0], ["https://example.com/release"]);
  assert.deepEqual(vi.mocked(confirm).mock.calls[0], ["Version v1.2.3 is available. Open GitHub Releases?"]);
  vi.mocked(openUrl).mockReset();
  vi.unstubAllGlobals();
});

test("StatusBar: keeps release closed when user declines", () => {
  vi.stubGlobal("confirm", vi.fn(() => false));
  renderWithLanguage(<StatusBar update={{ available: true, version: "1.2.3", releaseUrl: "https://example.com/release" }} />);

  fireEvent.click(screen.getByRole("button", { name: "Update v1.2.3 available" }));
  assert.equal(vi.mocked(openUrl).mock.calls.length, 0);
  vi.unstubAllGlobals();
});

test("StatusBar: makes update check result visible", () => {
  renderWithLanguage(<StatusBar updateStatus={{ state: "up-to-date" }} />);
  assert.ok(screen.getByText("Omni SQL is up to date."));
});

test("StatusBar: hides unavailable update", () => {
  renderWithLanguage(<StatusBar update={{ available: false, version: "1.2.3" }} />);
  assert.equal(screen.queryByRole("button", { name: /Update/ }), null);
});

test("StatusBar: produces the VS Code GitHub Copilot MCP configuration from the safe launcher", async () => {
  const launcher = { command: "/usr/bin/node", args: ["/opt/mcp/index.js", "/run/mcp.json"] };
  vi.mocked(invoke).mockResolvedValue(launcher);
  renderWithLanguage(<StatusBar mcpState="connected" mcpStatus={{ uiConnected: true, queueSize: 1, inFlight: 0, maxQueueSize: 8, timeoutMs: 30_000 }} />);

  fireEvent.click(screen.getByRole("button", { name: /MCP: MCP connected/ }));
  expect(await screen.findByText("GitHub Copilot (VS Code)")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy GitHub Copilot configuration" })).toBeTruthy();
  assert.deepEqual(JSON.parse(createCopilotVsCodeMcpConfig(launcher)), {
    servers: {
      "omni-sql": {
        command: "/usr/bin/node",
        args: ["/opt/mcp/index.js", "/run/mcp.json"],
      },
    },
  });
  expect(screen.queryByText(/token/i)).toBeTruthy();
});

test("StatusBar: clears launcher config when refresh fails", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("MCP runtime unavailable"));
  renderWithLanguage(<StatusBar mcpState="listening" />);
  fireEvent.click(screen.getByRole("button", { name: /MCP: MCP ready/ }));
  expect(await screen.findByText("MCP runtime unavailable")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Configure client" })).toBeNull();
});

test("StatusBar: shows HTTP endpoint without exposing descriptor data", async () => {
  vi.mocked(invoke).mockResolvedValue({ command: "node", args: [], endpoint: "http://127.0.0.1:41920/mcp", token: "secret-token" });
  renderWithLanguage(<StatusBar mcpState="listening" />);

  fireEvent.click(screen.getByRole("button", { name: /MCP: MCP ready/ }));
  expect(await screen.findByText("HTTP endpoint")).toBeTruthy();
  expect(screen.getByText("http://127.0.0.1:41920/mcp")).toBeTruthy();
  expect(screen.queryByText("secret-token")).toBeNull();
  assert.equal(screen.getAllByRole("button", { name: "Copy HTTP endpoint" }).length, 1);
});
