import { useCallback, useEffect, useRef, useState } from "react";
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
import { ArrowLeftRegular, CheckmarkRegular, DeleteRegular, EditRegular } from "@fluentui/react-icons";
import type { QueryResult } from "@omni-sql/ts-types";
import type { DatasetRef } from "../lib/analysis";
import { cancelAnalysis, clearAnalysis, dropAnalysisDataset, exportAnalysis, importAnalysisFile, importQuerySource, listAnalysisDatasets, normalizeAnalysisSource, renameAnalysisDataset, runAnalysis } from "../lib/analysis";
import { backend, type RelationInfo } from "../lib/backend";
import { localAnalysisSuggestions } from "../lib/analysis-autocomplete";
import type { EditorProps } from "./Editor";
import { Editor } from "./Editor";
import { pickAnalysisExportPath, pickAnalysisImportPath } from "../lib/file-io";
import { useLanguage } from "../i18n";
import { ResultsGrid } from "./ResultsGrid";
import { DuckDbIcon } from "./DuckDbIcon";

interface AnalysisWorkspaceProps {
  readonly dataset: DatasetRef | null;
  readonly onClose: () => void;
  readonly onDatasetSelected?: (dataset: DatasetRef | null) => void;
  readonly sourceConnections?: readonly { id: string; label: string; dialect: string }[];
  readonly editorTheme?: EditorProps["theme"];
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function AnalysisWorkspace({ dataset, onClose, onDatasetSelected, sourceConnections = [], editorTheme }: AnalysisWorkspaceProps) {
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
    if (!dataset) return;
    if (selectedDatasetIdRef.current !== dataset.id) {
      selectedDatasetIdRef.current = dataset.id;
      setSql(`SELECT * FROM ${quoteIdentifier(dataset.relationName)}`);
      setResult(null);
      setError(null);
    }
    void listAnalysisDatasets(dataset.workspaceId).then(setDatasets).catch(() => setDatasets([dataset]));
  }, [dataset]);

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

  const close = async () => {
    if (dataset) await clearAnalysis(dataset.workspaceId).catch(() => undefined);
    onClose();
  };

  const run = async () => {
    if (!dataset || running) return;
    setRunning(true);
    const nextOperationId = `query-${crypto.randomUUID()}`;
    setOperationId(nextOperationId);
    setError(null);
    try {
      setResult(await runAnalysis(dataset.workspaceId, sql, 1_000, nextOperationId));
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
      await exportAnalysis({ workspaceId: dataset.workspaceId, sql, path, format, operationId: nextOperationId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      setOperationId(null);
    }
  };

  const importFile = async () => {
    if (!dataset || running) return;
    const path = await pickAnalysisImportPath();
    if (!path) return;
    const format = path.toLowerCase().endsWith(".parquet") ? "parquet" : "csv";
    const name = path.split(/[\\/]/).pop()?.replace(/\.(csv|parquet)$/i, "") || "Imported data";
    setRunning(true);
    const nextOperationId = `file-import-${crypto.randomUUID()}`;
    setOperationId(nextOperationId);
    setError(null);
    try {
      await importAnalysisFile({
        workspaceId: dataset.workspaceId,
        name,
        path,
        format,
        operationId: nextOperationId,
        selection: fileSelection === "full" ? { mode: "full" } : fileSelection === "first_n"
          ? { mode: "first_n", rows: fileSampleRows }
          : { mode: "reservoir", rows: fileSampleRows, seed: 42 },
      });
      setDatasets(await listAnalysisDatasets(dataset.workspaceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      setOperationId(null);
    }
  };

  const importSource = async () => {
    if (!dataset || running || !sourceConnectionId || !sourceSql.trim()) return;
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
      await importQuerySource({
        workspaceId: dataset.workspaceId,
        name: source.suggestedName ?? `${sourceConnections.find((item) => item.id === sourceConnectionId)?.label ?? "Source"} query`,
        connectionId: sourceConnectionId,
        sql: source.sql,
        operationId: nextOperationId,
        selection: fileSelection === "full" ? { mode: "full" } : fileSelection === "first_n"
          ? { mode: "first_n", rows: fileSampleRows }
          : { mode: "reservoir", rows: fileSampleRows, seed: 42 },
      });
      setDatasets(await listAnalysisDatasets(dataset.workspaceId));
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

  return (
    <section className="omni-analysis-workspace" aria-label={t("analyzeLocally")}>
      <header className="omni-analysis-header">
        <div className="omni-analysis-title">
          <DuckDbIcon size={30} />
          <div><strong>{t("analyzeLocally")}</strong><Text size={200}>DuckDB</Text></div>
        </div>
        <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => void close()}>{t("analysisBackToSql")}</Button>
      </header>
      <div className="omni-analysis-body">
        <aside className="omni-analysis-datasets">
          <Text weight="semibold">{t("analysisDatasets")}</Text>
          {datasets.map((item) => (
            <div className={`omni-analysis-dataset${item.id === dataset?.id ? " is-active" : ""}`} key={item.id}>
              {renamingDatasetId === item.id ? (
                <>
                  <Input autoFocus value={datasetName} onChange={(_, data) => setDatasetName(data.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameDataset(item); }} aria-label={t("analysisDatasetName")} />
                  <Button appearance="subtle" icon={<CheckmarkRegular />} aria-label={t("analysisSaveDatasetName")} onClick={() => void renameDataset(item)} disabled={!datasetName.trim() || running} />
                </>
              ) : (
                <>
                  <button type="button" className="omni-analysis-dataset-select" onClick={() => onDatasetSelected?.(item)}>
                    <span>{item.name}</span><code>{item.relationName}</code>
                  </button>
                  <Button appearance="subtle" icon={<EditRegular />} aria-label={t("analysisRenameDataset")} onClick={() => { setRenamingDatasetId(item.id); setDatasetName(item.name); }} />
                  <Button appearance="subtle" icon={<DeleteRegular />} aria-label={t("analysisDeleteDataset")} onClick={() => void dropDataset(item)} disabled={running} />
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
            <Combobox freeform value={sourceSql} onChange={(event) => setSourceSql(event.currentTarget.value)} onOptionSelect={(_, data) => { if (data.optionValue) setSourceSql(data.optionValue); }} placeholder={t("analysisSourcePlaceholder")} aria-label={t("analysisSourceSql")}>
              {sourceSuggestions.map((relation) => {
                const value = `${relation.schema}.${relation.name}`;
                return <Option key={value} value={value}>{value}</Option>;
              })}
            </Combobox>
            <Button onClick={() => void importSource()} disabled={running || !sourceConnectionId || !sourceSql.trim()}>{t("analysisImportSource")}</Button>
          </details>
          <div className="omni-analysis-import-controls">
            <select aria-label={t("analysisFileSelection")} value={fileSelection} onChange={(event) => setFileSelection(event.target.value as typeof fileSelection)} disabled={running}>
              <option value="full">{t("analysisFullSnapshot")}</option>
              <option value="first_n">{t("analysisFirstN")}</option>
              <option value="reservoir">{t("analysisReservoir")}</option>
            </select>
            {fileSelection !== "full" && <Input type="number" min={1} max={10_000} value={String(fileSampleRows)} onChange={(_, data) => setFileSampleRows(Math.max(1, Math.min(10_000, Number(data.value) || 1)))} aria-label={t("analysisSampleRows")} />}
            <Button appearance="secondary" onClick={() => void importFile()} disabled={!dataset || running}>{t("analysisImportFile")}</Button>
          </div>
        </aside>
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
