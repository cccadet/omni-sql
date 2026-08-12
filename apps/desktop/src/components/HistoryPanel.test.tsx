import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { HistoryPanel } from "./HistoryPanel";

const entries = [
  { id: "successful", sql: "SELECT *\nFROM orders", ok: true },
  { id: "failed", sql: "DELETE FROM orders", ok: false },
];

function renderHistory(open = true) {
  const onClose = vi.fn();
  const onClear = vi.fn();
  render(
    <LanguageProvider>
      <HistoryPanel open={open} entries={entries} onClose={onClose} onClear={onClear} />
    </LanguageProvider>,
  );
  return { onClose, onClear };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("does not render when closed and filters its visible history entries", () => {
  const { rerender } = render(
    <LanguageProvider>
      <HistoryPanel open={false} entries={entries} onClose={vi.fn()} onClear={vi.fn()} />
    </LanguageProvider>,
  );
  expect(screen.queryByText("History")).toBeNull();

  rerender(
    <LanguageProvider>
      <HistoryPanel open entries={entries} onClose={vi.fn()} onClear={vi.fn()} />
    </LanguageProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText("History..."), { target: { value: "delete" } });
  expect(screen.getByRole("button", { name: /DELETE FROM orders/ })).toBeTruthy();
  expect(screen.queryByText("SELECT *")).toBeNull();
  expect(screen.queryByText("No entries match filters.")).toBeNull();
});

it("clears, closes, selects, and copies a history entry", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { onClear, onClose } = renderHistory();

  fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
  fireEvent.click(screen.getByRole("button", { name: "Close history" }));
  expect(onClear).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole("button", { name: /Executed SQL.*SELECT/ }));
  expect(screen.getByLabelText("Query selecionada").textContent).toBe("SELECT *\nFROM orders");
  fireEvent.click(screen.getByRole("button", { name: "Selected query" }));
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("SELECT *\nFROM orders"));
  expect(await screen.findByRole("button", { name: "Success" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Back to history" }));
  expect(within(screen.getByText("2 result(s)").parentElement!).getByText("SELECT *")).toBeTruthy();
});
