import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Title1, tokens } from "@fluentui/react-components";
import { WeatherSunnyRegular, WeatherMoonRegular } from "@fluentui/react-icons";
import { useTheme } from "./hooks/useTheme";
import { useSession } from "./hooks/useSession";
import { useConnections } from "./hooks/useConnections";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { Editor, type EditorHandle } from "./components/Editor";
import { ResultsGrid } from "./components/ResultsGrid";
import { StatusBar } from "./components/StatusBar";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { FormatSettings } from "./components/FormatSettings";
import { HistoryPanel, type HistoryEntry } from "./components/HistoryPanel";
import { VariablesDialog } from "./components/VariablesDialog";
import { loadFormatterSettings, saveFormatterSettings, type FormatterSettings } from "./lib/format-sql";
import { backend, type ConnectionEntry, type RelationInfo } from "./lib/backend";
import { splitStatements } from "./lib/sql-statements";
import { extractVariablesUnion, substituteVariables } from "./lib/sql-variables";
import type { DialectId, FunctionDef, QueryResult, RowEditability } from "@omni-sql/ts-types";
import type { Suggestion } from "@omni-sql/autocomplete-engine";
import { basenameNoExt, pickOpenPath, pickSavePath, readSqlFile, writeSqlFile } from "./lib/file-io";

export default function App() {
  const { name, toggle } = useTheme();
  const { tabs, activeTabId, setTabs, addTab, closeTab, selectTab, updateTabSql, renameTab, updateTab } = useSession();
  const { connections, error: connectionsError, loadConnections } = useConnections();
  const editorRef = useRef<EditorHandle | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConnectionEntry | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCache, setSidebarCache] = useState<Record<string, { relations: RelationInfo[]; functions: FunctionDef[] }>>({});
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [formatSettingsOpen, setFormatSettingsOpen] = useState(false);
  const [formatterSettings, setFormatterSettings] = useState<FormatterSettings>(loadFormatterSettings);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(null);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [editability, setEditability] = useState<RowEditability | null>(null);
  const [planText, setPlanText] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<{
    sqls: string[];
    label: string;
    runAll: boolean;
  } | null>(null);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [variableNames, setVariableNames] = useState<string[]>([]);
  const [runAfterVariables, setRunAfterVariables] = useState<{ sqls: string[]; label: string } | null>(null);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (connectionsError) {
      setBusyMsg(`Falha ao carregar conexões: ${connectionsError}`);
    }
  }, [connectionsError]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
  const activeConnectionId = activeTab?.connectionId ?? null;

  const activeDialect: DialectId = useMemo(
    () => connections.find((c) => c.id === activeConnectionId)?.dialect ?? "jdbc-generic",
    [connections, activeConnectionId],
  );
  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId) ?? null,
    [connections, activeConnectionId],
  );

  const loadSidebarData = useCallback(async (connectionId: string | null) => {
    if (!connectionId) return;
    setSidebarLoading(true);
    try {
      const [relRes, fnRes] = await Promise.all([
        backend.call<{ relations: RelationInfo[] }>("metadata.listRelations", { connectionId }),
        backend.call<{ functions: FunctionDef[] }>("metadata.listFunctions", { connectionId }),
      ]);
      setSidebarCache((prev) => ({ ...prev, [connectionId]: { relations: relRes.relations, functions: fnRes.functions } }));
    } catch {
      // best-effort
    } finally {
      setSidebarLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeConnectionId && !sidebarCache[activeConnectionId]) {
      void loadSidebarData(activeConnectionId);
    }
  }, [activeConnectionId, loadSidebarData, sidebarCache]);

  const introspectActive = useCallback(async () => {
    if (!activeConnectionId) return;
    setBusyMsg("Introspecção…");
    try {
      await backend.call("metadata.introspect", { connectionId: activeConnectionId });
      await loadConnections();
      await loadSidebarData(activeConnectionId);
      updateTab(activeTab.id, { error: null });
    } catch (e) {
      updateTab(activeTab.id, { error: `Falha ao atualizar metadados: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusyMsg(null);
    }
  }, [activeConnectionId, activeTab.id, loadConnections, loadSidebarData, updateTab]);

  const onSelectConnection = useCallback(
    async (id: string) => {
      updateTab(activeTab.id, { connectionId: id });
      await loadSidebarData(id);
    },
    [activeTab.id, updateTab, loadSidebarData],
  );

  const onAddConnection = useCallback(() => {
    setEditingConfig(null);
    setDialogOpen(true);
  }, []);

  const onEditConnection = useCallback((id: string) => {
    const c = connections.find((x) => x.id === id);
    if (!c) return;
    setEditingConfig(c);
    setDialogOpen(true);
  }, [connections]);

  const onRemoveConnection = useCallback(
    async (id: string) => {
      if (!confirm("Remover conexão selecionada?")) return;
      try {
        await backend.call("connection.remove", { connectionId: id });
        await loadConnections();
      } catch (e) {
        updateTab(activeTab.id, { error: `Falha ao remover: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [activeTab.id, loadConnections, updateTab],
  );

  const onConnectionSaved = useCallback(async () => {
    setDialogOpen(false);
    await loadConnections();
    if (!activeTab.connectionId && connections.length > 0) {
      updateTab(activeTab.id, { connectionId: connections[0]!.id });
    }
    await introspectActive();
  }, [activeTab.connectionId, activeTab.id, connections, introspectActive, loadConnections, updateTab]);

  const handleAutocomplete = useCallback(
    async (cursor: number): Promise<Suggestion[]> => {
      if (!activeConnectionId) return [];
      const r = await backend.call<{ suggestions: Suggestion[] }>("completion.get", {
        connectionId: activeConnectionId,
        sql: activeTab.sql,
        cursor,
      });
      return r.suggestions;
    },
    [activeConnectionId, activeTab.sql],
  );

  const pushHistory = useCallback((tab: typeof activeTab, ok: boolean, elapsedMs: number, errorMessage?: string) => {
    const conn = connections.find((c) => c.id === tab.connectionId);
    const entry: HistoryEntry = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sql: tab.sql,
      connectionId: tab.connectionId,
      connectionLabel: conn?.label ?? "?",
      dialect: conn?.dialect ?? null,
      ranAt: Date.now(),
      ok,
      elapsedMs,
      errorMessage,
    };
    setHistory((prev) => [entry, ...prev].slice(0, 50));
  }, [connections]);

  const runSqlSequence = useCallback(
    async (sqls: string[], label: string) => {
      if (!activeConnectionId || !activeTab) return;
      const variables = extractVariablesUnion(sqls);
      if (variables.length > 0) {
        setRunAfterVariables({ sqls, label });
        setVariableNames(variables);
        setVariablesOpen(true);
        return;
      }
      setRunning(true);
      setBusyMsg(label);
      setResult(null);
      setEditability(null);
      setPlanText(null);
      const startedAt = Date.now();
      try {
        const lastResult = await backend.call<QueryResult>("query.run", {
          connectionId: activeConnectionId,
          sql: sqls.join(";\n"),
          limit: activeTab.queryLimit,
        });
        setResult(lastResult);
        pushHistory(activeTab, true, Date.now() - startedAt);
        void backend
          .call<RowEditability>("query.analyzeEditability", { connectionId: activeConnectionId, sql: sqls.join(";\n") })
          .then(setEditability)
          .catch(() => setEditability(null));
      } catch (e) {
        updateTab(activeTab.id, { error: e instanceof Error ? e.message : String(e) });
        pushHistory(activeTab, false, Date.now() - startedAt, e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
        setBusyMsg(null);
      }
    },
    [activeConnectionId, activeTab, pushHistory, updateTab],
  );

  const handleRun = useCallback(() => {
    if (!activeConnectionId) return;
    const target = editorRef.current?.getSelectionOrCurrent();
    const sql = target?.sql ?? activeTab.sql;
    const statements = splitStatements(sql);
    if (statements.length > 1 && !target?.sql) {
      setPendingRun({ sqls: statements.map((s) => s.text), label: "Executando…", runAll: false });
      return;
    }
    const sqls = target?.sql ? [target.sql] : statements.map((s) => s.text);
    if (sqls.length === 0 || sqls.every((s) => !s.trim())) return;
    void runSqlSequence(sqls, "Executando…");
  }, [activeConnectionId, activeTab.sql, runSqlSequence]);

  const handleRunAll = useCallback(() => {
    if (!activeConnectionId) return;
    const sqls = editorRef.current?.getStatements().map((s) => s.text) ?? splitStatements(activeTab.sql).map((s) => s.text);
    if (sqls.length === 0 || sqls.every((s) => !s.trim())) return;
    void runSqlSequence(sqls, "Executando todas…");
  }, [activeConnectionId, activeTab.sql, runSqlSequence]);

  const handleRunChoice = useCallback(
    (choice: "current" | "all") => {
      if (!pendingRun) return;
      if (choice === "current" && pendingRun.runAll === false) {
        const current = editorRef.current?.getCurrentStatement();
        const sqls = current ? [current.text] : [pendingRun.sqls[0]!];
        void runSqlSequence(sqls, "Executando…");
      } else {
        void runSqlSequence(pendingRun.sqls, "Executando todas…");
      }
      setPendingRun(null);
    },
    [pendingRun, runSqlSequence],
  );

  const handleRunChoiceCancel = useCallback(() => setPendingRun(null), []);

  const handleVariablesSubmit = useCallback(
    (values: Record<string, string>) => {
      setVariablesOpen(false);
      if (!runAfterVariables) return;
      const sqls = runAfterVariables.sqls.map((sql) => substituteVariables(sql, values));
      void runSqlSequence(sqls, runAfterVariables.label);
      setRunAfterVariables(null);
    },
    [runAfterVariables, runSqlSequence],
  );

  const handleExplain = useCallback(() => {
    if (!activeConnectionId || !activeTab?.sql.trim()) return;
    setBusyMsg("Explicando…");
    setPlanText(null);
    backend
      .call<{ textual: string }>("query.explain", { connectionId: activeConnectionId, sql: activeTab.sql })
      .then((res) => setPlanText(res.textual))
      .catch((e) => updateTab(activeTab.id, { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusyMsg(null));
  }, [activeConnectionId, activeTab, updateTab]);

  const handleCellEdit = useCallback(
    async (rowIndex: number, colIndex: number, value: unknown) => {
      if (!activeConnectionId || !result || !editability?.editable) return;
      const row = result.rows[rowIndex];
      if (!row) return;
      const editableColumn = editability.columns[colIndex];
      if (!editableColumn || editableColumn.sourceColumn === null) return;
      const sourceColumn = editableColumn.sourceColumn;
      const pkValues: Record<string, unknown> = {};
      for (const pk of editability.pkColumns) {
        const pkColIndex = result.columns.findIndex((c) => c.name === pk);
        if (pkColIndex < 0) return;
        pkValues[pk] = row[pkColIndex];
      }
      try {
        await backend.call("row.update", {
          connectionId: activeConnectionId,
          table: editability.table,
          set: { [sourceColumn]: value },
          where: pkValues,
        });
        setResult((prev) => {
          if (!prev) return prev;
          const nextRows = prev.rows.map((r, i) =>
            i === rowIndex ? r.map((cell, j) => (j === colIndex ? value : cell)) : r,
          );
          return { ...prev, rows: nextRows };
        });
      } catch (e) {
        updateTab(activeTab.id, { error: e instanceof Error ? e.message : String(e) });
      }
    },
    [activeConnectionId, activeTab.id, editability, result, updateTab],
  );

  const onSaveTab = useCallback(async () => {
    if (!activeTab.filePath) {
      const path = await pickSavePath(activeTab.title);
      if (!path) return;
      try {
        await writeSqlFile(path, activeTab.sql);
        updateTab(activeTab.id, { filePath: path, title: basenameNoExt(path), savedSql: activeTab.sql, error: null });
      } catch (e) {
        updateTab(activeTab.id, { error: `Falha ao salvar: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }
    try {
      await writeSqlFile(activeTab.filePath, activeTab.sql);
      updateTab(activeTab.id, { savedSql: activeTab.sql, error: null });
    } catch (e) {
      updateTab(activeTab.id, { error: `Falha ao salvar: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [activeTab, updateTab]);

  const onOpenFile = useCallback(async () => {
    const path = await pickOpenPath();
    if (!path) return;
    try {
      const contents = await readSqlFile(path);
      const tab = { title: basenameNoExt(path), sql: contents, filePath: path, savedSql: contents, connectionId: activeTab.connectionId };
      addTab(tab.connectionId);
      // Update the newly added tab (last one) with file info
      setTabs((prev) => {
        const last = prev[prev.length - 1]!;
        return prev.map((t) => (t.id === last.id ? { ...t, ...tab } : t));
      });
    } catch (e) {
      updateTab(activeTab.id, { error: `Falha ao abrir: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [activeTab.connectionId, activeTab.id, addTab, setTabs, updateTab]);

  const onSaveFormatSettings = useCallback(
    (settings: FormatterSettings) => {
      setFormatterSettings(settings);
      saveFormatterSettings(settings);
      setFormatSettingsOpen(false);
    },
    [],
  );

  const onSelectHistory = useCallback(
    (entry: HistoryEntry) => {
      updateTab(activeTab.id, { sql: entry.sql });
      if (entry.connectionId && connections.some((c) => c.id === entry.connectionId)) {
        updateTab(activeTab.id, { connectionId: entry.connectionId });
      }
      setHistoryOpen(false);
    },
    [activeTab.id, connections, updateTab],
  );

  const onClearHistory = useCallback(() => setHistory([]), []);

  const monacoTheme = name === "light" ? "vs" : "vs-dark";

  const sidebarData = activeConnectionId ? sidebarCache[activeConnectionId] : undefined;

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
        <Toolbar
          connections={connections}
          activeConnectionId={activeConnectionId}
          busyMsg={busyMsg}
          running={running}
          limit={activeTab.queryLimit}
          onAdd={() => addTab(activeConnectionId)}
          onAddConnection={onAddConnection}
          onEditConnection={() => activeConnectionId && onEditConnection(activeConnectionId)}
          onRemoveConnection={() => activeConnectionId && onRemoveConnection(activeConnectionId)}
          onRefreshMetadata={introspectActive}
          onSelectConnection={onSelectConnection}
          onRun={handleRun}
          onExplain={handleExplain}
          onCancelRun={() => {}}
          onRunChoice={handleRunChoice}
          onRunChoiceCancel={handleRunChoiceCancel}
          pendingRunCount={pendingRun ? pendingRun.sqls.length : null}
          onLimitChange={(limit) => updateTab(activeTab.id, { queryLimit: limit })}
          onSave={onSaveTab}
          onOpen={onOpenFile}
          onOpenFormatSettings={() => setFormatSettingsOpen(true)}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleHistory={() => setHistoryOpen((v) => !v)}
        />
      </div>

      <aside style={{ gridColumn: 1, gridRow: "3 / span 2" }}>
        <Sidebar
          open={sidebarOpen}
          connection={activeConnection}
          relations={sidebarData?.relations ?? []}
          functions={sidebarData?.functions ?? []}
          loading={sidebarLoading}
          onInsert={(text) => editorRef.current?.insertAtCursor(text)}
          _onRefresh={() => loadSidebarData(activeConnectionId)}
        />
      </aside>

      <section
        style={{ gridColumn: 2, gridRow: 3, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        <TabBar
          tabs={tabs.map((t) => ({
            id: t.id,
            title: t.title,
            dirty: t.filePath != null && t.sql !== t.savedSql,
            dialect: t.connectionId ? connections.find((c) => c.id === t.connectionId)?.dialect : undefined,
          }))}
          activeTabId={activeTabId}
          onSelect={selectTab}
          onClose={closeTab}
          onAdd={() => addTab(activeConnectionId)}
          onRename={renameTab}
        />
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            ref={editorRef}
            value={activeTab.sql}
            onChange={(sql) => updateTabSql(activeTab.id, sql)}
            onRun={handleRun}
            onRunAll={handleRunAll}
            onSave={onSaveTab}
            onCursorChange={setCursorPosition}
            onAutocomplete={handleAutocomplete}
            dialect={activeDialect}
            theme={monacoTheme}
            formatterSettings={formatterSettings}
          />
        </div>
      </section>

      <section style={{ gridColumn: 2, gridRow: 4, minHeight: 0, overflow: "hidden" }}>
        <ResultsGrid result={result} error={activeTab.error} planText={planText} editability={editability} onCellEdit={handleCellEdit} />
      </section>

      <div style={{ gridColumn: 2, gridRow: 5 }}>
        <StatusBar connection={activeConnection} result={result} cursorPosition={cursorPosition} busyMsg={busyMsg} />
      </div>

      <ConnectionDialog
        open={dialogOpen}
        editing={editingConfig}
        onClose={() => setDialogOpen(false)}
        onSaved={onConnectionSaved}
      />

      <FormatSettings
        open={formatSettingsOpen}
        dialect={activeDialect}
        settings={formatterSettings}
        onClose={() => setFormatSettingsOpen(false)}
        onSave={onSaveFormatSettings}
      />

      <HistoryPanel open={historyOpen} entries={history} onClose={() => setHistoryOpen(false)} onSelect={onSelectHistory} onClear={onClearHistory} />

      <VariablesDialog
        open={variablesOpen}
        variables={variableNames}
        onClose={() => {
          setVariablesOpen(false);
          setRunAfterVariables(null);
        }}
        onSubmit={handleVariablesSubmit}
      />
    </div>
  );
}
