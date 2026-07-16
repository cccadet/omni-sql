import { useEffect, useMemo, useRef, useState } from "react";
import { Title1, tokens } from "@fluentui/react-components";
import {
  WeatherSunnyRegular,
  WeatherMoonRegular,
} from "@fluentui/react-icons";
import { useTheme } from "./hooks/useTheme";
import { useSession } from "./hooks/useSession";
import { useConnections } from "./hooks/useConnections";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { Editor, type EditorHandle } from "./components/Editor";
import { ResultsGrid } from "./components/ResultsGrid";
import { StatusBar } from "./components/StatusBar";
import { DEFAULT_FORMATTER_SETTINGS } from "./lib/format-sql";
import type { DialectId } from "@omni-sql/ts-types";
import type { Suggestion } from "@omni-sql/autocomplete-engine";

export default function App() {
  const { name, toggle } = useTheme();
  const { tabs, activeTabId, addTab, closeTab, selectTab, updateTabSql } = useSession();
  const { connections, loadConnections } = useConnections();
  const editorRef = useRef<EditorHandle | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(null);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;

  const activeConnectionId = activeTab?.connectionId ?? null;
  const activeDialect: DialectId = useMemo(
    () => connections.find((c) => c.id === activeConnectionId)?.dialect ?? "jdbc-generic",
    [connections, activeConnectionId],
  );

  const handleAutocomplete = async (cursor: number): Promise<Suggestion[]> => {
    if (!activeConnectionId) return [];
    // TODO: wire backend completion.get (Fase 2/3)
    void cursor;
    return [];
  };

  const handleRun = () => {
    // TODO: implementar execução de statement atual/seleção (Fase 5)
    void editorRef.current?.getRunTarget();
  };

  const monacoTheme = name === "light" ? "vs" : "vs-dark";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gridTemplateRows: "auto auto 1fr 1fr auto",
        height: "100vh",
        background: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
      }}
    >
      <header
        style={{
          gridColumn: "1 / -1",
          gridRow: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          background: tokens.colorNeutralBackground1,
        }}
      >
        <Title1>omni-sql</Title1>
        <button
          type="button"
          onClick={toggle}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "transparent",
            border: "none",
            color: tokens.colorNeutralForeground1,
            cursor: "pointer",
          }}
        >
          {name === "dark" ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
          {name === "dark" ? "Tema claro" : "Tema escuro"}
        </button>
      </header>

      <div style={{ gridColumn: "1 / -1", gridRow: 2 }}>
        <Toolbar onAdd={addTab} onRun={handleRun} />
      </div>

      <aside style={{ gridColumn: 1, gridRow: "3 / span 2" }}>
        <Sidebar />
      </aside>

      <section style={{ gridColumn: 2, gridRow: 3, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={selectTab}
          onClose={closeTab}
          onAdd={addTab}
        />
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            ref={editorRef}
            value={activeTab.sql}
            onChange={(sql) => updateTabSql(activeTab.id, sql)}
            onRun={handleRun}
            onCursorChange={setCursorPosition}
            onAutocomplete={handleAutocomplete}
            dialect={activeDialect}
            theme={monacoTheme}
            formatterSettings={DEFAULT_FORMATTER_SETTINGS}
          />
        </div>
      </section>

      <section style={{ gridColumn: 2, gridRow: 4, minHeight: 0, overflow: "hidden" }}>
        <ResultsGrid />
      </section>

      <div style={{ gridColumn: 2, gridRow: 5 }}>
        <StatusBar connectionLabel={connections.find((c) => c.id === activeConnectionId)?.label} cursorPosition={cursorPosition} />
      </div>
    </div>
  );
}
