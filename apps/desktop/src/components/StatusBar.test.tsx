import { test, assert, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { createCopilotVsCodeMcpConfig, StatusBar } from "./StatusBar";
import { backend } from "../lib/backend";
import type { ConnectionEntry } from "../lib/backend";
import type * as BackendModule from "../lib/backend";
import { LanguageProvider } from "../i18n";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof BackendModule>();
  return { ...actual, backend: { call: vi.fn() } };
});

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
  assert.ok(screen.getByText(/12 ms/));
  assert.ok(screen.getByText("Ln 3, Col 10"));
});

test("StatusBar: shows no connection when empty", () => {
  renderWithLanguage(<StatusBar />);
  assert.ok(screen.getByText("No results"));
});

test("StatusBar: makes offline database health explicit", () => {
  renderWithLanguage(<StatusBar connection={{ id: "c1", label: "Warehouse", dialect: "postgres", endpoint: "db", user: "u" }} health="offline" />);
  assert.ok(screen.getByText("Offline"));
});

test("StatusBar: makes online database health explicit", () => {
  renderWithLanguage(<StatusBar connection={{ id: "c1", label: "Warehouse", dialect: "postgres", endpoint: "db", user: "u" }} health="online" />);
  assert.ok(screen.getByText("Connected"));
});

test("StatusBar: matches the header connection details", () => {
  renderWithLanguage(<StatusBar connection={{ id: "s3", label: "Ceph Bsau - HOMO", dialect: "s3", endpoint: "s3://base-saude", user: "u" }} database="base-saude" health="online" />);
  const footer = screen.getByText("Ceph Bsau - HOMO").closest("footer");
  assert.ok(footer);
  const positions = ["Ceph Bsau - HOMO", "S3", "Database", "base-saude", "Connected"].map((label) => footer.textContent?.indexOf(label) ?? -1);
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]!)));
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

test("StatusBar: starts an in-app update when an installer handler is available", () => {
  const onInstallUpdate = vi.fn();
  renderWithLanguage(<StatusBar update={{ available: true, version: "1.2.3" }} onInstallUpdate={onInstallUpdate} />);

  fireEvent.click(screen.getByRole("button", { name: "Update v1.2.3 available" }));
  assert.equal(onInstallUpdate.mock.calls.length, 1);
  assert.equal(vi.mocked(openUrl).mock.calls.length, 0);
});

test("StatusBar: exposes updater download progress", () => {
  const { rerender } = renderWithLanguage(<StatusBar updateStatus={{ state: "downloading", percent: 42 }} />);
  assert.ok(screen.getByText("Downloading update… 42%"));

  rerender(<LanguageProvider><StatusBar updateStatus={{ state: "installing" }} /></LanguageProvider>);
  assert.ok(screen.getByText("Installing update…"));
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
  vi.mocked(backend.call).mockResolvedValue({ endpoint: null, sessions: 0 });
  vi.mocked(invoke).mockResolvedValue(launcher);
  renderWithLanguage(<StatusBar mcpState="connected" mcpStatus={{ uiConnected: true, queueSize: 1, inFlight: 0, maxQueueSize: 8, timeoutMs: 30_000 }} />);

  fireEvent.click(screen.getByRole("button", { name: /MCP: MCP active/ }));
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
  vi.mocked(backend.call).mockResolvedValue({ endpoint: null, sessions: 0 });
  vi.mocked(invoke).mockRejectedValue(new Error("MCP runtime unavailable"));
  renderWithLanguage(<StatusBar mcpState="listening" />);
  fireEvent.click(screen.getByRole("button", { name: /MCP: MCP ready/ }));
  expect(await screen.findByText("MCP runtime unavailable")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Configure client" })).toBeNull();
});

test("StatusBar: shows HTTP endpoint without exposing descriptor data", async () => {
  vi.mocked(invoke).mockResolvedValue({ command: "node", args: [] });
  vi.mocked(backend.call).mockResolvedValue({ endpoint: "http://127.0.0.1:41922/mcp", sessions: 1 });
  renderWithLanguage(<StatusBar mcpState="listening" />);

  fireEvent.click(screen.getByRole("button", { name: /MCP: MCP ready/ }));
  fireEvent.click(await screen.findByRole("tab", { name: "HTTP" }));
  expect(await screen.findByText("HTTP endpoint")).toBeTruthy();
  expect(screen.getByText("http://127.0.0.1:41922/mcp")).toBeTruthy();
  expect(screen.queryByText("secret-token")).toBeNull();
  assert.equal(screen.getAllByRole("button", { name: "Copy HTTP endpoint" }).length, 1);
});

test("StatusBar: separates MCP configuration from activity and expands SQL on demand", async () => {
  const launcher = { command: "/usr/bin/node", args: ["/opt/mcp/index.js", "/run/mcp.json"] };
  vi.mocked(invoke).mockResolvedValue(launcher);
  vi.mocked(backend.call).mockResolvedValue({
    entries: [{
      id: "1",
      tool: "proposeSqlEdit",
      receivedAt: 1700000000000,
      status: "completed",
      sql: "SELECT 1",
      rationale: "Improve query",
    }],
  });
  renderWithLanguage(<StatusBar mcpState="connected" mcpStatus={{ uiConnected: true, queueSize: 1, inFlight: 0, maxQueueSize: 8, timeoutMs: 30_000 }} />);

  fireEvent.click(screen.getByRole("button", { name: /MCP: MCP active/ }));
  // Default tab: GitHub Copilot JSON, formatted and copyable.
  expect(await screen.findByRole("button", { name: "Copy GitHub Copilot configuration" })).toBeTruthy();
  expect(screen.queryByText("STDIO command")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "STDIO" }));
  expect(await screen.findByText("STDIO command")).toBeTruthy();
  expect(screen.getByText("Argument 1")).toBeTruthy();
  expect(screen.getByText("/usr/bin/node")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy argument 1" })).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  expect(await screen.findByText("proposeSqlEdit")).toBeTruthy();
  expect(screen.getByText("Improve query")).toBeTruthy();
  expect(screen.queryByText("SELECT 1")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show SQL" }));
  expect(screen.getByText("SELECT 1")).toBeTruthy();
  expect(screen.getByText("Success")).toBeTruthy();
  assert.equal(vi.mocked(backend.call).mock.calls.filter(([method]) => method === "mcp.history").length, 1);
});

test("StatusBar: shows empty state when no MCP requests were recorded", async () => {
  vi.mocked(invoke).mockResolvedValue({ command: "node", args: [] });
  vi.mocked(backend.call).mockResolvedValue({ entries: [] });
  renderWithLanguage(<StatusBar mcpState="listening" />);

  fireEvent.click(screen.getByRole("button", { name: /MCP: MCP ready/ }));
  fireEvent.click(await screen.findByRole("tab", { name: "Activity" }));
  expect(await screen.findByText("No MCP requests received yet.")).toBeTruthy();
});

test("StatusBar: starts and stops HTTP using a separate token and the actual listener endpoint", async () => {
  vi.mocked(invoke).mockResolvedValue({ command: "node", args: ["mcp.js", "runtime.json"] });
  vi.mocked(backend.call).mockImplementation(async (method) => method === "mcp.http.start" ? { endpoint: "http://127.0.0.1:41922/mcp", sessions: 0 } : { endpoint: null, sessions: 0 });
  renderWithLanguage(<StatusBar mcpState="listening" />);
  fireEvent.click(screen.getByRole("button", { name: /MCP: MCP ready/ }));
  fireEvent.click(await screen.findByRole("tab", { name: "HTTP" }));
  const token = screen.getByLabelText("HTTP access token");
  expect(token.getAttribute("type")).toBe("password");
  fireEvent.change(token, { target: { value: "a-separate-test-http-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Start HTTP" }));
  expect(await screen.findByText("http://127.0.0.1:41922/mcp")).toBeTruthy();
  expect(backend.call).toHaveBeenCalledWith("mcp.http.start", { token: "a-separate-test-http-token", port: 41922, allowedOrigins: [] });
  expect(screen.queryByText("a-separate-test-http-token")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Stop HTTP" }));
  expect(await screen.findByRole("button", { name: "Start HTTP" })).toBeTruthy();
  expect(backend.call).toHaveBeenCalledWith("mcp.http.stop", undefined);
});
