import "./index.css";
import "./monaco-environment";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, createCSSRuleFromTheme } from "@fluentui/react-components";
import App from "./App";
import { useTheme } from "./theme";
import { LanguageProvider } from "./i18n";

export function ThemedApp() {
  const { theme, name, toggle } = useTheme();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", name);
    document.documentElement.style.colorScheme = name;
  }, [name]);

  return (
    <LanguageProvider>
      <FluentProvider theme={theme} data-theme={name}>
        <App themeName={name} onToggleTheme={toggle} />
        <style>{createCSSRuleFromTheme("body", theme)}</style>
      </FluentProvider>
    </LanguageProvider>
  );
}

const root = createRoot(document.getElementById("app")!);
root.render(
  <StrictMode>
    <ThemedApp />
  </StrictMode>,
);
