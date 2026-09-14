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
  expect(screen.getByRole("tab", { name: "Editor" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Language" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
});

test("keeps Monaco word-based suggestions enabled by default and allows disabling them", () => {
  const onSave = vi.fn();
  render(
    <LanguageProvider>
      <FormatSettings
        open
        dialect="postgres"
        settings={DEFAULT_FORMATTER_SETTINGS}
        onClose={vi.fn()}
        onSave={onSave}
      />
    </LanguageProvider>,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
  const checkbox = screen.getByRole("checkbox", { name: "Suggest words from the current SQL document" }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ wordBasedSuggestions: false }));
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
  const languageSelect = screen.getByRole("combobox", { name: "Language" });
  expect(languageSelect).toBeTruthy();
  expect(languageSelect.closest(".fui-Select")?.parentElement?.classList.contains("omni-settings-language-field")).toBe(true);
  expect(languageSelect.closest(".fui-Select")?.getAttribute("style")).toBeNull();
  expect(screen.queryByLabelText("Shortcut")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "SQL formatting" }));
  expect(screen.getByRole("textbox", { name: "Shortcut" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
});
