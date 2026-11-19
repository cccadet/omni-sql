import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { MemoryLimitDialog } from "./MemoryLimitDialog";
import { StatusBar } from "./StatusBar";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

it("shows the DuckDB memory limit in the status bar and opens its settings", () => {
  const open = vi.fn();
  const { rerender } = render(<LanguageProvider><StatusBar memoryLimitMb={2048} onMemoryLimitClick={open} /></LanguageProvider>);
  fireEvent.click(screen.getByRole("button", { name: "DuckDB memory limit: 2 GB" }));
  expect(open).toHaveBeenCalledOnce();
  rerender(<LanguageProvider><StatusBar memoryLimitMb={null} /></LanguageProvider>);
  expect(screen.queryByRole("button", { name: /DuckDB memory limit/ })).toBeNull();
});

it("applies the chosen limit and closes", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(<LanguageProvider><MemoryLimitDialog memoryLimitMb={512} onClose={close} onSave={save} /></LanguageProvider>);
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "DuckDB memory limit" }), { target: { value: "4096" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(4096);
});

it("keeps the dialog open with the engine error when the limit cannot be applied", async () => {
  const save = vi.fn().mockRejectedValue(new Error("another analytical operation is already running"));
  const close = vi.fn();
  render(<LanguageProvider><MemoryLimitDialog memoryLimitMb={512} onClose={close} onSave={save} /></LanguageProvider>);
  fireEvent.change(screen.getByRole("combobox", { name: "DuckDB memory limit" }), { target: { value: "1024" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("another analytical operation is already running")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
});
