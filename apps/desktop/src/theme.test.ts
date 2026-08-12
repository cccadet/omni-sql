import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OMNISQL_DARK, OMNISQL_LIGHT } from "./lib/monaco-config";
import { omniDarkTheme, omniLightTheme, useEditorMonacoTheme, useTheme, useThemeValue } from "./theme";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("uses a stored theme, persists toggles, and returns the matching Fluent theme", () => {
  localStorage.setItem("omni-sql:theme", "light");
  const { result } = renderHook(() => useTheme());
  expect(result.current.name).toBe("light");
  expect(result.current.theme).toBe(omniLightTheme);

  act(() => result.current.toggle());
  expect(result.current.name).toBe("dark");
  expect(result.current.theme).toBe(omniDarkTheme);
  expect(localStorage.getItem("omni-sql:theme")).toBe("dark");
});

it("falls back to the operating system preference when storage has no valid theme", () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true }),
  });
  const { result } = renderHook(() => useThemeValue());
  expect(result.current).toBe(omniLightTheme);
});

it("selects the Monaco theme matching the application theme", () => {
  expect(useEditorMonacoTheme("light")).toBe(OMNISQL_LIGHT);
  expect(useEditorMonacoTheme("dark")).toBe(OMNISQL_DARK);
});
