import { fireEvent, render, screen } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { Toolbar } from "./Toolbar";

vi.mock("@fluentui/react-icons", () => {
  const Icon = () => null;
  return {
    AddRegular: Icon,
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
  expect(screen.getByRole("group", { name: "Tab actions" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "New SQL tab" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open saved tab" })).toBeTruthy();
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
