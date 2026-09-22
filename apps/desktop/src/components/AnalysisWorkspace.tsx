import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Combobox,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  Option,
} from "@fluentui/react-components";
import { CheckmarkRegular, DeleteRegular, EditRegular } from "@fluentui/react-icons";
import type { QueryResult } from "@omni-sql/ts-types";
import type { DatasetRef } from "../lib/analysis";
import { cancelAnalysis, dropAnalysisDataset, exportAnalysis, importAnalysisFile, importQuerySource, listAnalysisDatasets, normalizeAnalysisSource, renameAnalysisDataset, runAnalysis } from "../lib/analysis";
import { backend, type RelationInfo } from "../lib/backend";
import { localAnalysisSuggestions } from "../lib/analysis-autocomplete";
import type { EditorProps } from "./Editor";
import { Editor } from "./Editor";
import { pickAnalysisExportPath, pickAnalysisImportPath } from "../lib/file-io";
import { useLanguage } from "../i18n";
import { ResultsGrid } from "./ResultsGrid";

interface AnalysisWorkspaceProps {
  readonly workspaceId: string;
  readonly dataset: DatasetRef | null;
  readonly onDatasetSelected?: (dataset: DatasetRef | null) => void;
  readonly sourceConnections?: readonly { id: string; label: string; dialect: string }[];
  readonly editorTheme?: EditorProps["theme"];
  readonly sidebarHost?: HTMLElement | null;
  readonly sidebarIntegrated?: boolean;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function AnalysisWorkspace({ workspaceId, dataset, onDatasetSelected, sourceConnections = [], editorTheme, sidebarHost, sidebarIntegrated = false }: AnalysisWorkspaceProps) {
  const { t } = useLanguage();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<readonly DatasetRef[]>([]);
  const [fileSelection, setFileSelection] = useState<"full" | "first_n" | "reservoir">("full");
  const [fileSampleRows, setFileSampleRows] = useState(1_000);
  const [sourceConnectionId, setSourceConnectionId] = useState("");
  const [sourceSql, setSourceSql] = useState("");
  const [sourceMetadata, setSourceMetadata] = useState<Record<string, readonly RelationInfo[]>>({});
  const [renamingDatasetId, setRenamingDatasetId] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const selectedDatasetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (dataset && selectedDatasetIdRef.current !== dataset.id) {
      selectedDatasetIdRef.current = dataset.id;
      setSql(`SELECT * FROM ${quoteIdentifier(dataset.relationName)}`);
      setResult(null);
      setError(null);
    }
    void listAnalysisDatasets(workspaceId)
      .then((items) => {
        setDatasets(items);
        if (!dataset && items[0]) onDatasetSelected?.(items[0]);
      })
      .catch(() => setDatasets(dataset ? [dataset] : []));
  }, [dataset, onDatasetSelected, workspaceId]);

  useEffect(() => {
    const connectionIds = [...new Set([sourceConnectionId, ...datasets.map((item) => item.sourceConnectionId ?? "")].filter(Boolean))];
    if (connectionIds.length === 0) return;
    let cancelled = false;
    void Promise.all(connectionIds.map(async (connectionId) => {
      const { relations } = await backend.call<{ relations: RelationInfo[] }>("metadata.listRelations", { connectionId, includeColumns: true });
      return [connectionId, relations] as const;
    })).then((entries) => { if (!cancelled) setSourceMetadata((current) => ({ ...current, ...Object.fromEntries(entries) })); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [datasets, sourceConnectionId]);

  const run = async () => {
    if (!dataset || running) return;
    setRunning(true);
    const nextOperationId = `query-${crypto.randomUUID()}`;
    setOperationId(nextOperationId);
    setError(null);
    try {
      setResult(await runAnalysis(workspaceId, sql, 1_000, nextOperationId));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      setOperationId(null);
    }
  };

  const exportResult = async (format: "csv" | "parquet") => {
    if (!dataset || running || !sql.trim()) return;
    const path = await pickAnalysisExportPath(dataset.name.replaceAll(/[^a-zA-Z0-9_-]/g, "_"), format);
    if (!path) return;
    setRunning(true);
    const nextOperationId = `export-${crypto.randomUUID()}`;
    setOperationId(nextOperationId);
    setError(null);
    try {
      await exportAnalysis({ workspaceId, sql, path, format, operationId: nextOperationId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      setOperationId(null);
    }
  };

  const importFile = async () => {
    if (running) return;
    const path = await pickAnalysisImportPath();
    if (!path) return;
    const format = path.toLowerCase().endsWith(".parquet") ? "parquet" : "csv";
    const name = path.split(/[\\/]/).pop()?.replace(/\.(csv|parquet)$/i, "") || "Imported data";
    setRunning(true);
    const nextOperationId = `file-import-${crypto.randomUUID()}`;
    setOperationId(nextOperationId);
    setError(null);
    try {
      const imported = await importAnalysisFile({
        workspaceId,
        name,
        path,
        format,
        operationId: nextOperationId,
        selection: fileSelection === "full" ? { mode: "full" } : fileSelection === "first_n"
          ? { mode: "first_n", rows: fileSampleRows }
          : { mode: "reservoir", rows: fileSampleRows, seed: 42 },
      });
      setDatasets(await listAnalysisDatasets(workspaceId));
      onDatasetSelected?.(imported);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      setOperationId(null);
    }
  };

  const importSource = async () => {
    if (running || !sourceConnectionId || !sourceSql.trim()) return;
    const source = normalizeAnalysisSource(sourceSql);
    if (!source) {
      setError(t("analysisInvalidSource"));
      return;
    }
    setRunning(true);
    const nextOperationId = `source-import-${crypto.randomUUID()}`;
    setOperationId(nextOperationId);
    setError(null);
    try {
      const imported = await importQuerySource({
        workspaceId,
        name: source.suggestedName ?? `${sourceConnections.find((item) => item.id === sourceConnectionId)?.label ?? "Source"} query`,
        connectionId: sourceConnectionId,
        sql: source.sql,
        operationId: nextOperationId,
        selection: fileSelection === "full" ? { mode: "full" } : fileSelection === "first_n"
          ? { mode: "first_n", rows: fileSampleRows }
          : { mode: "reservoir", rows: fileSampleRows, seed: 42 },
      });
      setDatasets(await listAnalysisDatasets(workspaceId));
      onDatasetSelected?.(imported);
      setSourceSql("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      setOperationId(null);
    }
  };

  const renameDataset = async (item: DatasetRef) => {
    const name = datasetName.trim();
    if (!name || running) return;
    setRunning(true);
    setError(null);
    try {
      const renamed = await renameAnalysisDataset(item.workspaceId, item.id, name);
      setDatasets((current) => current.map((candidate) => candidate.id === renamed.id ? renamed : candidate));
      setSql((current) => current.replaceAll(quoteIdentifier(item.relationName), quoteIdentifier(renamed.relationName)));
      if (dataset?.id === renamed.id) {
        onDatasetSelected?.(renamed);
      }
      setRenamingDatasetId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const dropDataset = async (item: DatasetRef) => {
    if (running || !window.confirm(t("analysisDeleteDatasetConfirm").replace("{name}", item.name))) return;
    setRunning(true);
    setError(null);
    try {
      await dropAnalysisDataset(item.workspaceId, item.id);
      const remaining = datasets.filter((candidate) => candidate.id !== item.id);
      setDatasets(remaining);
      if (dataset?.id === item.id) onDatasetSelected?.(remaining[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const relationQuery = sourceSql.trim().toLocaleLowerCase();
  const sourceSuggestions = (sourceMetadata[sourceConnectionId] ?? [])
    .filter((relation) => relation.kind === "table")
    .filter((relation) => !relationQuery || `${relation.schema}.${relation.name}`.toLocaleLowerCase().includes(relationQuery))
    .slice(0, 50);
  const autocomplete = useCallback(async (cursor: number, currentSql = "") =>
    localAnalysisSuggestions(currentSql, cursor, datasets, sourceMetadata), [datasets, sourceMetadata]);

  const datasetPanel = <aside className="omni-analysis-datasets">
    <Text weight="semibold">{t("analysisDatasets")}</Text>
    {datasets.map((item) => (
      <div className={`omni-analysis-dataset${item.id === dataset?.id ? " is-active" : ""}`} key={item.id}>
        {renamingDatasetId === item.id ? (
          <>
            <Input size="small" autoFocus value={datasetName} onChange={(_, data) => setDatasetName(data.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameDataset(item); }} aria-label={t("analysisDatasetName")} />
            <Button size="small" appearance="subtle" icon={<CheckmarkRegular />} aria-label={t("analysisSaveDatasetName")} onClick={() => void renameDataset(item)} disabled={!datasetName.trim() || running} />
          </>
        ) : (
          <>
            <button type="button" className="omni-analysis-dataset-select" onClick={() => onDatasetSelected?.(item)}>
              <span>{item.name}</span><code>{item.relationName}</code>
            </button>
            <Button size="small" appearance="subtle" icon={<EditRegular />} aria-label={t("analysisRenameDataset")} onClick={() => { setRenamingDatasetId(item.id); setDatasetName(item.name); }} />
            <Button size="small" appearance="subtle" icon={<DeleteRegular />} aria-label={t("analysisDeleteDataset")} onClick={() => void dropDataset(item)} disabled={running} />
          </>
        )}
      </div>
    ))}
    <details className="omni-analysis-source-panel">
      <summary>{t("analysisAddSource")}</summary>
      <select aria-label={t("activeConnection")} value={sourceConnectionId} onChange={(event) => setSourceConnectionId(event.target.value)}>
        <option value="">{t("headerNoConnection")}</option>
        {sourceConnections.filter((item) => item.dialect === "postgres").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <Combobox size="small" freeform value={sourceSql} onChange={(event) => setSourceSql(event.currentTarget.value)} onOptionSelect={(_, data) => { if (data.optionValue) setSourceSql(data.optionValue); }} placeholder={t("analysisSourcePlaceholder")} aria-label={t("analysisSourceSql")}>
        {sourceSuggestions.map((relation) => {
          const value = `${relation.schema}.${relation.name}`;
          return <Option key={value} value={value}>{value}</Option>;
        })}
      </Combobox>
      <Button size="small" onClick={() => void importSource()} disabled={running || !sourceConnectionId || !sourceSql.trim()}>{t("analysisImportSource")}</Button>
    </details>
    <div className="omni-analysis-import-controls">
      <select aria-label={t("analysisFileSelection")} value={fileSelection} onChange={(event) => setFileSelection(event.target.value as typeof fileSelection)} disabled={running}>
        <option value="full">{t("analysisFullSnapshot")}</option>
        <option value="first_n">{t("analysisFirstN")}</option>
        <option value="reservoir">{t("analysisReservoir")}</option>
      </select>
      {fileSelection !== "full" && <Input size="small" type="number" min={1} max={10_000} value={String(fileSampleRows)} onChange={(_, data) => setFileSampleRows(Math.max(1, Math.min(10_000, Number(data.value) || 1)))} aria-label={t("analysisSampleRows")} />}
      <Button size="small" appearance="secondary" onClick={() => void importFile()} disabled={running}>{t("analysisImportFile")}</Button>
    </div>
  </aside>;

  return (
    <section className={`omni-analysis-workspace${sidebarIntegrated ? " has-sidebar-portal" : ""}`} aria-label={t("analyzeLocally")}>
      {sidebarHost && createPortal(datasetPanel, sidebarHost)}
      <div className="omni-analysis-body">
        {!sidebarIntegrated && datasetPanel}
        <main className="omni-analysis-main">
            {dataset && dataset.coverage !== "complete" && (
              <MessageBar intent="warning"><MessageBarBody>{dataset.coverage === "sampled" ? t("analysisSampledSnapshot") : t("analysisPartialSnapshot")}</MessageBarBody></MessageBar>
            )}
            {dataset && (
              <Text size={200}>
                {dataset.rowCount} {t("rows")} · {dataset.scannedRows} {t("analysisRowsScanned")} · SQL: {quoteIdentifier(dataset.relationName)}
              </Text>
            )}
            <div className="omni-analysis-editor" aria-label={t("analysisSql")}>
              <Editor value={sql} onChange={setSql} onRun={() => void run()} onRunAll={() => void run()} onAutocomplete={autocomplete} dialect="postgres" theme={editorTheme} />
            </div>
            {running && <Spinner size="small" label={t("running")} />}
            <div className="omni-analysis-results">
              <ResultsGrid result={result} error={error} running={running} />
            </div>
          <footer className="omni-analysis-actions">
            {running && operationId && (
              <Button appearance="secondary" onClick={() => void cancelAnalysis(operationId)}>{t("stop")}</Button>
            )}
            <Button appearance="secondary" onClick={() => void exportResult("csv")} disabled={!dataset || running || !sql.trim()}>{t("analysisExportCsv")}</Button>
            <Button appearance="secondary" onClick={() => void exportResult("parquet")} disabled={!dataset || running || !sql.trim()}>{t("analysisExportParquet")}</Button>
            <Button appearance="primary" onClick={() => void run()} disabled={!dataset || running || !sql.trim()}>{t("run")}</Button>
          </footer>
        </main>
      </div>
    </section>
  );
}
