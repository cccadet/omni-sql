import "./monaco-environment";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import App from "./App";
import { useThemeValue } from "./theme";

function ThemedApp() {
  const theme = useThemeValue();
  return (
    <FluentProvider theme={theme}>
      <App />
    </FluentProvider>
  );
}

const root = createRoot(document.getElementById("app")!);
root.render(
  <StrictMode>
    <ThemedApp />
  </StrictMode>,
);
