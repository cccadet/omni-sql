import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, MessageBar, MessageBarBody, Radio, RadioGroup, Title1, tokens } from "@fluentui/react-components";
import { PlugConnectedRegular, PlugDisconnectedRegular, WeatherSunnyRegular, WeatherMoonRegular } from "@fluentui/react-icons";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { useEditorMonacoTheme, type ThemeName } from "./theme";
import { useSession, makeTab } from "./hooks/useSession";
import { useConnections } from "./hooks/useConnections";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { Editor, type EditorHandle } from "./components/Editor";
import { ResultsGrid } from "./components/ResultsGrid";
import { StatusBar, type ConnectionHealth, type McpVisualState, type UpdateCheckStatus, type UpdateInfo } from "./components/StatusBar";
import { McpEditDialog, type McpEditProposal } from "./components/McpEditDialog";
import { BackgroundProcessesDialog } from "./components/BackgroundProcessesDialog";
import { AnalysisWorkspace } from "./components/AnalysisWorkspace";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { FormatSettings } from "./components/FormatSettings";
import { HistoryPanel, type HistoryEntry } from "./components/HistoryPanel";
import { VariablesDialog } from "./components/VariablesDialog";
import { SqlCommandLibrary } from "./components/SqlCommandLibrary";
import { ExecutionRiskDialog } from "./components/ExecutionRiskDialog";
import { DialectIcon } from "./components/DialectIcon";
import { loadFormatterSettings, saveFormatterSettings, type FormatterSettings } from "./lib/format-sql";
import { backend, type ConnectionEntry, type ConnectionGroup, type RelationColumn, type RelationInfo, type SqlDiagnostic } from "./lib/backend";
import { splitStatements } from "./lib/sql-statements";
import { extractVariablesUnion, substituteVariables } from "./lib/sql-variables";
import { MCP_MAX_ERROR_MESSAGE_BYTES, MCP_MAX_SQL_BYTES, type DialectId, type FunctionDef, type McpToolResultByName, type QueryResult, type RowEditability, type SqlExecutionError } from "@omni-sql/ts-types";
import { analyzeExecutionRisk, type ExecutionRiskAnalysis, type Suggestion } from "@omni-sql/autocomplete-engine";
import { basenameNoExt, pickAnalysisExportPath, pickAnalysisImportPath, pickOpenPath, pickSavePath, readSqlFile, writeSqlFile } from "./lib/file-io";
import { useLanguage } from "./i18n";
import { makeListenerId, McpUiBridge, McpUiError, type McpUiState } from "./lib/mcp-ui-bridge";
import { localizeSuggestionLabels } from "./lib/localize-suggestions";
import { cancelAnalysis, clearAnalysis, exportAnalysis, getAnalysisOperationStatus, importAnalysisFile, importQueryResult, importQuerySource, listAnalysisDatasets, listAnalysisS3, runAnalysis, runS3CatalogQuery, suggestAnalysisDatasetName, type AnalysisOperationStatus, type DatasetRef } from "./lib/analysis";
import { s3Buckets } from "./lib/s3-buckets";
import { discoverConfiguredS3Tables, type S3DiscoveryCredentials, type S3TableSource } from "./lib/s3-sources";
import { s3ReferencedRelations, s3Suggestions } from "./lib/s3-autocomplete";
import type { McpStatusResult } from "@omni-sql/ts-types";

const HISTORY_KEY = "omni-sql:history";
const CHECK_FOR_UPDATES_EVENT = "check-for-updates";
const SHOW_PROCESSES_EVENT = "show-background-processes";
const NATIVE_MENU_EVENT = "native-menu-action";
const MCP_PROPOSAL_SAFETY_WINDOW_MS = 1_000;
const TRUSTED_WARNING_CONNECTIONS_KEY = "omni-sql:trusted-warning-connections";

const HISTORY_MAX_ENTRIES = 200;
const historyTextEncoder = new TextEncoder();

const DIALECT_LABELS: Record<string, string> = {
  postgres: "PostgreSQL", mysql: "MySQL", mariadb: "MariaDB", sqlserver: "SQL Server",
  oracle: "Oracle", "jdbc-generic": "JDBC", odbc: "ODBC", s3: "S3", duckdb: "DuckDB",
};

function supportsInAppUpdate(): boolean {
  return /Windows/u.test(navigator.userAgent);
}

function connectionDatabase(connection: ConnectionEntry | null): string | null {
  if (!connection) return null;
  if (connection.endpoint === "memory://local") return "memory";
  try {
    if (connection.endpoint.includes("://")) {
      const url = new URL(connection.endpoint);
      return decodeURIComponent(url.pathname.replace(/^\//u, "")) || url.hostname || null;
    }
  } catch {
    // JDBC and driver-specific endpoints are handled by the simple fallback.
  }
  const path = connection.endpoint.split(/[/?#]/u)[1];
  return path ? decodeURIComponent(path) : null;
}

function loadTrustedWarningConnections(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TRUSTED_WARNING_CONNECTIONS_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveTrustedWarningConnections(connections: ReadonlySet<string>): void {
  try {
    localStorage.setItem(TRUSTED_WARNING_CONNECTIONS_KEY, JSON.stringify([...connections]));
  } catch {
    // localStorage can be unavailable in restricted webviews.
  }
}

interface ActiveQuery {
  sequence: number;
  connectionId: string;
  engineOperationId: string | null;
  abortController: AbortController;
  cancelPromise: Promise<void> | null;
  cancelSettled: boolean;
  finished: boolean;
}


function makeHistoryId(): string {
  return `hist-${crypto.randomUUID()}`;
}

function isHistorySql(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    historyTextEncoder.encode(value).byteLength <= MCP_MAX_SQL_BYTES;
}

function restoreHistoryEntry(value: unknown): Omit<HistoryEntry, "id"> | null {
  if (typeof value === "string") return isHistorySql(value) ? { sql: value } : null;
  if (value === null || typeof value !== "object" || Array.isArray(value) || !("sql" in value)) return null;
  const record = value as { sql: unknown; ok?: unknown; status?: unknown; executedAt?: unknown };
  if (!isHistorySql(record.sql)) return null;
  const ok = typeof record.ok === "boolean"
    ? record.ok
    : record.status === "success" || record.status === "ok"
      ? true
      : record.status === "failure" || record.status === "error"
        ? false
        : undefined;
  const executedAt = typeof record.executedAt === "string" && !Number.isNaN(Date.parse(record.executedAt))
    ? record.executedAt
    : undefined;
  return { sql: record.sql, ...(ok === undefined ? {} : { ok }), ...(executedAt ? { executedAt } : {}) };
}

function persistableHistoryEntry(value: HistoryEntry): Omit<HistoryEntry, "id"> | null {
  if (!isHistorySql(value.sql)) return null;
  return {
    sql: value.sql,
    ...(typeof value.ok === "boolean" ? { ok: value.ok } : {}),
    ...(value.executedAt && !Number.isNaN(Date.parse(value.executedAt)) ? { executedAt: value.executedAt } : {}),
  };
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // History used to contain execution metadata. Keep only its SQL when
    // reading older sessions, while preserving a known success/failure value.
    return parsed.slice(0, HISTORY_MAX_ENTRIES).flatMap((item) => {
      const restored = restoreHistoryEntry(item);
      return restored ? [{ id: makeHistoryId(), ...restored }] : [];
    });
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    const stored = entries
      .slice(0, HISTORY_MAX_ENTRIES)
      .flatMap((entry) => {
        const safeEntry = persistableHistoryEntry(entry);
        return safeEntry ? [safeEntry] : [];
      });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(stored));
  } catch {
    // localStorage indisponível/cheio
  }
}

function boundedErrorText(value: string): string {
  if (new TextEncoder().encode(value).byteLength <= MCP_MAX_ERROR_MESSAGE_BYTES) return value || "SQL execution failed";
  const characters = [...value];
  while (characters.length > 0 && new TextEncoder().encode(characters.join("")).byteLength > MCP_MAX_ERROR_MESSAGE_BYTES) {
    characters.pop();
  }
  return characters.join("") || "SQL execution failed";
}

function sqlExecutionErrorFrom(error: unknown): SqlExecutionError {
  const message = boundedErrorText(error instanceof Error ? error.message : "SQL execution failed");
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return {
    message,
    ...(typeof code === "string" || typeof code === "number" ? { code: boundedErrorText(String(code)) } : {}),
  };
}

function matchingDiagnostic(
  diagnostics: readonly SqlDiagnostic[],
  message: string,
): SqlDiagnostic | undefined {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  return errors.find((diagnostic) => diagnostic.message === message ||
    diagnostic.message.includes(message) || message.includes(diagnostic.message)) ?? errors[0];
}

function diagnosticPosition(diagnostic: { start: number; end: number }): SqlExecutionError["position"] | undefined {
  if (!Number.isSafeInteger(diagnostic.start) || diagnostic.start < 0) return undefined;
  if (!Number.isSafeInteger(diagnostic.end) || diagnostic.end < diagnostic.start) return { start: diagnostic.start };
  return { start: diagnostic.start, end: diagnostic.end };
}

export interface AppProps {
  themeName: ThemeName;
  onToggleTheme: () => void;
}

export default function App({ themeName: name, onToggleTheme: toggle }: AppProps) {
  const { language, t } = useLanguage();
  const { tabs, activeTabId, setTabs, addTab, closeTab, selectTab, updateTabSql, renameTab, updateTab, getTabRevision, compareAndSwapTabSql } = useSession();
  const { connections, error: connectionsError, loadConnections } = useConnections();
  const [connectionGroups, setConnectionGroups] = useState<ConnectionGroup[]>([]);
  const editorRef = useRef<EditorHandle | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [backgroundProcessesOpen, setBackgroundProcessesOpen] = useState(false);
  const [analysisDataset, setAnalysisDataset] = useState<DatasetRef | null>(null);
  const [analysisWorkspaceId, setAnalysisWorkspaceId] = useState<string | null>(null);
  const [analysisS3ConnectionId, setAnalysisS3ConnectionId] = useState<string | null>(null);
  const onAnalysisDatasetSelected = useCallback((item: DatasetRef | null) => {
    setAnalysisDataset(item);
    if (item) setAnalysisS3ConnectionId(null);
  }, []);
  const [analysisImporting, setAnalysisImporting] = useState(false);
  const [analysisImportOperationId, setAnalysisImportOperationId] = useState<string | null>(null);
  const [analysisImportStatus, setAnalysisImportStatus] = useState<AnalysisOperationStatus | null>(null);
  const [analysisImportOpen, setAnalysisImportOpen] = useState(false);
  const [analysisImportError, setAnalysisImportError] = useState<string | null>(null);
  const [crossSourceOpen, setCrossSourceOpen] = useState(false);
  const [crossSourceConnectionId, setCrossSourceConnectionId] = useState("");
  const [crossSourceSearch, setCrossSourceSearch] = useState("");
  const [crossSourceSql, setCrossSourceSql] = useState("");
  const [crossSourceRelations, setCrossSourceRelations] = useState<RelationInfo[]>([]);
  const [crossSourceError, setCrossSourceError] = useState<string | null>(null);
  const [crossSourceBusy, setCrossSourceBusy] = useState(false);
  const [crossSourceLimit, setCrossSourceLimit] = useState(10000);
  const [crossSourceAllRows, setCrossSourceAllRows] = useState(false);
  const [analysisSelection, setAnalysisSelection] = useState<"full" | "first_n" | "reservoir">("full");
  const [analysisLoadOrigin, setAnalysisLoadOrigin] = useState<"displayed" | "source">("source");
  const [analysisSampleRows, setAnalysisSampleRows] = useState(1_000);
  const [analysisSourceSql, setAnalysisSourceSql] = useState<string | null>(null);
  const analysisInitialSource = null;
  const [analysisSidebarHost, setAnalysisSidebarHost] = useState<HTMLDivElement | null>(null);
  const [editingConfig, setEditingConfig] = useState<ConnectionEntry | null>(null);
  const [duplicatingConnection, setDuplicatingConnection] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCache, setSidebarCache] = useState<Record<string, { schemas: string[]; relations: RelationInfo[]; functions: FunctionDef[] }>>({});
  const [s3Catalog, setS3Catalog] = useState<Record<string, ({ schema: string; name: string } & S3TableSource)[]>>({});
  const s3ColumnRequests = useRef(new Map<string, Promise<RelationColumn[]>>());
  const [s3Prefixes, setS3Prefixes] = useState<Record<string, string>>({});
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [formatSettingsOpen, setFormatSettingsOpen] = useState(false);
  const [commandLibraryOpen, setCommandLibraryOpen] = useState(false);
  const [formatterSettings, setFormatterSettings] = useState<FormatterSettings>(loadFormatterSettings);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(null);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [metadataRefreshConfirmOpen, setMetadataRefreshConfirmOpen] = useState(false);
  const [metadataRefreshFailures, setMetadataRefreshFailures] = useState<Record<string, true>>({});
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
  const [pendingRiskRun, setPendingRiskRun] = useState<{ sqls: string[]; label: string; analysis: ExecutionRiskAnalysis } | null>(null);
  const [trustedWarningConnections, setTrustedWarningConnections] = useState(loadTrustedWarningConnections);
  const [diagnostics, setDiagnostics] = useState<SqlDiagnostic[]>([]);
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>("unknown");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<UpdateCheckStatus | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpStatusResult | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpStarted, setMcpStarted] = useState(false);
  const [mcpProposal, setMcpProposal] = useState<McpEditProposal | null>(null);
  const mcpProposalResolverRef = useRef<((outcome: "approved" | "rejected" | "stale") => void) | null>(null);
  const mcpListenerIdRef = useRef(makeListenerId());
  const mcpStateRef = useRef<McpUiState>({ activeTab: null, activeConnection: null, editor: null });
  const connectionHealthCheckRef = useRef(0);
  const executionSequenceRef = useRef(0);
  const activeQueryRef = useRef<ActiveQuery | null>(null);

  const installUpdate = useCallback(async () => {
    const version = updateInfo?.version ?? "";
    if (!window.confirm(t("installUpdatePrompt").replace("{version}", version))) return;

    setUpdateCheckStatus({ state: "checking" });
    setBusyMsg(t("checkingForUpdates"));
    try {
      const update = await check({ timeout: 30_000 });
      if (!update) {
        setUpdateInfo({ available: false });
        setUpdateCheckStatus({ state: "up-to-date" });
        return;
      }

      let downloaded = 0;
      let contentLength: number | undefined;
      setBusyMsg(null);
      setUpdateCheckStatus({ state: "downloading", percent: null });
      await update.download((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          setUpdateCheckStatus({ state: "downloading", percent: contentLength === 0 ? null : 0 });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const percent = contentLength
            ? Math.min(100, Math.round((downloaded / contentLength) * 100))
            : null;
          setUpdateCheckStatus({ state: "downloading", percent });
        }
      });
      setUpdateCheckStatus({ state: "installing" });
      await invoke("prepare_update_install");
      await update.install();
    } catch (error) {
      setUpdateCheckStatus({
        state: "error",
        message: `${t("updateInstallFailed")}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setBusyMsg(null);
    }
  }, [t, updateInfo?.version]);

  useEffect(() => {
    void getVersion()
      .then((currentVersion) => backend.call<UpdateInfo>("update.check", { currentVersion }))
      .then(setUpdateInfo)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let checking = false;
    let unlisten: (() => void) | null = null;
    void listen(CHECK_FOR_UPDATES_EVENT, async () => {
      if (cancelled || checking) return;
      checking = true;
      setUpdateInfo(null);
      setUpdateCheckStatus({ state: "checking" });
      setBusyMsg(t("checkingForUpdates"));
      try {
        const currentVersion = await getVersion();
        const info = await backend.call<UpdateInfo>("update.check", { currentVersion });
        if (cancelled) return;
        setUpdateInfo(info);
        setUpdateCheckStatus(info.available && info.version
          ? { state: "available", version: info.version }
          : { state: "up-to-date" });
      } catch (error) {
        if (!cancelled) {
          setUpdateCheckStatus({
            state: "error",
            message: `${t("updateCheckFailed")}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } finally {
        checking = false;
        if (!cancelled) setBusyMsg(null);
      }
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlisten = cleanup;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen(SHOW_PROCESSES_EVENT, () => setBackgroundProcessesOpen(true))
      .then((cleanup) => { if (cancelled) cleanup(); else unlisten = cleanup; })
      .catch(() => undefined);
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const key = "omni-sql-analysis-s3-sources";
    const raw = localStorage.getItem(key);
    if (!raw) return;
    void (async () => {
      const sources: unknown = JSON.parse(raw);
      if (!Array.isArray(sources)) return;
      const { configs } = await backend.call<{ configs: ConnectionEntry[] }>("connection.list", {});
      const registeredBuckets = new Set(configs.filter((config) => config.dialect === "s3").map((config) => config.endpoint));
      for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        const entry = source as Record<string, unknown>;
        if (typeof entry.uri !== "string" || !/^s3:\/\/[^/@]+\/.+/.test(entry.uri)
          || !["csv", "parquet", "delta", "iceberg"].includes(String(entry.format))) continue;
        const bucket = entry.uri.match(/^s3:\/\/[^/]+/)?.[0] ?? entry.uri;
        if (registeredBuckets.has(bucket)) continue;
        await backend.call("connection.add", { config: {
          id: `conn-${crypto.randomUUID()}`, label: String(entry.name || entry.uri), dialect: "s3",
          endpoint: bucket, user: "", options: {
            region: String(entry.region ?? ""), endpoint: String(entry.endpoint ?? ""),
          },
        } });
        registeredBuckets.add(bucket);
      }
      localStorage.removeItem(key);
      await loadConnections();
    })().catch(() => undefined);
  }, [loadConnections]);

  const loadConnectionGroups = useCallback(async () => {
    try {
      const result = await backend.call<{ groups: ConnectionGroup[] }>("connectionGroup.list", {});
      setConnectionGroups(result.groups);
    } catch {
      setConnectionGroups([]);
    }
  }, []);

  useEffect(() => {
    void loadConnectionGroups();
  }, [loadConnectionGroups]);

  useEffect(() => {
    if (connectionsError) {
      setBusyMsg(`${t("error")}: ${connectionsError}`);
    }
  }, [connectionsError, t]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    if (!analysisImportOperationId) {
      setAnalysisImportStatus(null);
      return;
    }
    let stopped = false;
    const refresh = async () => {
      const status = await getAnalysisOperationStatus(analysisImportOperationId).catch(() => null);
      if (!stopped && status) setAnalysisImportStatus(status);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 300);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [analysisImportOperationId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
  const activeConnectionId = activeTab?.connectionId ?? null;

  const closeAnalysisWorkspace = useCallback(async () => {
    if (analysisWorkspaceId) await clearAnalysis(analysisWorkspaceId).catch(() => undefined);
    setAnalysisDataset(null);
    setAnalysisWorkspaceId(null);
    setAnalysisS3ConnectionId(null);
  }, [analysisWorkspaceId]);

  const sendCurrentSqlToAnalysis = useCallback(() => {
    if (!activeConnectionId) return;
    const sql = (editorRef.current?.getSelectionOrCurrent().sql ?? activeTab.sql).trim();
    if (!sql) return;
    setAnalysisSourceSql(sql);
    setAnalysisLoadOrigin("source");
    setAnalysisImportError(null);
    setAnalysisImportOpen(true);
  }, [activeConnectionId, activeTab.sql]);

  const importCurrentResultForAnalysis = useCallback(async () => {
    if (!result || analysisImporting) return;
    if (analysisLoadOrigin === "source" && (!activeConnectionId || !analysisSourceSql)) return;
    setAnalysisImporting(true);
    setAnalysisImportError(null);
    const operationId = `import-${crypto.randomUUID()}`;
    setAnalysisImportOperationId(operationId);
    try {
      const selection = analysisSelection === "full"
        ? { mode: "full" as const }
        : analysisSelection === "first_n"
          ? { mode: "first_n" as const, rows: analysisSampleRows }
          : { mode: "reservoir" as const, rows: analysisSampleRows, seed: 42 };
      const sourceSql = analysisSourceSql ?? activeTab.sql;
      const datasetName = suggestAnalysisDatasetName(sourceSql, activeTab.title);
      await backend.call("connection.add", { config: { id: "local-duckdb", label: "Local DuckDB", dialect: "duckdb", endpoint: "local.duckdb", user: "" } });
      const dataset = analysisLoadOrigin === "source"
        ? await importQuerySource({
            workspaceId: "federated",
            name: datasetName,
            connectionId: activeConnectionId!,
            sql: analysisSourceSql!,
            operationId,
            selection,
          })
        : await importQueryResult({
            workspaceId: "local-duckdb",
            name: datasetName,
            result,
            ...(activeConnectionId ? { sourceConnectionId: activeConnectionId } : {}),
            sourceSql,
            selection,
          });
      setAnalysisDataset(dataset);
      await loadConnections();
      setSidebarCache((previous) => {
        const next = { ...previous };
        delete next["local-duckdb"];
        for (const connection of connections) if (connection.dialect === "s3") delete next[connection.id];
        return next;
      });
      setAnalysisWorkspaceId(null);
      updateTab(activeTab.id, { connectionId: "local-duckdb", sql: `SELECT * FROM "${dataset.relationName.replaceAll('"', '""')}" LIMIT 1000` });
      setAnalysisImportOpen(false);
    } catch (error) {
      setAnalysisImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalysisImporting(false);
      setAnalysisImportOperationId(null);
    }
  }, [activeConnectionId, activeTab.id, activeTab.sql, activeTab.title, analysisImporting, analysisLoadOrigin, analysisSampleRows, analysisSelection, analysisSourceSql, connections, loadConnections, result, updateTab]);

  const activeDialect: DialectId = useMemo(
    () => connections.find((c) => c.id === activeConnectionId)?.dialect ?? "jdbc-generic",
    [connections, activeConnectionId],
  );
  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId) ?? null,
    [connections, activeConnectionId],
  );
  const analysisS3Connection = connections.find((connection) => connection.id === analysisS3ConnectionId) ?? null;
  const crossSourceConnection = connections.find((connection) => connection.id === crossSourceConnectionId);

  useEffect(() => {
    if (!crossSourceOpen || !crossSourceConnectionId) { setCrossSourceRelations([]); return; }
    let current = true;
    void backend.call<{ relations: RelationInfo[] }>("metadata.listRelations", { connectionId: crossSourceConnectionId, includeColumns: false })
      .then(({ relations }) => { if (current) setCrossSourceRelations(relations); })
      .catch((error: unknown) => { if (current) setCrossSourceError(error instanceof Error ? error.message : String(error)); });
    return () => { current = false; };
  }, [crossSourceOpen, crossSourceConnectionId]);

  const selectCrossSourceRelation = useCallback((relation: RelationInfo) => {
    const dialect = crossSourceConnection?.dialect;
    const quote = (value: string) => dialect === "mysql" || dialect === "mariadb"
      ? `\`${value.replaceAll("`", "``")}\``
      : dialect === "sqlserver" ? `[${value.replaceAll("]", "]]")}]`
        : `"${value.replaceAll('"', '""')}"`;
    setCrossSourceSql(`SELECT * FROM ${quote(relation.schema)}.${quote(relation.name)}`);
  }, [crossSourceConnection]);

  mcpStateRef.current = {
    activeTab: activeTab ? {
      id: activeTab.id,
      title: activeTab.title,
      sql: activeTab.sql,
      latestSqlExecutionError: activeTab.latestSqlExecutionError ?? null,
    } : null,
    activeConnection: activeConnection ? { id: activeConnection.id, label: activeConnection.label, dialect: activeConnection.dialect } : null,
    editor: editorRef.current,
  };

  useEffect(() => {
    let current = true;
    const checkId = ++connectionHealthCheckRef.current;
    if (!activeConnectionId || !activeConnection) {
      setConnectionHealth("unknown");
      return () => { current = false; };
    }
    if (activeDialect === "s3" || activeDialect === "duckdb") {
      setConnectionHealth("online");
      return () => { current = false; };
    }
    setConnectionHealth("verifying");
    void backend.call<{ status?: string; online?: boolean; ok?: boolean }>("connection.status", { connectionId: activeConnectionId })
      .then((response) => {
        if (!current || checkId !== connectionHealthCheckRef.current) return;
        setConnectionHealth(response.status === "offline" || response.online === false || response.ok === false ? "offline" : "online");
      })
      .catch(() => {
        if (current && checkId === connectionHealthCheckRef.current) setConnectionHealth("offline");
      });
    return () => { current = false; };
  }, [activeConnectionId, activeConnection, activeDialect]);

  useEffect(() => {
    setDiagnostics([]);
    if (!activeConnectionId || !activeConnection || activeDialect === "s3" || activeDialect === "duckdb" || !activeTab.sql.trim()) return;
    const timer = window.setTimeout(() => {
      const statement = editorRef.current?.getCurrentStatement();
      const base = statement?.start ?? 0;
      const sql = statement?.text ?? activeTab.sql;
      void backend
        .call<{ diagnostics: SqlDiagnostic[] }>("query.diagnose", {
          connectionId: activeConnectionId,
          sql,
        })
        .then((response) => setDiagnostics(response.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          start: diagnostic.start + base,
          end: diagnostic.end + base,
        }))))
        .catch(() => setDiagnostics([]));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeConnectionId, activeConnection, activeDialect, activeTab.sql, cursorPosition]);

  const loadSidebarData = useCallback(async (connectionId: string | null, prefixOverride?: string) => {
    if (!connectionId) return;
    setSidebarLoading(true);
    try {
      const s3 = connections.find((item) => item.id === connectionId && item.dialect === "s3");
      const local = connections.find((item) => item.id === connectionId && item.dialect === "duckdb");
      if (local) {
        const datasets = [...await listAnalysisDatasets("local-duckdb"), ...await listAnalysisDatasets("federated")];
        setSidebarCache((previous) => ({ ...previous, [connectionId]: {
          schemas: ["main"],
          relations: datasets.map((dataset) => ({ schema: "main", name: dataset.relationName, kind: "table", columns: dataset.columns.map((column) => ({ name: column.name, dataType: column.dataType, nullable: column.nullable, isPrimaryKey: false })) })),
          functions: [],
        } }));
        return;
      }
      if (s3) {
        for (const key of s3ColumnRequests.current.keys()) {
          if (key.startsWith(`${connectionId}:`)) s3ColumnRequests.current.delete(key);
        }
        const credentials = await backend.call<S3DiscoveryCredentials>("connection.s3Credentials", { connectionId });
        const buckets = s3Buckets(s3);
        const sources = (await Promise.all(buckets.map(async (bucketUri) => {
          const objects = await listAnalysisS3({ uri: bucketUri, region: String(s3.options?.region ?? ""),
            endpoint: String(s3.options?.endpoint ?? "") || undefined, accessKeyId: credentials.accessKeyId || undefined,
            secretAccessKey: credentials.secretAccessKey, prefix: prefixOverride ?? s3Prefixes[connectionId] ?? "" });
          const schema = bucketUri.slice(5);
          const used = new Set<string>();
          const tables = await discoverConfiguredS3Tables(objects, bucketUri, String(s3.options?.region ?? ""),
            String(s3.options?.endpoint ?? "") || undefined, credentials);
          return tables.map((table) => {
            const base = table.format === "ducklake" ? `${table.tableSchema}__${table.tableName}` : (table.format === "iceberg" ? table.uri.split("/metadata/")[0]! : table.uri)
              .slice(bucketUri.length + 1).replace(/\.(?:csv|parquet)$/i, "").replaceAll("/", "__");
            let name = base;
            for (let suffix = 2; used.has(name.toLowerCase()); suffix += 1) name = `${base}_${suffix}`;
            used.add(name.toLowerCase());
            return { ...table, schema, name };
          });
        }))).flat();
        const localDatasets = [...await listAnalysisDatasets("local-duckdb"), ...await listAnalysisDatasets("federated")];
        setS3Catalog((previous) => ({ ...previous, [connectionId]: sources }));
        setSidebarCache((previous) => ({ ...previous, [connectionId]: {
          schemas: [...buckets.map((bucket) => bucket.slice(5)), ...(localDatasets.length ? ["local"] : [])],
          relations: [...sources.map((source) => ({ schema: source.schema, name: source.name, kind: "table" as const })),
            ...localDatasets.map((dataset) => ({ schema: "local", name: dataset.relationName, kind: "table" as const,
              columns: dataset.columns.map((column) => ({ name: column.name, dataType: column.dataType, nullable: column.nullable, isPrimaryKey: false })) }))],
          functions: [],
        } }));
        return;
      }
      const [schemaRes, relRes, fnRes] = await Promise.all([
        backend.call<{ schemas: string[] }>("metadata.listSchemas", { connectionId }),
        backend.call<{ relations: RelationInfo[] }>("metadata.listRelations", { connectionId, includeColumns: true }),
        backend.call<{ functions: FunctionDef[] }>("metadata.listFunctions", { connectionId }),
      ]);
      setSidebarCache((prev) => ({ ...prev, [connectionId]: { schemas: schemaRes.schemas, relations: relRes.relations, functions: fnRes.functions } }));
    } catch (error) {
      setBusyMsg(`${t("error")}: ${error instanceof Error ? error.message : String(error)}`);
      window.setTimeout(() => setBusyMsg(null), 6_000);
    } finally {
      setSidebarLoading(false);
    }
  }, [connections, s3Prefixes, t]);

  const importCrossSource = useCallback(async () => {
    if (!crossSourceConnectionId || !crossSourceSql.trim() || crossSourceBusy) return;
    setCrossSourceBusy(true);
    setCrossSourceError(null);
    try {
      const name = suggestAnalysisDatasetName(crossSourceSql, crossSourceConnection?.label ?? "Imported table");
      const imported = await importQuerySource({ workspaceId: "federated", name,
        connectionId: crossSourceConnectionId, sql: crossSourceSql.trim(),
        selection: crossSourceAllRows ? { mode: "full" } : { mode: "first_n", rows: crossSourceLimit } });
      if (activeConnectionId) {
        setSidebarCache((previous) => { const next = { ...previous }; delete next[activeConnectionId]; return next; });
        await loadSidebarData(activeConnectionId);
      }
      setCrossSourceOpen(false);
      setBusyMsg(`${imported.relationName}: ${imported.rowCount.toLocaleString()} linhas disponíveis como local."${imported.relationName.replaceAll('"', '""')}"`);
      window.setTimeout(() => setBusyMsg(null), 8000);
    } catch (error) {
      setCrossSourceError(error instanceof Error ? error.message : String(error));
    } finally {
      setCrossSourceBusy(false);
    }
  }, [activeConnectionId, crossSourceAllRows, crossSourceBusy, crossSourceConnection, crossSourceConnectionId, crossSourceLimit, crossSourceSql, loadSidebarData]);

  const loadS3Columns = useCallback(async (connectionId: string, schema: string, table: string): Promise<RelationColumn[]> => {
    const existing = sidebarCache[connectionId]?.relations.find((relation) => relation.schema === schema && relation.name === table);
    if (existing?.columns !== undefined) return existing.columns;
    const source = s3Catalog[connectionId]?.find((item) => item.schema === schema && item.name === table);
    const connection = connections.find((item) => item.id === connectionId && item.dialect === "s3");
    if (!source || !connection) return [];
    const key = `${connectionId}:${source.name}:${source.uri}`;
    let request = s3ColumnRequests.current.get(key);
    if (!request) {
      request = (async () => {
        const credentials = await backend.call<{ accessKeyId: string; secretAccessKey?: string }>("connection.s3Credentials", { connectionId });
        const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
        const result = await runS3CatalogQuery({ workspaceId: "local-duckdb", sources: [source],
          region: String(connection.options?.region ?? ""), endpoint: String(connection.options?.endpoint ?? "") || undefined,
          accessKeyId: credentials.accessKeyId || undefined, secretAccessKey: credentials.secretAccessKey,
          sql: `SELECT * FROM ${quote(schema)}.${quote(table)} LIMIT 0`, limit: 1 });
        const columns = result.columns.map((column) => ({ ...column, isPrimaryKey: false }));
        setSidebarCache((previous) => {
          const data = previous[connectionId];
          if (!data) return previous;
          return { ...previous, [connectionId]: { ...data, relations: data.relations.map((relation) =>
            relation.schema === schema && relation.name === table ? { ...relation, columns } : relation) } };
        });
        return columns;
      })();
      s3ColumnRequests.current.set(key, request);
      void request.catch(() => s3ColumnRequests.current.delete(key));
    }
    return request;
  }, [connections, s3Catalog, sidebarCache]);

  const onS3PrefixChange = useCallback((prefix: string) => {
    if (!activeConnectionId) return;
    setS3Prefixes((previous) => ({ ...previous, [activeConnectionId]: prefix }));
    void loadSidebarData(activeConnectionId, prefix);
  }, [activeConnectionId, loadSidebarData]);

  useEffect(() => {
    if (activeConnectionId && activeConnection && !sidebarCache[activeConnectionId]) {
      void loadSidebarData(activeConnectionId);
    }
  }, [activeConnectionId, activeConnection, loadSidebarData, sidebarCache]);

  const introspectConnection = useCallback(async (connectionId: string, tabId: string) => {
    setBusyMsg(t("refreshMetadata"));
    try {
      await backend.call("metadata.introspect", { connectionId });
      setMetadataRefreshFailures((previous) => {
        const remaining = { ...previous };
        delete remaining[connectionId];
        return remaining;
      });
      ++connectionHealthCheckRef.current;
      setConnectionHealth("online");
      await loadConnections();
      await loadSidebarData(connectionId);
      updateTab(tabId, { error: null });
    } catch (e) {
      setMetadataRefreshFailures((previous) => ({ ...previous, [connectionId]: true }));
      updateTab(tabId, { error: `${t("error")}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusyMsg(null);
    }
  }, [loadConnections, loadSidebarData, updateTab, t]);

  const introspectActive = useCallback(async () => {
    if (!activeConnectionId) return;
    await introspectConnection(activeConnectionId, activeTab.id);
  }, [activeConnectionId, activeTab.id, introspectConnection]);

  const onRefreshMetadata = useCallback(() => {
    if (!activeConnectionId) return;
    if (activeDialect === "s3" || activeDialect === "duckdb") {
      void loadSidebarData(activeConnectionId);
      return;
    }
    setMetadataRefreshConfirmOpen(true);
  }, [activeConnectionId, activeDialect, loadSidebarData]);

  const onSelectConnection = useCallback(
    async (id: string) => {
      if (analysisWorkspaceId) setAnalysisWorkspaceId(null);
      setAnalysisS3ConnectionId(null);
      updateTab(activeTab.id, { connectionId: id });
      await loadSidebarData(id);
    },
    [activeTab.id, analysisWorkspaceId, updateTab, loadSidebarData],
  );

  const onAddConnection = useCallback(() => {
    setEditingConfig(null);
    setDuplicatingConnection(false);
    setDialogOpen(true);
  }, []);

  const onImportLocalFile = useCallback(async () => {
    const path = await pickAnalysisImportPath();
    if (!path) return;
    const format = path.toLowerCase().endsWith(".parquet") ? "parquet" : path.toLowerCase().endsWith(".json") ? "json" : "csv";
    const name = path.split(/[\\/]/).at(-1)?.replace(/\.(csv|parquet|json)$/i, "") || "Imported data";
    setBusyMsg(`Importing ${name}…`);
    try {
      await backend.call("connection.add", { config: { id: "local-duckdb", label: "Local DuckDB", dialect: "duckdb", endpoint: "local.duckdb", user: "" } });
      await importAnalysisFile({ workspaceId: "local-duckdb", name, path, format, selection: { mode: "full" } });
      await loadConnections();
      setSidebarCache((previous) => { const next = { ...previous }; delete next["local-duckdb"]; return next; });
      setAnalysisWorkspaceId(null);
      updateTab(activeTab.id, { connectionId: "local-duckdb" });
    } catch (error) {
      updateTab(activeTab.id, { error: `${t("error")}: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusyMsg(null);
    }
  }, [activeTab.id, loadConnections, updateTab, t]);

  const onEditConnection = useCallback((id: string) => {
    const c = connections.find((x) => x.id === id);
    if (!c) return;
    setEditingConfig(c);
    setDuplicatingConnection(false);
    setDialogOpen(true);
  }, [connections]);

  const onDuplicateConnection = useCallback((id: string) => {
    const c = connections.find((x) => x.id === id);
    if (!c) return;
    setEditingConfig(c);
    setDuplicatingConnection(true);
    setDialogOpen(true);
  }, [connections]);

  const onRemoveConnection = useCallback(
    async (id: string) => {
      if (!confirm(t("removeConnection"))) return;
      try {
        await backend.call("connection.remove", { connectionId: id });
        await loadConnections();
        if (id === analysisS3ConnectionId) {
          setAnalysisS3ConnectionId(null);
          setAnalysisWorkspaceId(null);
        }
      } catch (e) {
        updateTab(activeTab.id, { error: `${t("error")}: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [activeTab.id, analysisS3ConnectionId, loadConnections, updateTab, t],
  );

  const onCreateConnectionGroup = useCallback(async (name: string) => {
    await backend.call("connectionGroup.create", { name });
    await loadConnectionGroups();
  }, [loadConnectionGroups]);

  const onRenameConnectionGroup = useCallback(async (id: string, name: string) => {
    await backend.call("connectionGroup.rename", { groupId: id, name });
    await loadConnectionGroups();
  }, [loadConnectionGroups]);

  const onDeleteConnectionGroup = useCallback(async (id: string) => {
    await backend.call("connectionGroup.delete", { groupId: id });
    await loadConnectionGroups();
    await loadConnections();
  }, [loadConnectionGroups, loadConnections]);

  const onMoveConnection = useCallback(async (id: string, groupId: string | null) => {
    await backend.call("connection.move", { connectionId: id, groupId });
    await loadConnections();
  }, [loadConnections]);

  const onConnectionSaved = useCallback(async (connectionId: string) => {
    setDialogOpen(false);
    const { configs } = await backend.call<{ configs: ConnectionEntry[] }>("connection.list", {});
    if (configs.some((config) => config.id === connectionId && config.dialect === "s3")) {
      await loadConnections();
      setAnalysisWorkspaceId(null);
      updateTab(activeTab.id, { connectionId });
      setSidebarCache((previous) => { const next = { ...previous }; delete next[connectionId]; return next; });
      return;
    }
    if (!activeTab.connectionId) {
      updateTab(activeTab.id, { connectionId });
    }
    await loadConnections();
    await introspectConnection(connectionId, activeTab.id);
  }, [activeTab.connectionId, activeTab.id, introspectConnection, loadConnections, updateTab]);

  const handleAutocomplete = useCallback(
    async (cursor: number, sql = "", signal?: AbortSignal): Promise<Suggestion[]> => {
      if (!activeConnectionId || !activeConnection) return [];
      if (activeDialect === "s3") {
        const data = sidebarCache[activeConnectionId];
        if (!data) return [];
        const referenced = s3ReferencedRelations(sql, data.relations);
        const resolved = await Promise.all(referenced.map(async (relation) => ({ ...relation,
          columns: relation.columns?.length ? relation.columns : await loadS3Columns(activeConnectionId, relation.schema, relation.name),
        })));
        const updated = data.relations.map((relation) => resolved.find((item) => item.schema === relation.schema && item.name === relation.name) ?? relation);
        return localizeSuggestionLabels(s3Suggestions(sql, cursor, updated), t("autocompleteAllColumns"));
      }
      if (activeDialect === "duckdb") return [];
      const r = await backend.call<{ suggestions: Suggestion[] }>("completion.get", {
        connectionId: activeConnectionId,
        sql,
        cursor,
      }, signal);
      return localizeSuggestionLabels(r.suggestions, t("autocompleteAllColumns"));
    },
    [activeConnectionId, activeConnection, activeDialect, loadS3Columns, sidebarCache, t],
  );
  const analysisSourceStreaming = activeConnection !== null && activeDialect !== "s3" && activeDialect !== "duckdb";

  const handleApplyTranspiled = useCallback((diagnostic: SqlDiagnostic) => {
    if (!diagnostic.transpiledSql) return;
    const statement = splitStatements(activeTab.sql).find(
      (candidate) => diagnostic.start >= candidate.start && diagnostic.start < candidate.end,
    );
    if (!statement) return;
    const confirmed = window.confirm(
      `Transpilar ${diagnostic.sourceDialect ?? "origem desconhecida"} → ${diagnostic.targetDialect ?? activeDialect}?\n\n` +
      `Original:\n${statement.text}\n\nResultado:\n${diagnostic.transpiledSql}`,
    );
    if (!confirmed) return;
    editorRef.current?.replaceTextRange(statement.start, statement.end, diagnostic.transpiledSql);
    updateTabSql(activeTab.id, editorRef.current?.getAllText() ?? activeTab.sql);
    setDiagnostics((current) => current.filter((item) => item !== diagnostic));
  }, [activeTab.id, activeTab.sql, updateTabSql, activeDialect]);

  const pushHistory = useCallback((sql: string, ok: boolean) => {
    const entry: HistoryEntry = {
      id: makeHistoryId(),
      sql,
      ok,
      executedAt: new Date().toISOString(),
    };
    setHistory((prev) => [entry, ...prev].slice(0, 50));
  }, []);

  const finishQuery = useCallback((activeQuery: ActiveQuery) => {
    if (!activeQuery.finished || (activeQuery.cancelPromise && !activeQuery.cancelSettled) || activeQueryRef.current !== activeQuery) return;
    activeQueryRef.current = null;
    setRunning(false);
    setBusyMsg(null);
  }, []);

  const runSqlSequence = useCallback(
    async (sqls: string[], label: string, executionRiskAccepted = false) => {
      if (!activeConnectionId || !activeConnection || !activeTab) return;
      const variables = extractVariablesUnion(sqls);
      if (variables.length > 0) {
        setRunAfterVariables({ sqls, label });
        setVariableNames(variables);
        setVariablesOpen(true);
        return;
      }
      const joinedSql = sqls.join(";\n");
      const risk = analyzeExecutionRisk(joinedSql, activeDialect);
      const warningTrusted = risk.level === "warning" && trustedWarningConnections.has(activeConnectionId);
      if (risk.level !== "none" && !executionRiskAccepted && !warningTrusted) {
        setPendingRiskRun({ sqls, label, analysis: risk });
        return;
      }
      const riskAccepted = executionRiskAccepted || warningTrusted;
      if (activeQueryRef.current) return;
      updateTab(activeTab.id, { error: null });
      const executionSequence = ++executionSequenceRef.current;
      const activeQuery: ActiveQuery = {
        sequence: executionSequence,
        connectionId: activeConnectionId,
        engineOperationId: null,
        abortController: new AbortController(),
        cancelPromise: null,
        cancelSettled: false,
        finished: false,
      };
      activeQueryRef.current = activeQuery;
      setRunning(true);
      setBusyMsg(label);
      setResult(null);
      setAnalysisSourceSql(null);
      setEditability(null);
      setPlanText(null);
      try {
        let lastResult: QueryResult | null = null;
        for (const sql of sqls) {
          if (activeDialect === "s3" && activeConnection) {
            const credentials = await backend.call<{ accessKeyId: string; secretAccessKey?: string }>("connection.s3Credentials", { connectionId: activeConnectionId });
            activeQuery.engineOperationId = `s3-catalog-${crypto.randomUUID()}`;
            lastResult = await runS3CatalogQuery({
              workspaceId: activeTab.id,
              sources: s3Catalog[activeConnectionId] ?? [],
              region: String(activeConnection.options?.region ?? ""),
              endpoint: String(activeConnection.options?.endpoint ?? "") || undefined,
              accessKeyId: credentials.accessKeyId || undefined,
              secretAccessKey: credentials.secretAccessKey,
              sql,
              limit: activeTab.queryLimit,
              operationId: activeQuery.engineOperationId,
            });
            continue;
          }
          if (activeDialect === "duckdb") {
            activeQuery.engineOperationId = `local-query-${crypto.randomUUID()}`;
            lastResult = await runAnalysis("local-duckdb", sql, activeTab.queryLimit, activeQuery.engineOperationId);
            continue;
          }
          lastResult = await backend.call<QueryResult>("query.run", {
            connectionId: activeConnectionId,
            sql,
            limit: activeTab.queryLimit,
            ...(riskAccepted ? { executionRiskAccepted: true } : {}),
          }, activeQuery.abortController.signal);
        }
        if (!lastResult) return;
        setResult(lastResult);
        setAnalysisSourceSql(sqls.at(-1) ?? null);
        updateTab(activeTab.id, { error: null, latestSqlExecutionError: null });
        ++connectionHealthCheckRef.current;
        setConnectionHealth("online");
        pushHistory(sqls.join(";\n"), true);
        if (activeDialect !== "s3" && activeDialect !== "duckdb") void backend
          .call<RowEditability>("query.analyzeEditability", { connectionId: activeConnectionId, sql: joinedSql })
          .then((nextEditability) => {
            if (executionSequence === executionSequenceRef.current) setEditability(nextEditability);
          })
          .catch((e: unknown) => {
            if (executionSequence !== executionSequenceRef.current) return;
            const message = e instanceof Error ? e.message.trim() : "";
            const safeMessage = message.length > 0 && message.length <= 120 && !message.includes("\r") && !message.includes("\n") ? `: ${message}` : "";
            setEditability({
              editable: false,
              reason: `${t("editabilityCheckFailed")}${safeMessage}.`,
              table: null,
              pkColumns: [],
              selectStar: false,
              columns: [],
            });
          });
      } catch (e) {
        if (activeQueryRef.current !== activeQuery) return;
        const executionError = sqlExecutionErrorFrom(e);
        updateTab(activeTab.id, {
          error: e instanceof Error ? e.message : String(e),
          latestSqlExecutionError: executionError,
        });
        const executedSql = sqls.join(";\n");
        if (activeDialect !== "s3" && activeDialect !== "duckdb") void backend
          .call<{ diagnostics: SqlDiagnostic[] }>("query.diagnose", {
            connectionId: activeConnectionId,
            sql: executedSql,
          })
          .then((response) => {
            if (executionSequence !== executionSequenceRef.current) return;
            const diagnostic = matchingDiagnostic(response.diagnostics, executionError.message);
            const position = diagnostic ? diagnosticPosition(diagnostic) : undefined;
            if (position) updateTab(activeTab.id, { latestSqlExecutionError: { ...executionError, position } });
            if (executedSql === activeTab.sql) setDiagnostics(response.diagnostics);
          })
          .catch(() => undefined);
        pushHistory(executedSql, false);
      } finally {
        activeQuery.finished = true;
        finishQuery(activeQuery);
      }
    },
    [activeConnectionId, activeConnection, activeDialect, activeTab, finishQuery, pushHistory, s3Catalog, trustedWarningConnections, updateTab, t],
  );

  const handleCancelRun = useCallback(() => {
    const activeQuery = activeQueryRef.current;
    if (!activeQuery || activeQuery.finished || activeQuery.cancelPromise) return;
    activeQuery.cancelPromise = (activeQuery.engineOperationId
      ? cancelAnalysis(activeQuery.engineOperationId)
      : backend
      .call("query.cancel", { connectionId: activeQuery.connectionId })
    )
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        activeQuery.abortController.abort();
        activeQuery.cancelSettled = true;
        finishQuery(activeQuery);
      });
  }, [finishQuery]);

  const exportFullLocalCsv = useCallback(async () => {
    if (activeDialect !== "duckdb" || !activeConnectionId || !analysisSourceSql || activeQueryRef.current) return;
    const path = await pickAnalysisExportPath(activeTab.title.replaceAll(/[^a-zA-Z0-9_-]/g, "_"), "csv");
    if (!path || activeQueryRef.current) return;
    const operationId = `export-${crypto.randomUUID()}`;
    const activeQuery: ActiveQuery = {
      sequence: ++executionSequenceRef.current,
      connectionId: activeConnectionId,
      engineOperationId: operationId,
      abortController: new AbortController(),
      cancelPromise: null,
      cancelSettled: false,
      finished: false,
    };
    activeQueryRef.current = activeQuery;
    setRunning(true);
    setBusyMsg(t("analysisExportCsv"));
    updateTab(activeTab.id, { error: null });
    try {
      await exportAnalysis({ workspaceId: "local-duckdb", sql: analysisSourceSql, path, format: "csv", operationId });
    } catch (cause) {
      if (activeQueryRef.current === activeQuery) updateTab(activeTab.id, { error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      activeQuery.finished = true;
      finishQuery(activeQuery);
    }
  }, [activeConnectionId, activeDialect, activeTab.id, activeTab.title, analysisSourceSql, finishQuery, t, updateTab]);

  const handleRun = useCallback(() => {
    if (!activeConnectionId) return;
    const target = editorRef.current?.getSelectionOrCurrent();
    const sql = target?.sql ?? activeTab.sql;
    const statements = splitStatements(sql);
    if (statements.length > 1 && !target?.sql) {
      setPendingRun({ sqls: statements.map((s) => s.text), label: t("running"), runAll: false });
      return;
    }
    const sqls = target?.sql ? [target.sql] : statements.map((s) => s.text);
    if (sqls.length === 0 || sqls.every((s) => !s.trim())) return;
    void runSqlSequence(sqls, t("running"));
  }, [activeConnectionId, activeTab.sql, runSqlSequence, t]);

  const handleRunAll = useCallback(() => {
    if (!activeConnectionId) return;
    const sqls = editorRef.current?.getStatements().map((s) => s.text) ?? splitStatements(activeTab.sql).map((s) => s.text);
    if (sqls.length === 0 || sqls.every((s) => !s.trim())) return;
    void runSqlSequence(sqls, t("runningAll"));
  }, [activeConnectionId, activeTab.sql, runSqlSequence, t]);

  const handleRunChoice = useCallback(
    (choice: "current" | "all") => {
      if (!pendingRun) return;
      if (choice === "current" && pendingRun.runAll === false) {
        const current = editorRef.current?.getCurrentStatement();
        const sqls = current ? [current.text] : [pendingRun.sqls[0]!];
        void runSqlSequence(sqls, t("running"));
      } else {
        void runSqlSequence(pendingRun.sqls, t("runningAll"));
      }
      setPendingRun(null);
    },
    [pendingRun, runSqlSequence, t],
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
    if (!activeConnectionId) return;
    const sql = editorRef.current?.getSelectionOrCurrent().sql ?? activeTab.sql;
    if (!sql.trim()) return;
    setBusyMsg(t("explaining"));
    setPlanText(null);
    backend
      .call<{ textual: string }>("query.explain", { connectionId: activeConnectionId, sql })
      .then((res) => setPlanText(res.textual))
      .catch((e) => updateTab(activeTab.id, { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusyMsg(null));
  }, [activeConnectionId, activeTab, updateTab, t]);

  const handleCellEdit = useCallback(
    async (rowIndex: number, colIndex: number, value: unknown) => {
      if (!activeConnectionId || !result || !editability?.editable) return;
      const row = result.rows[rowIndex];
      if (!row) return;
      let sourceColumn: string | undefined;
      if (editability.columns.length === 0) {
        sourceColumn = result.columns[colIndex]?.name;
      } else {
        const editableColumn = editability.columns[colIndex];
        if (!editableColumn || editableColumn.sourceColumn === null) return;
        sourceColumn = editableColumn.sourceColumn;
      }
      if (!sourceColumn) return;
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
        throw e;
      }
    },
    [activeConnectionId, activeTab.id, editability, result, updateTab],
  );

  const handleInsertRow = useCallback(async (valuesByColumn: Readonly<Record<number, unknown>>) => {
    if (!activeConnectionId || !result || !editability?.editable || !editability.table) return;
    const values: Record<string, unknown> = {};
    for (const [rawIndex, value] of Object.entries(valuesByColumn)) {
      const columnIndex = Number(rawIndex);
      const sourceColumn = editability.columns.length === 0
        ? result.columns[columnIndex]?.name
        : editability.columns[columnIndex]?.sourceColumn;
      if (sourceColumn) values[sourceColumn] = value;
    }
    try {
      await backend.call("row.insert", { connectionId: activeConnectionId, table: editability.table, values });
      await runSqlSequence([activeTab.sql], t("running"));
    } catch (e) {
      updateTab(activeTab.id, { error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }, [activeConnectionId, activeTab.id, activeTab.sql, editability, result, runSqlSequence, t, updateTab]);

  const onSaveTab = useCallback(async () => {
    if (!activeTab.filePath) {
      const path = await pickSavePath(activeTab.title);
      if (!path) return;
      try {
        await writeSqlFile(path, activeTab.sql);
        updateTab(activeTab.id, { filePath: path, title: basenameNoExt(path), savedSql: activeTab.sql, error: null });
      } catch (e) {
        updateTab(activeTab.id, { error: `${t("saveFailed")}: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }
    try {
      await writeSqlFile(activeTab.filePath, activeTab.sql);
      updateTab(activeTab.id, { savedSql: activeTab.sql, error: null });
    } catch (e) {
      updateTab(activeTab.id, { error: `${t("saveFailed")}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [activeTab, updateTab, t]);

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
      updateTab(activeTab.id, { error: `${t("openFailed")}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [activeTab.connectionId, activeTab.id, addTab, setTabs, updateTab, t]);

  const onSaveFormatSettings = useCallback(
    (settings: FormatterSettings) => {
      setFormatterSettings(settings);
      saveFormatterSettings(settings);
      setFormatSettingsOpen(false);
    },
    [],
  );

  const onClearHistory = useCallback(() => setHistory([]), []);

  const onOpenInNewTab = useCallback(
    (title: string, sql: string) => {
      const newTab = makeTab({ title, sql, connectionId: activeConnectionId });
      setTabs((prev) => [...prev, newTab]);
      selectTab(newTab.id);
    },
    [activeConnectionId, setTabs, selectTab],
  );

  useEffect(() => {
    void invoke("set_native_menu_language", { language }).catch(() => undefined);
  }, [language]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<string>(NATIVE_MENU_EVENT, ({ payload }) => {
      if (cancelled) return;
      switch (payload) {
        case "new-sql": addTab(activeConnectionId); break;
        case "open-sql": void onOpenFile(); break;
        case "save-sql": void onSaveTab(); break;
        case "toggle-sidebar": setSidebarOpen((open) => !open); break;
        case "show-history": setHistoryOpen(true); break;
        case "open-settings": setFormatSettingsOpen(true); break;
      }
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlisten = cleanup;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeConnectionId, addTab, onOpenFile, onSaveTab]);


  const getMcpSchemaSummary = useCallback(async (connectionId: string): Promise<McpToolResultByName["getSchemaSummary"]> => {
    if (mcpStateRef.current.activeConnection?.id !== connectionId) {
      throw new McpUiError("stale", "Active connection changed before schema read");
    }
    const response = await backend.call<{ relations: RelationInfo[] }>("metadata.listRelations", {
      connectionId,
      includeColumns: true,
    });
    if (mcpStateRef.current.activeConnection?.id !== connectionId) {
      throw new McpUiError("stale", "Active connection changed during schema read");
    }
    const schemas = new Map<string, { name: string; relations: { name: string; kind: "table" | "view"; columns: { name: string; dataType: string }[] }[] }>();
    for (const relation of response.relations) {
      const schema = schemas.get(relation.schema) ?? { name: relation.schema, relations: [] };
      schema.relations.push({
        name: relation.name,
        kind: relation.kind,
        columns: (relation.columns ?? []).map((column) => ({ name: column.name, dataType: column.dataType })),
      });
      schemas.set(relation.schema, schema);
    }
    return { connectionId, schemas: [...schemas.values()] };
  }, []);

  const getMcpTableIndexes = useCallback(async (
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<McpToolResultByName["getTableIndexes"]> => {
    if (mcpStateRef.current.activeConnection?.id !== connectionId) {
      throw new McpUiError("stale", "Active connection changed before index read");
    }
    const response = await backend.call<{ indexes: McpToolResultByName["getTableIndexes"]["indexes"] }>(
      "metadata.listIndexes",
      { connectionId, schema, table },
    );
    if (mcpStateRef.current.activeConnection?.id !== connectionId) {
      throw new McpUiError("stale", "Active connection changed during index read");
    }
    return { connectionId, indexes: response.indexes };
  }, []);

  const explainMcpSql = useCallback(async (
    connectionId: string,
    sql: string,
  ): Promise<McpToolResultByName["explainSql"]> => {
    if (mcpStateRef.current.activeConnection?.id !== connectionId) {
      throw new McpUiError("stale", "Active connection changed before SQL explain");
    }
    const response = await backend.call<McpToolResultByName["explainSql"] & { raw: unknown }>(
      "query.explain",
      { connectionId, sql },
    );
    if (mcpStateRef.current.activeConnection?.id !== connectionId) {
      throw new McpUiError("stale", "Active connection changed during SQL explain");
    }
    return { textual: response.textual, format: response.format };
  }, []);

  const proposeMcpEdit = useCallback((args: { sql: string; rationale: string; tabId: string; originalSql: string; expiresAt?: number }) => {
    return new Promise<"approved" | "rejected" | "stale">((resolve) => {
      if (args.expiresAt !== undefined && args.expiresAt <= Date.now() + MCP_PROPOSAL_SAFETY_WINDOW_MS) {
        resolve("rejected");
        return;
      }
      mcpProposalResolverRef.current?.("rejected");
      mcpProposalResolverRef.current = resolve;
      setMcpProposal({
        tabId: args.tabId,
        originalSql: args.originalSql,
        proposedSql: args.sql,
        rationale: args.rationale,
        expiresAt: args.expiresAt,
        revision: getTabRevision(args.tabId),
      });
    });
  }, []);

  const resolveMcpProposal = useCallback((outcome: "approved" | "rejected" | "stale") => {
    const resolver = mcpProposalResolverRef.current;
    mcpProposalResolverRef.current = null;
    setMcpProposal(null);
    resolver?.(outcome);
  }, []);

  const applyMcpProposal = useCallback(() => {
    if (!mcpProposal) return;
    if (mcpProposal.expiresAt !== undefined && mcpProposal.expiresAt <= Date.now() + MCP_PROPOSAL_SAFETY_WINDOW_MS) {
      resolveMcpProposal("rejected");
      return;
    }
    const applied = compareAndSwapTabSql(
      mcpProposal.tabId,
      mcpProposal.revision,
      mcpProposal.originalSql,
      mcpProposal.proposedSql,
      () => mcpProposal.expiresAt === undefined || mcpProposal.expiresAt > Date.now() + MCP_PROPOSAL_SAFETY_WINDOW_MS,
    );
    if (!applied) {
      resolveMcpProposal("stale");
      return;
    }
    resolveMcpProposal("approved");
  }, [compareAndSwapTabSql, mcpProposal, resolveMcpProposal]);

  useEffect(() => {
    if (!mcpProposal?.expiresAt) return;
    const delay = Math.max(0, mcpProposal.expiresAt - MCP_PROPOSAL_SAFETY_WINDOW_MS - Date.now());
    const timer = window.setTimeout(() => resolveMcpProposal("rejected"), delay);
    return () => window.clearTimeout(timer);
  }, [mcpProposal, resolveMcpProposal]);

  useEffect(() => {
    const bridge = new McpUiBridge({
      readState: () => ({ ...mcpStateRef.current, editor: editorRef.current }),
      getSchemaSummary: getMcpSchemaSummary,
      getTableIndexes: getMcpTableIndexes,
      explainSql: explainMcpSql,
      proposeEdit: proposeMcpEdit,
      onStatus: (status, error) => {
        setMcpStatus(status);
        setMcpError(error ?? null);
      },
    }, mcpListenerIdRef.current);
    setMcpStarted(true);
    bridge.start();
    void bridge.refresh();
    return () => {
      bridge.stop();
      setMcpStarted(false);
      mcpProposalResolverRef.current?.("rejected");
      mcpProposalResolverRef.current = null;
    };
  }, [explainMcpSql, getMcpSchemaSummary, getMcpTableIndexes, proposeMcpEdit]);

  const mcpActive = Boolean(mcpStatus?.uiConnected && (mcpStatus.queueSize > 0 || mcpStatus.inFlight > 0));
  const mcpState: McpVisualState = mcpError ? "error" : !mcpStarted ? "inactive" : mcpActive ? "connected" : "listening";

  const monacoTheme = useEditorMonacoTheme(name);

  const sidebarData = activeConnectionId ? sidebarCache[activeConnectionId] : undefined;
  const activeDatabase = connectionDatabase(activeConnection);
  const headerHealthLabel = connectionHealth === "online" ? t("headerConnected")
    : connectionHealth === "verifying" ? t("headerVerifying")
      : connectionHealth === "offline" ? t("headerOffline") : t("statusUnknown");

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
      data-theme={name}
    >
      <header className="omni-app-header" style={{ gridColumn: "1 / -1", gridRow: 1 }}>
        <div className="omni-logo">
          <img src="/omni-sql.svg" alt="omni-sql" height={28} />
          <div>
            <Title1 className="wordmark">omni-sql</Title1>
            <span className="subtitle">One IDE for every database</span>
          </div>
        </div>
        <div className="omni-header-context" aria-label={t("activeConnection")}>
          {activeConnection ? (
            <>
              <span className={`omni-header-health omni-header-health-${connectionHealth}`} title={headerHealthLabel}>
                {connectionHealth === "online" ? <PlugConnectedRegular /> : <PlugDisconnectedRegular />}
                <span>{activeConnection.label}</span>
              </span>
              <span className="omni-header-detail">
                <DialectIcon dialect={activeConnection.dialect} size={14} />
                {DIALECT_LABELS[activeConnection.dialect] ?? activeConnection.dialect}
              </span>
              {activeDatabase && <span className="omni-header-detail"><span>{t("headerDatabase")}</span><strong>{activeDatabase}</strong></span>}
              <span className={`omni-header-state omni-header-state-${connectionHealth}`}>
                <span aria-hidden className="omni-header-state-dot" />{headerHealthLabel}
              </span>
            </>
          ) : <span className="omni-header-empty"><PlugDisconnectedRegular />{t("headerNoConnection")}</span>}
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={name === "dark" ? t("switchToLightTheme") : t("switchToDarkTheme")}
          title={name === "dark" ? t("switchToLightTheme") : t("switchToDarkTheme")}
          className="omni-theme-toggle"
        >
          {name === "dark" ? <WeatherSunnyRegular fontSize={22} /> : <WeatherMoonRegular fontSize={22} />}
        </button>
      </header>

      <div style={{ gridColumn: "1 / -1", gridRow: 2 }}>
        <Toolbar
          activeConnectionId={activeConnectionId}
          busyMsg={busyMsg}
          running={running}
          limit={activeTab.queryLimit}
          onAdd={() => addTab(activeConnectionId)}
          onRun={handleRun}
          onExplain={handleExplain}
          explainAvailable={activeDialect !== "s3" && activeDialect !== "duckdb"}
          onCancelRun={handleCancelRun}
          onRunChoice={handleRunChoice}
          onRunChoiceCancel={handleRunChoiceCancel}
          pendingRunCount={pendingRun ? pendingRun.sqls.length : null}
          onLimitChange={(limit) => updateTab(activeTab.id, { queryLimit: limit })}
          onSave={onSaveTab}
          onOpen={onOpenFile}
          onOpenFormatSettings={() => setFormatSettingsOpen(true)}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleHistory={() => setHistoryOpen((v) => !v)}
          onOpenCommandLibrary={() => setCommandLibraryOpen(true)}
          globalOnly={analysisWorkspaceId !== null}
          analysisMode={analysisWorkspaceId !== null}
          onExitAnalysis={() => void closeAnalysisWorkspace()}
          onSendToAnalysis={activeDialect === "s3" || activeDialect === "duckdb" ? undefined : sendCurrentSqlToAnalysis}
        />
      </div>

      <aside style={{ gridColumn: 1, gridRow: "3 / span 2" }}>
        <Sidebar
          open={sidebarOpen}
          connections={connections}
          connectionGroups={connectionGroups}
          connection={activeConnection}
          connectionId={activeConnectionId}
          relations={sidebarData?.relations ?? []}
          schemas={sidebarData?.schemas ?? []}
          functions={sidebarData?.functions ?? []}
          loading={sidebarLoading}
          metadataRefreshFailed={activeConnectionId !== null && metadataRefreshFailures[activeConnectionId] === true}
          onInsert={(text) => editorRef.current?.insertAtCursor(text)}
          onAddConnection={onAddConnection}
          onImportLocalFile={onImportLocalFile}
          onImportDatabaseTable={() => { setCrossSourceConnectionId(""); setCrossSourceSql(""); setCrossSourceSearch(""); setCrossSourceError(null); setCrossSourceOpen(true); }}
          onEditConnection={onEditConnection}
          onDuplicateConnection={onDuplicateConnection}
          onRemoveConnection={onRemoveConnection}
          onRefreshMetadata={onRefreshMetadata}
          onLoadS3Columns={activeConnectionId ? (schema, table) => loadS3Columns(activeConnectionId, schema, table) : undefined}
          s3Prefix={activeConnectionId ? s3Prefixes[activeConnectionId] ?? "" : ""}
          onS3PrefixChange={onS3PrefixChange}
          onSelectConnection={onSelectConnection}
          onCreateConnectionGroup={onCreateConnectionGroup}
          onRenameConnectionGroup={onRenameConnectionGroup}
          onDeleteConnectionGroup={onDeleteConnectionGroup}
          onMoveConnection={onMoveConnection}
          onOpenInNewTab={onOpenInNewTab}
          health={connectionHealth}
          analysisActive={analysisWorkspaceId !== null}
          analysisConnectionId={analysisWorkspaceId ? analysisS3ConnectionId : null}
          onAnalysisHostChange={setAnalysisSidebarHost}
        />
      </aside>

      {!analysisWorkspaceId && <section
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
            diagnostics={diagnostics}
            onApplyTranspiled={handleApplyTranspiled}
            dialect={activeDialect}
            theme={monacoTheme}
            formatterSettings={formatterSettings}
            onFormatError={(message) => {
              setBusyMsg(`${t("error")}: ${message}`);
              window.setTimeout(() => setBusyMsg(null), 4_000);
            }}
          />
        </div>
      </section>}

      {!analysisWorkspaceId && <section style={{ gridColumn: 2, gridRow: 4, minHeight: 0, overflow: "hidden" }}>
        <ResultsGrid running={running} result={result} error={activeTab.error} planText={planText} editability={editability} relations={sidebarData?.relations ?? []} onLookupRelated={(source, value) => backend.call<QueryResult>("relation.lookup", { connectionId: activeConnectionId, source, value })} onCellEdit={handleCellEdit} onInsertRow={handleInsertRow} onAnalyzeLocally={result ? () => { setAnalysisLoadOrigin(analysisSourceStreaming && analysisSourceSql ? "source" : "displayed"); setAnalysisImportError(null); setAnalysisImportOpen(true); } : undefined} analyzingLocally={analysisImporting} onExportFullCsv={activeDialect === "duckdb" && result && analysisSourceSql ? exportFullLocalCsv : undefined} />
      </section>}

      {analysisWorkspaceId && (
        <section style={{ gridColumn: 2, gridRow: "3 / span 2", display: "flex", minHeight: 0, overflow: "hidden" }}>
          <AnalysisWorkspace workspaceId={analysisWorkspaceId} dataset={analysisDataset} onDatasetSelected={onAnalysisDatasetSelected} sourceConnections={connections.filter((connection) => connection.dialect !== "s3")} s3Connections={connections.filter((connection) => connection.dialect === "s3")} onSelectS3Connection={(id) => void onSelectConnection(id)} onConfigureS3Connection={onEditConnection} editorTheme={monacoTheme} sidebarHost={analysisSidebarHost} sidebarIntegrated initialSource={analysisInitialSource} initialS3Connection={analysisS3Connection} />
        </section>
      )}

      <div style={{ gridColumn: "1 / -1", gridRow: 5 }}>
        <StatusBar connection={activeConnection} result={result} cursorPosition={cursorPosition} busyMsg={busyMsg} health={connectionHealth} update={updateInfo} updateStatus={updateCheckStatus} onInstallUpdate={supportsInAppUpdate() ? installUpdate : undefined} mcpState={mcpState} mcpStatus={mcpStatus} mcpError={mcpError} />
      </div>

      <ConnectionDialog
        open={dialogOpen}
        editing={editingConfig}
        duplicating={duplicatingConnection}
        onClose={() => setDialogOpen(false)}
        onSaved={onConnectionSaved}
      />

      <BackgroundProcessesDialog open={backgroundProcessesOpen} onClose={() => setBackgroundProcessesOpen(false)} language={language} />

      <Dialog open={crossSourceOpen} onOpenChange={(_, data) => { if (!crossSourceBusy) setCrossSourceOpen(data.open); }}>
        <DialogSurface className="omni-standard-dialog">
          <DialogBody className="omni-dialog-body">
            <DialogTitle>Adicionar tabela de outro banco ao JOIN</DialogTitle>
            <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>Selecione uma conexão e uma tabela, ou escreva uma consulta para importar somente os dados necessários.</div>
              <select className="omni-cross-source-select" aria-label="Banco de origem" value={crossSourceConnectionId} onChange={(event) => { setCrossSourceConnectionId(event.target.value); setCrossSourceSql(""); setCrossSourceError(null); }}>
                <option value="">Selecione uma conexão</option>
                {connections.filter((connection) => connection.dialect !== "s3" && connection.dialect !== "duckdb")
                  .map((connection) => <option key={connection.id} value={connection.id}>{connection.label} ({DIALECT_LABELS[connection.dialect] ?? connection.dialect})</option>)}
              </select>
              {crossSourceConnectionId && <>
                <Input aria-label="Buscar tabela" placeholder="Buscar tabela ou schema" value={crossSourceSearch} onChange={(_, data) => setCrossSourceSearch(data.value)} />
                <select className="omni-cross-source-select" aria-label="Tabelas disponíveis" size={Math.min(6, Math.max(2, crossSourceRelations.length))} value="" onChange={(event) => {
                  const relation = crossSourceRelations.find((item) => `${item.schema}.${item.name}` === event.target.value);
                  if (relation) selectCrossSourceRelation(relation);
                }}>
                  <option value="" disabled>Escolha uma tabela</option>
                  {crossSourceRelations.filter((relation) => `${relation.schema}.${relation.name}`.toLowerCase().includes(crossSourceSearch.toLowerCase()))
                    .map((relation) => <option key={`${relation.schema}.${relation.name}`} value={`${relation.schema}.${relation.name}`}>{relation.schema}.{relation.name}</option>)}
                </select>
                <textarea className="omni-cross-source-sql" aria-label="SQL de origem" value={crossSourceSql} onChange={(event) => setCrossSourceSql(event.target.value)} rows={4} placeholder="SELECT * FROM schema.tabela WHERE ..." />
                <label><input type="checkbox" checked={crossSourceAllRows} onChange={(event) => setCrossSourceAllRows(event.target.checked)} /> Importar todas as linhas</label>
                {!crossSourceAllRows && <Input type="number" min={1} max={1000000} aria-label="Limite de linhas" value={String(crossSourceLimit)} onChange={(_, data) => setCrossSourceLimit(Math.max(1, Math.min(1000000, Number(data.value) || 1)))} />}
                <div>A tabela ficará disponível no S3 como <code>local."nome_da_tabela"</code>. Os dados são copiados para o DuckDB local.</div>
              </>}
              {crossSourceError && <MessageBar intent="error"><MessageBarBody>{crossSourceError}</MessageBarBody></MessageBar>}
            </DialogContent>
            <DialogActions className="omni-dialog-actions">
              <Button appearance="secondary" disabled={crossSourceBusy} onClick={() => setCrossSourceOpen(false)}>{t("cancel")}</Button>
              <Button appearance="primary" disabled={crossSourceBusy || !crossSourceConnectionId || !crossSourceSql.trim()} onClick={() => void importCrossSource()}>{crossSourceBusy ? "Importando..." : "Adicionar ao JOIN"}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={analysisImportOpen}>
        <DialogSurface className="omni-standard-dialog">
          <DialogBody className="omni-dialog-body">
            <DialogTitle>{t("analysisImportTitle")}</DialogTitle>
            <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <RadioGroup
                value={analysisLoadOrigin}
                onChange={(_, data) => setAnalysisLoadOrigin(data.value as "displayed" | "source")}
              >
                <Radio value="source" disabled={!analysisSourceStreaming || !analysisSourceSql} label={t("analysisSourceQuery")} />
                <Radio value="displayed" label={t("analysisDisplayedResult")} />
              </RadioGroup>
              <RadioGroup
                value={analysisSelection}
                onChange={(_, data) => setAnalysisSelection(data.value as "full" | "first_n" | "reservoir")}
              >
                <Radio value="full" label={analysisLoadOrigin === "source" ? "Todas as linhas (dados temporários)" : t("analysisDisplayedFull")} />
                <Radio value="first_n" label={t(analysisLoadOrigin === "source" ? "analysisFirstN" : "analysisDisplayedFirstN")} />
                <Radio value="reservoir" label={t(analysisLoadOrigin === "source" ? "analysisReservoir" : "analysisDisplayedReservoir")} />
              </RadioGroup>
              {analysisSelection !== "full" && (
                <Input
                  type="number"
                  min={1}
                  max={10_000}
                  value={String(analysisSampleRows)}
                  aria-label={t("analysisSampleRows")}
                  onChange={(_, data) => setAnalysisSampleRows(Math.max(1, Math.min(10_000, Number(data.value) || 1)))}
                />
              )}
              {analysisImportStatus && (
                <div role="status" aria-live="polite">
                  {analysisImportStatus.scannedRows.toLocaleString(language)} {t("analysisRowsScanned")} · {analysisImportStatus.retainedRows.toLocaleString(language)} {t("analysisRowsRetained")} · {(analysisImportStatus.processedBytes / 1_048_576).toFixed(1)} MiB
                </div>
              )}
              {analysisImportError && <MessageBar intent="error"><MessageBarBody>{analysisImportError}</MessageBarBody></MessageBar>}
            </DialogContent>
            <DialogActions className="omni-dialog-actions">
              <Button appearance="secondary" onClick={() => setAnalysisImportOpen(false)}>{t("cancel")}</Button>
              <Button appearance="primary" disabled={analysisImporting || (analysisLoadOrigin === "source" && (!analysisSourceStreaming || !analysisSourceSql))} onClick={() => void importCurrentResultForAnalysis()}>
                {analysisImporting ? t("analysisImporting") : t("analyzeLocally")}
              </Button>
              {analysisImporting && analysisImportOperationId && (
                <Button appearance="secondary" onClick={() => void cancelAnalysis(analysisImportOperationId)}>{t("stop")}</Button>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={metadataRefreshConfirmOpen} onOpenChange={(_, data) => setMetadataRefreshConfirmOpen(data.open)}>
        <DialogSurface className="omni-standard-dialog omni-confirm-dialog">
          <DialogBody className="omni-dialog-body">
            <DialogTitle>{t("refreshMetadata")}</DialogTitle>
            <DialogContent>{t("refreshMetadataConfirm")}</DialogContent>
            <DialogActions className="omni-dialog-actions">
              <Button appearance="secondary" onClick={() => setMetadataRefreshConfirmOpen(false)}>{t("cancel")}</Button>
              <Button
                appearance="primary"
                onClick={() => {
                  setMetadataRefreshConfirmOpen(false);
                  void introspectActive();
                }}
              >
                {t("refresh")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <FormatSettings
        open={formatSettingsOpen}
        dialect={activeDialect}
        settings={formatterSettings}
        onClose={() => setFormatSettingsOpen(false)}
        onSave={onSaveFormatSettings}
      />

      <SqlCommandLibrary
        open={commandLibraryOpen}
        dialect={activeDialect}
        onClose={() => setCommandLibraryOpen(false)}
        onInsert={(sql) => editorRef.current?.insertAtCursor(sql)}
      />

      <ExecutionRiskDialog
        analysis={pendingRiskRun?.analysis ?? null}
        onCancel={() => setPendingRiskRun(null)}
        onConfirm={(suppressWarningsForConnection) => {
          if (!pendingRiskRun) return;
          const { sqls, label } = pendingRiskRun;
          if (suppressWarningsForConnection && activeConnectionId) {
            setTrustedWarningConnections((current) => {
              const next = new Set(current).add(activeConnectionId);
              saveTrustedWarningConnections(next);
              return next;
            });
          }
          setPendingRiskRun(null);
          void runSqlSequence(sqls, label, true);
        }}
      />

      <HistoryPanel open={historyOpen} entries={history} onClose={() => setHistoryOpen(false)} onClear={onClearHistory} />

      <VariablesDialog
        open={variablesOpen}
        variables={variableNames}
        onClose={() => {
          setVariablesOpen(false);
          setRunAfterVariables(null);
        }}
        onSubmit={handleVariablesSubmit}
      />

      <McpEditDialog proposal={mcpProposal} onApply={applyMcpProposal} onReject={() => resolveMcpProposal("rejected")} />
    </div>
  );
}
