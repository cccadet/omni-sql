import { useCallback, useEffect, useState } from "react";
import { createLightTheme, createDarkTheme, type Theme } from "@fluentui/react-components";
import { OMNISQL_DARK, OMNISQL_LIGHT } from "./lib/monaco-config";

const THEME_KEY = "omni-sql:theme";

export type ThemeName = "light" | "dark";

/** Cores de identidade omni-sql extraídas do logo. */
const OMNI_BRAND = {
  10: "#FFF8E7",
  20: "#FFEFC2",
  30: "#FFE6A3",
  40: "#FFD97A",
  50: "#FFCD52",
  60: "#FFB93D", // hover
  70: "#F6A51A", // principal
  80: "#E09000",
  90: "#C97A00", // escuro
  100: "#A66400",
  110: "#8A5200",
  120: "#6D4100",
  130: "#523100",
  140: "#382200",
  150: "#211400",
  160: "#0F0900",
} as const;

const omniLightBase = createLightTheme(OMNI_BRAND);
const omniDarkBase = createDarkTheme(OMNI_BRAND);

/** Tema claro omni-sql. */
export const omniLightTheme: Theme = {
  ...omniLightBase,
  colorNeutralBackground1: "#F6F6F6",
  colorNeutralBackground2: "#F8F8F8",
  colorNeutralBackground3: "#EFEFEF",
  colorNeutralBackground4: "#E8E8E8",
  colorNeutralForeground1: "#111111",
  colorNeutralForeground2: "#333333",
  colorNeutralForeground3: "#666666",
  colorNeutralStroke1: "#D1D1D1",
  colorNeutralStroke2: "#E0E0E0",
  colorBrandBackground: "#F6A51A",
  colorBrandBackgroundHover: "#FFB93D",
  colorBrandBackgroundPressed: "#C97A00",
  colorBrandForeground1: "#F6A51A",
  colorBrandForeground2: "#C97A00",
  colorBrandStroke1: "#F6A51A",
  colorBrandStroke2: "#FFB93D",
  colorCompoundBrandForeground1: "#F6A51A",
  colorCompoundBrandForeground1Hover: "#FFB93D",
  colorCompoundBrandForeground1Pressed: "#C97A00",
  colorNeutralForegroundOnBrand: "#111111",
  colorBrandForegroundInverted: "#F6A51A",
  colorBrandForegroundInvertedHover: "#FFB93D",
  colorBrandForegroundInvertedPressed: "#C97A00",
};

/** Tema escuro omni-sql. */
export const omniDarkTheme: Theme = {
  ...omniDarkBase,
  colorNeutralBackground1: "#1C1C1C",
  colorNeutralBackground2: "#252526",
  colorNeutralBackground3: "#2A2A2A",
  colorNeutralBackground4: "#333333",
  colorNeutralForeground1: "#F5F5F5",
  colorNeutralForeground2: "#CCCCCC",
  colorNeutralForeground3: "#999999",
  colorNeutralStroke1: "#3C3C3C",
  colorNeutralStroke2: "#464647",
  colorBrandBackground: "#F6A51A",
  colorBrandBackgroundHover: "#FFB93D",
  colorBrandBackgroundPressed: "#C97A00",
  colorBrandForeground1: "#F6A51A",
  colorBrandForeground2: "#FFB93D",
  colorBrandStroke1: "#F6A51A",
  colorBrandStroke2: "#FFB93D",
  colorCompoundBrandForeground1: "#F6A51A",
  colorCompoundBrandForeground1Hover: "#FFB93D",
  colorCompoundBrandForeground1Pressed: "#C97A00",
  colorNeutralForegroundOnBrand: "#111111",
  colorBrandForegroundInverted: "#F6A51A",
  colorBrandForegroundInvertedHover: "#FFB93D",
  colorBrandForegroundInvertedPressed: "#C97A00",
};

const THEMES: Record<ThemeName, Theme> = {
  light: omniLightTheme,
  dark: omniDarkTheme,
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

/** Tema do Monaco Editor conforme o tema do app. */
export function useEditorMonacoTheme(name: ThemeName): typeof OMNISQL_DARK | typeof OMNISQL_LIGHT {
  return name === "dark" ? OMNISQL_DARK : OMNISQL_LIGHT;
}
