import "./index.css";
import "./monaco-environment";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, createCSSRuleFromTheme } from "@fluentui/react-components";
import App from "./App";
import { useTheme } from "./theme";
import { LanguageProvider, readInstallerLanguage, type Language } from "./i18n";
import { useDensity } from "./lib/density";

export function ThemedApp({ installerLanguage }: { installerLanguage?: Language | null }) {
  const { theme, name, toggle } = useTheme();
  const { density, setDensity } = useDensity();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", name);
    document.documentElement.style.colorScheme = name;
  }, [name]);

  return (
    <LanguageProvider installerLanguage={installerLanguage}>
      <FluentProvider theme={theme} data-theme={name}>
        <App themeName={name} onToggleTheme={toggle} density={density} onDensityChange={setDensity} />
        <style>{createCSSRuleFromTheme("body", theme)}</style>
      </FluentProvider>
    </LanguageProvider>
  );
}

const root = createRoot(document.getElementById("app")!);
// Resolve the installer language before the first render so the UI does not flash in another language.
void readInstallerLanguage().then((installerLanguage) => {
  root.render(
    <StrictMode>
      <ThemedApp installerLanguage={installerLanguage} />
    </StrictMode>,
  );
});
