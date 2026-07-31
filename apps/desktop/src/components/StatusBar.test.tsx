import { test, assert, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { StatusBar } from "./StatusBar";
import type { ConnectionEntry } from "../lib/backend";
import { LanguageProvider } from "../i18n";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

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
