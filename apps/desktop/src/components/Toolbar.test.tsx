import { fireEvent, render, screen } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { Toolbar } from "./Toolbar";

vi.mock("@fluentui/react-icons", () => {
  const Icon = () => null;
  return {
    AddRegular: Icon,
    ArrowLeftRegular: Icon,
    ArrowSyncRegular: Icon,
    BookRegular: Icon,
    DatabaseRegular: Icon,
    CopyRegular: Icon,
    DeleteRegular: Icon,
    EditRegular: Icon,
    FolderOpenRegular: Icon,
    HistoryRegular: Icon,
    MoreVerticalRegular: Icon,
    PanelLeftContractRegular: Icon,
    PanelLeftExpandRegular: Icon,
    PlayRegular: Icon,
    SaveRegular: Icon,
    SettingsRegular: Icon,
    StopRegular: Icon,
    WrenchRegular: Icon,
  };
});

test("runs local analysis from the execution toolbar and blocks it during a query or import", () => {
  const onAnalyzeLocally = vi.fn();
  const view = (running = false, analyzingLocally = false, globalOnly = false) => <LanguageProvider>
    <Toolbar activeConnectionId="mongo" running={running} analyzingLocally={analyzingLocally} onAnalyzeLocally={onAnalyzeLocally} globalOnly={globalOnly} />
  </LanguageProvider>;
  const { rerender } = render(view());
  fireEvent.click(screen.getByRole("button", { name: "Analyze locally" }));
  expect(onAnalyzeLocally).toHaveBeenCalledOnce();
  rerender(view(true));
  expect((screen.getByRole("button", { name: "Analyze locally" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(view(false, true));
  expect((screen.getByRole("button", { name: "Importing source data…" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(view(false, false, true));
  expect(screen.queryByRole("button", { name: "Analyze locally" })).toBeNull();
});

test("renders multi-statement modal and row limit in English", () => {
  render(
    <LanguageProvider>
      <Toolbar activeConnectionId={null} pendingRunCount={2} onRunChoice={vi.fn()} onRunChoiceCancel={vi.fn()} />
    </LanguageProvider>,
  );
  expect(screen.getByText("This tab contains multiple SQL statements")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Run current SQL statement" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Run all (2)" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "10 rows" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save Tab" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Toggle sidebar" }).getAttribute("title")).toBe("Toggle sidebar");
  expect(screen.getByRole("button", { name: "Run" }).getAttribute("title")).toBe("Run current SQL statement (Ctrl+Enter)");
  expect(screen.getByRole("button", { name: "Explain SQL" }).getAttribute("title")).toBe("Explain SQL");
});

test("exposes the multi-statement chooser as a dismissible dialog", () => {
  const onRunChoiceCancel = vi.fn();
  render(
    <LanguageProvider>
      <Toolbar activeConnectionId={null} pendingRunCount={2} onRunChoiceCancel={onRunChoiceCancel} />
    </LanguageProvider>,
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onRunChoiceCancel).toHaveBeenCalledOnce();
});

test("shows the visible cancel action while a query is running", () => {
  const onCancelRun = vi.fn();
  render(
    <LanguageProvider>
      <Toolbar activeConnectionId="connection-1" running onCancelRun={onCancelRun} />
    </LanguageProvider>,
  );
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(cancel.classList.contains("omni-cancel-run")).toBe(true);
  expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  fireEvent.click(cancel);
  expect(onCancelRun).toHaveBeenCalledOnce();
});

test("keeps global actions together in analysis mode", () => {
  render(
    <LanguageProvider>
      <Toolbar activeConnectionId="connection-1" globalOnly />
    </LanguageProvider>,
  );
  expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  expect(screen.getByRole("group", { name: "Settings" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "SQL command library" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "History" })).toBeTruthy();
});

test("opens saved SQL and imports files from labeled secondary actions", () => {
  const onOpen = vi.fn();
  const onImportLocalFile = vi.fn();
  render(<LanguageProvider><Toolbar activeConnectionId={null} onOpen={onOpen} onImportLocalFile={onImportLocalFile} /></LanguageProvider>);
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByRole("menuitem", { name: "Send to Analyze locally" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("menuitem", { name: "Open saved tab" }));
  expect(onOpen).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Import file" }));
  expect(onImportLocalFile).toHaveBeenCalledOnce();
});
