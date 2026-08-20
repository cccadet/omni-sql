import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { SqlCommandLibrary } from "./SqlCommandLibrary";

test("filters commands for the active dialect and inserts a selected template", () => {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(<LanguageProvider><SqlCommandLibrary open dialect="postgres" onClose={onClose} onInsert={onInsert} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText("Search commands by name or intent…"), { target: { value: "criar índice" } });
  expect(screen.getByText("Create index")).toBeTruthy();
  expect(screen.queryByText("Upsert with MERGE")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Insert into editor" }));
  expect(onInsert.mock.calls[0]?.[0]).toContain("CREATE INDEX");
  expect(onClose).toHaveBeenCalledOnce();
});
