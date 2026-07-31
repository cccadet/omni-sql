import { render, screen } from "@testing-library/react";
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
  expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
});
