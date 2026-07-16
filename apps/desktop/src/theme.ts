import { useCallback, useEffect, useState } from "react";
import { webDarkTheme, webLightTheme, type Theme } from "@fluentui/react-components";

const THEME_KEY = "omni-sql:theme";

export type ThemeName = "light" | "dark";

const THEMES: Record<ThemeName, Theme> = {
  light: webLightTheme,
  dark: webDarkTheme,
};

function loadThemeName(): ThemeName {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // localStorage indisponível
  }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function saveThemeName(name: ThemeName) {
  try {
    localStorage.setItem(THEME_KEY, name);
  } catch {
    // localStorage indisponível/cheio
  }
}

export function useTheme(): { theme: Theme; name: ThemeName; toggle: () => void } {
  const [name, setName] = useState<ThemeName>(loadThemeName);

  useEffect(() => {
    saveThemeName(name);
  }, [name]);

  const toggle = useCallback(() => {
    setName((current) => (current === "light" ? "dark" : "light"));
  }, []);

  return { theme: THEMES[name], name, toggle };
}

export function useThemeValue(): Theme {
  return useTheme().theme;
}
