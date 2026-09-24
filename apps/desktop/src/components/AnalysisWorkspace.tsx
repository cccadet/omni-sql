import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Combobox,
  Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  Option,
} from "@fluentui/react-components";
import { ArrowClockwiseRegular, CheckmarkRegular, DeleteRegular, EditRegular, StorageRegular } from "@fluentui/react-icons";
import type { QueryResult } from "@omni-sql/ts-types";
import type { DatasetRef } from "../lib/analysis";
import { cancelAnalysis, dropAnalysisDataset, exportAnalysis, importAnalysisFile, importQuerySource, listAnalysisDatasets, listAnalysisS3, normalizeAnalysisSource, renameAnalysisDataset, runAnalysis, runAnalysisS3 } from "../lib/analysis";
import { detectS3Tables, type S3TableSource } from "../lib/s3-sources";
import { backend, type ConnectionEntry, type RelationInfo } from "../lib/backend";
import { localAnalysisIdentifier, localAnalysisSuggestions } from "../lib/analysis-autocomplete";
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
  readonly initialSource?: { connectionId: string; sql: string } | null;
  readonly initialS3Connection?: ConnectionEntry | null;
  readonly s3Connections?: readonly ConnectionEntry[];
  readonly onSelectS3Connection?: (connectionId: string) => void;
}

interface S3Source {
  name: string;
  uri: string;
  format: S3TableSource["format"];
  region: string;
  endpoint: string;
}

export function AnalysisWorkspace({ workspaceId, dataset, onDatasetSelected, sourceConnections = [], editorTheme, sidebarHost, sidebarIntegrated = false, initialSource, initialS3Connection, s3Connections = [], onSelectS3Connection }: AnalysisWorkspaceProps) {
  const { t } = useLanguage();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<readonly DatasetRef[]>([]);
  const [fileSelection, setFileSelection] = useState<"full" | "first_n" | "reservoir">("full");
  const [fileSampleRows, setFileSampleRows] = useState(1_000);
  const [activeS3Source, setActiveS3Source] = useState<S3Source | null>(null);
  const [s3Prefix, setS3Prefix] = useState("");
  const [s3Tables, setS3Tables] = useState<S3TableSource[]>([]);
  const [s3Limited, setS3Limited] = useState(false);
  const [s3Listing, setS3Listing] = useState(false);
  const [sourceConnectionId, setSourceConnectionId] = useState("");
  const [sourceSql, setSourceSql] = useState("");
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [sourceMetadata, setSourceMetadata] = useState<Record<string, readonly RelationInfo[]>>({});
  const [renamingDatasetId, setRenamingDatasetId] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const selectedDatasetIdRef = useRef<string | null>(null);
  const s3RequestIdRef = useRef(0);

  useEffect(() => {
    if (!initialSource) return;
    setSourceConnectionId(initialSource.connectionId);
    setSourceSql(initialSource.sql);
    setSourceEditorOpen(true);
  }, [initialSource]);

  useEffect(() => {
    s3RequestIdRef.current += 1;
    setS3Listing(false);
    if (!initialS3Connection || initialS3Connection.dialect !== "s3") {
      setActiveS3Source(null);
      return;
    }
    setActiveS3Source(null);
    setS3Prefix("");
    setS3Tables([]);
    setS3Limited(false);
    setSql("");
    setResult(null);
    setError(null);
  }, [initialS3Connection?.id, initialS3Connection?.dialect]);

  const listS3 = async () => {
    if (!initialS3Connection || s3Listing) return;
    const requestId = ++s3RequestIdRef.current;
    setS3Listing(true);
    setError(null);
    try {
      const credentials = await backend.call<{ accessKeyId: string; secretAccessKey?: string }>("connection.s3Credentials", { connectionId: initialS3Connection.id });
      const objects = await listAnalysisS3({ uri: initialS3Connection.endpoint,
        region: String(initialS3Connection.options?.region ?? ""),
        endpoint: String(initialS3Connection.options?.endpoint ?? "") || undefined,
        accessKeyId: credentials.accessKeyId || undefined, secretAccessKey: credentials.secretAccessKey, prefix: s3Prefix });
      if (requestId !== s3RequestIdRef.current) return;
      setS3Tables(detectS3Tables(objects));
      setS3Limited(objects.length >= 500);
    } catch (cause) {
      if (requestId !== s3RequestIdRef.current) return;
      setS3Tables([]);
      setS3Limited(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestId === s3RequestIdRef.current) setS3Listing(false);
    }
  };

  const selectS3Table = (table: S3TableSource) => {
    if (!initialS3Connection) return;
    setActiveS3Source({ ...table, region: String(initialS3Connection.options?.region ?? ""),
      endpoint: String(initialS3Connection.options?.endpoint ?? "") });
    setSql("SELECT * FROM s3_source");
    setResult(null);
    setError(null);
  };

  useEffect(() => {
    if (dataset && !initialS3Connection && selectedDatasetIdRef.current !== dataset.id) {
      selectedDatasetIdRef.current = dataset.id;
      setSql(`SELECT * FROM ${localAnalysisIdentifier(dataset.relationName)}`);
      setResult(null);
      setError(null);
    }
    void listAnalysisDatasets(workspaceId)
      .then((items) => {
        setDatasets(items);
        if (!dataset && !initialS3Connection && items[0]) onDatasetSelected?.(items[0]);
      })
      .catch(() => setDatasets(dataset ? [dataset] : []));
  }, [dataset, initialS3Connection, onDatasetSelected, workspaceId]);

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
    if ((!dataset && !activeS3Source) || running) return;
    setRunning(true);
    const nextOperationId = `query-${crypto.randomUUID()}`;
    setOperationId(nextOperationId);
    setError(null);
    try {
      if (activeS3Source) {
        if (!initialS3Connection) throw new Error("S3 connection not found");
        const credentials = await backend.call<{ accessKeyId: string; secretAccessKey?: string }>("connection.s3Credentials", { connectionId: initialS3Connection.id });
        setResult(await runAnalysisS3({ workspaceId, ...activeS3Source, sql, limit: 1_000, operationId: nextOperationId,
          accessKeyId: credentials.accessKeyId || undefined, secretAccessKey: credentials.secretAccessKey }));
      } else {
        setResult(await runAnalysis(workspaceId, sql, 1_000, nextOperationId));
      }
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
    const format = path.toLowerCase().endsWith(".parquet") ? "parquet" : path.toLowerCase().endsWith(".json") ? "json" : "csv";
    const name = path.split(/[\\/]/).pop()?.replace(/\.(csv|parquet|json)$/i, "") || "Imported data";
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
      setActiveS3Source(null);
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
      setActiveS3Source(null);
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
      setSql((current) => {
        const quoted = `"${item.relationName.replaceAll('"', '""')}"`;
        const next = localAnalysisIdentifier(renamed.relationName);
        const escaped = item.relationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return current.replaceAll(quoted, next).replace(new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, "g"), next);
      });
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

  const datasetPanel = <aside className={`omni-analysis-datasets${initialS3Connection ? " is-s3" : ""}`}>
    {initialS3Connection ? <div className="omni-s3-browser">
      <div className="omni-s3-browser-heading"><StorageRegular fontSize={16} /><span>Fontes S3</span></div>
      <label className="omni-s3-field-label" htmlFor="omni-s3-connection">Conexão</label>
      <select id="omni-s3-connection" aria-label="Conexão S3" className="omni-s3-connection-select" value={initialS3Connection.id}
        onChange={(event) => onSelectS3Connection?.(event.target.value)}>
        {s3Connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
      </select>
      <div className="omni-s3-bucket" title={initialS3Connection.endpoint}>{initialS3Connection.endpoint}</div>
      <div className="omni-s3-browser-search">
        <Input size="small" value={s3Prefix} onChange={(_, data) => setS3Prefix(data.value)} onKeyDown={(event) => { if (event.key === "Enter") void listS3(); }} placeholder="Pasta ou prefixo" aria-label="Prefixo S3" />
        <Button size="small" icon={<ArrowClockwiseRegular />} aria-label="Listar fontes S3" title="Listar fontes S3" onClick={() => void listS3()} disabled={s3Listing} />
      </div>
      <div className="omni-s3-browser-results">
        {s3Listing ? <div className="omni-s3-empty"><Spinner size="tiny" /><span>Buscando fontes…</span></div>
          : s3Tables.length === 0 ? <div className="omni-s3-empty">Explore o bucket para ver CSV, Parquet, Delta e Iceberg.</div>
            : <><div className="omni-s3-results-count">{s3Tables.length} {s3Tables.length === 1 ? "fonte" : "fontes"}</div>
              {s3Tables.map((table) => <button type="button" className={`omni-s3-table${activeS3Source?.uri === table.uri ? " is-active" : ""}`} key={table.uri}
                onClick={() => selectS3Table(table)} aria-label={`Abrir ${table.name}`} title={table.uri}>
                <span className="omni-s3-table-name">{table.name}</span><span className={`omni-s3-format is-${table.format}`}>{table.format}</span>
              </button>)}
            </>}
        {s3Limited && <div className="omni-s3-limit">Limite de 500 objetos. Use um prefixo mais específico.</div>}
      </div>
    </div> : <Text weight="semibold">{t("analysisDatasets")}</Text>}
    {!initialS3Connection && <>
    {datasets.map((item) => (
      <div className={`omni-analysis-dataset${item.id === dataset?.id ? " is-active" : ""}`} key={item.id}>
        {renamingDatasetId === item.id ? (
          <>
            <Input size="small" autoFocus value={datasetName} onChange={(_, data) => setDatasetName(data.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameDataset(item); }} aria-label={t("analysisDatasetName")} />
            <Button size="small" appearance="subtle" icon={<CheckmarkRegular />} aria-label={t("analysisSaveDatasetName")} onClick={() => void renameDataset(item)} disabled={!datasetName.trim() || running} />
          </>
        ) : (
          <>
            <button type="button" className="omni-analysis-dataset-select" onClick={() => { setActiveS3Source(null); onDatasetSelected?.(item); }}>
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
        {sourceConnections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <Combobox size="small" freeform value={sourceSql} onChange={(event) => setSourceSql(event.currentTarget.value)} onOptionSelect={(_, data) => { if (data.optionValue) setSourceSql(data.optionValue); }} placeholder={t("analysisSourcePlaceholder")} aria-label={t("analysisSourceSql")}>
        {sourceSuggestions.map((relation) => {
          const value = `${relation.schema}.${relation.name}`;
          return <Option key={value} value={value}>{value}</Option>;
        })}
      </Combobox>
      <Button size="small" appearance="secondary" onClick={() => setSourceEditorOpen(true)}>{t("analysisExpandSourceSql")}</Button>
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
    </>}
  </aside>;

  return (
    <section className={`omni-analysis-workspace${sidebarIntegrated ? " has-sidebar-portal" : ""}`} aria-label={t("analyzeLocally")}>
      <Dialog open={sourceEditorOpen} onOpenChange={(_, data) => setSourceEditorOpen(data.open)}>
        <DialogSurface className="omni-standard-dialog" style={{ width: "min(850px, 90vw)", maxWidth: "90vw" }}>
          <DialogBody className="omni-dialog-body">
            <DialogTitle>{t("analysisSourceSql")}</DialogTitle>
            <DialogContent>
              <textarea className="omni-analysis-source-sql-editor" value={sourceSql} onChange={(event) => setSourceSql(event.target.value)} aria-label={t("analysisSourceSql")} spellCheck={false} autoFocus />
            </DialogContent>
            <DialogActions className="omni-dialog-actions">
              <Button appearance="primary" onClick={() => setSourceEditorOpen(false)}>{t("analysisDoneEditing")}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      {sidebarHost && createPortal(datasetPanel, sidebarHost)}
      <div className="omni-analysis-body">
        {!sidebarIntegrated && datasetPanel}
        <main className="omni-analysis-main">
            {dataset && !activeS3Source && dataset.coverage !== "complete" && (
              <MessageBar intent="warning"><MessageBarBody>{dataset.coverage === "sampled" ? t("analysisSampledSnapshot") : t("analysisPartialSnapshot")}</MessageBarBody></MessageBar>
            )}
            {activeS3Source && <Text size={200}>Consulta S3 direta: {activeS3Source.uri} · SQL: s3_source</Text>}
            {dataset && !activeS3Source && (
              <Text size={200}>
                {dataset.rowCount} {t("rows")} · {dataset.scannedRows} {t("analysisRowsScanned")} · SQL: {localAnalysisIdentifier(dataset.relationName)}
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
            <Button appearance="secondary" onClick={() => void exportResult("csv")} disabled={!dataset || !!activeS3Source || running || !sql.trim()}>{t("analysisExportCsv")}</Button>
            <Button appearance="secondary" onClick={() => void exportResult("parquet")} disabled={!dataset || !!activeS3Source || running || !sql.trim()}>{t("analysisExportParquet")}</Button>
            <Button appearance="primary" onClick={() => void run()} disabled={(!dataset && !activeS3Source) || running || !sql.trim()}>{t("run")}</Button>
          </footer>
        </main>
      </div>
    </section>
  );
}
