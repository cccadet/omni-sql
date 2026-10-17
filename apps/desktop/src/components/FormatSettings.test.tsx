import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, test, expect, vi } from "vitest";
import { FormatSettings } from "./FormatSettings";
import { LanguageProvider } from "../i18n";
import { DEFAULT_FORMATTER_SETTINGS } from "../lib/format-sql";

beforeEach(() => localStorage.clear());

test("selects Chinese in settings and restores it when reopened", () => {
  const settings = <LanguageProvider>
    <FormatSettings open dialect="postgres" settings={DEFAULT_FORMATTER_SETTINGS} onClose={vi.fn()} onSave={vi.fn()} />
  </LanguageProvider>;
  const view = render(settings);
  fireEvent.click(screen.getByRole("tab", { name: "Language" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "zh-CN" } });
  expect(screen.getByRole("combobox", { name: "语言" })).toHaveProperty("value", "zh-CN");
  expect(screen.getByRole("button", { name: "保存设置" })).toBeTruthy();
  expect(localStorage.getItem("omni-sql:language")).toBe("zh-CN");
  view.unmount();
  render(settings);
  expect(screen.getByRole("tab", { name: "编辑器" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "语言" }));
  expect(screen.getByRole("combobox", { name: "语言" })).toHaveProperty("value", "zh-CN");
});

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

  expect(screen.getByRole("tab", { name: "Editor" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("button", { name: "Save settings" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "SQL formatting" }));
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

  fireEvent.click(screen.getByRole("tab", { name: "SQL formatting" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Keywords" }), { target: { value: "lower" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Input SQL" }), { target: { value: "SELECT id FROM users" } });
  expect(screen.getByLabelText("Formatted SQL").textContent).toMatch(/select/);
  fireEvent.click(screen.getByRole("tab", { name: "Language" }));
  const languageSelect = screen.getByRole("combobox", { name: "Language" });
  expect(languageSelect).toBeTruthy();
  expect(languageSelect.closest(".fui-Select")?.parentElement?.classList.contains("omni-settings-language-field")).toBe(true);
  expect(languageSelect.closest(".fui-Select")?.getAttribute("style")).toBeNull();
  expect(screen.queryByLabelText("Shortcut")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "SQL formatting" }));
  expect(screen.getByRole("textbox", { name: "Shortcut" })).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Keywords" }) as HTMLSelectElement).value).toBe("lower");
  expect((screen.getByRole("textbox", { name: "Input SQL" }) as HTMLTextAreaElement).value).toBe("SELECT id FROM users");
  expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
});
