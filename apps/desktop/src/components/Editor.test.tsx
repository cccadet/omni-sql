import { test, expect } from "vitest";
import { formatDiagnosticHoverLabel } from "../lib/diagnostic-label";

const translations = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

test.each([
  ["error", "Error"],
  ["warning", "Warning"],
  ["info", "Info"],
] as const)("uses localized diagnostic label for %s", (severity, expected) => {
  expect(formatDiagnosticHoverLabel(severity, (key) => translations[key as keyof typeof translations])).toBe(expected);
});
