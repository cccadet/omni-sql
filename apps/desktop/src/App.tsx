import { Title1, tokens } from "@fluentui/react-components";
import {
  WeatherSunnyRegular,
  WeatherMoonRegular,
} from "@fluentui/react-icons";
import { useTheme } from "./hooks/useTheme";
import { useSession } from "./hooks/useSession";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { ResultsGrid } from "./components/ResultsGrid";
import { StatusBar } from "./components/StatusBar";

export default function App() {
  const { name, toggle } = useTheme();
  const { tabs, activeTabId, addTab, closeTab, selectTab, updateTabSql } = useSession();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;

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
        <Toolbar onAdd={addTab} />
      </div>

      <aside style={{ gridColumn: 1, gridRow: "3 / span 2" }}>
        <Sidebar />
      </aside>

      <section style={{ gridColumn: 2, gridRow: 3, minHeight: 0, overflow: "hidden" }}>
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={selectTab}
          onClose={closeTab}
          onAdd={addTab}
        />
        <Editor value={activeTab.sql} onChange={(sql) => updateTabSql(activeTab.id, sql)} />
      </section>

      <section style={{ gridColumn: 2, gridRow: 4, minHeight: 0, overflow: "hidden" }}>
        <ResultsGrid />
      </section>

      <div style={{ gridColumn: 2, gridRow: 5 }}>
        <StatusBar />
      </div>
    </div>
  );
}
