import "./index.css";
import "./monaco-environment";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, createCSSRuleFromTheme } from "@fluentui/react-components";
import App from "./App";
import { useThemeValue } from "./theme";

export function ThemedApp() {
  const theme = useThemeValue();
  return (
    <FluentProvider theme={theme}>
      <App />
      <style>{createCSSRuleFromTheme("body", theme)}</style>
    </FluentProvider>
  );
}

const root = createRoot(document.getElementById("app")!);
root.render(
  <StrictMode>
    <ThemedApp />
  </StrictMode>,
);
