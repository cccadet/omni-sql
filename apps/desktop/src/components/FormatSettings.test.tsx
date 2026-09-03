import { fireEvent, render, screen } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { FormatSettings } from "./FormatSettings";
import { LanguageProvider } from "../i18n";
import { DEFAULT_FORMATTER_SETTINGS } from "../lib/format-sql";

test("uses context-specific save label", () => {
  render(
    <LanguageProvider>
      <FormatSettings
        open
        dialect="postgres"
        settings={DEFAULT_FORMATTER_SETTINGS}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    </LanguageProvider>,
  );

  expect(screen.getByRole("button", { name: "Save formatting settings" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save connection" })).toBeNull();
  expect(screen.getByRole("dialog").classList.contains("omni-settings-dialog")).toBe(true);
  expect(document.querySelector(".omni-settings-body")).toBeTruthy();
  expect(document.querySelector(".omni-settings-actions")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "SQL formatting" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Language" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
});

test("switches settings tabs without losing formatting controls", () => {
  render(
    <LanguageProvider>
      <FormatSettings
        open
        dialect="postgres"
        settings={DEFAULT_FORMATTER_SETTINGS}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    </LanguageProvider>,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Language" }));
  expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
  expect(screen.queryByLabelText("Shortcut")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "SQL formatting" }));
  expect(screen.getByRole("textbox", { name: "Shortcut" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
});
