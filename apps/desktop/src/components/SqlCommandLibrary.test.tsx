import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { SqlCommandLibrary } from "./SqlCommandLibrary";

test("filters commands for the active dialect and inserts a selected template", () => {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(<LanguageProvider><SqlCommandLibrary open dialect="postgres" onClose={onClose} onInsert={onInsert} /></LanguageProvider>);
  expect(screen.getByRole("dialog").classList.contains("omni-command-library-dialog")).toBe(true);
  expect(document.querySelector(".omni-command-library-list")).toBeTruthy();
  expect(document.querySelector(".omni-command-library-actions")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search commands by name or intent…"), { target: { value: "criar índice" } });
  expect(screen.getByText("Create index")).toBeTruthy();
  expect(screen.queryByText("Upsert with MERGE")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Insert into editor" }));
  expect(onInsert.mock.calls[0]?.[0]).toContain("CREATE INDEX");
  expect(onClose).toHaveBeenCalledOnce();
});
