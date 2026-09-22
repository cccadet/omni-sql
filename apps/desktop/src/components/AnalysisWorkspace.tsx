import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  Textarea,
} from "@fluentui/react-components";
import type { QueryResult } from "@omni-sql/ts-types";
import type { DatasetRef } from "../lib/analysis";
import { cancelAnalysis, clearAnalysis, exportAnalysis, importAnalysisFile, importQuerySource, listAnalysisDatasets, runAnalysis } from "../lib/analysis";
import { pickAnalysisExportPath, pickAnalysisImportPath } from "../lib/file-io";
import { useLanguage } from "../i18n";
import { ResultsGrid } from "./ResultsGrid";

interface AnalysisWorkspaceProps {
  readonly dataset: DatasetRef | null;
  readonly onClose: () => void;
  readonly onDatasetAdded?: (dataset: DatasetRef) => void;
  readonly sourceConnections?: readonly { id: string; label: string; dialect: string }[];
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function AnalysisWorkspace({ dataset, onClose, onDatasetAdded, sourceConnections = [] }: AnalysisWorkspaceProps) {
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

  useEffect(() => {
    if (!dataset) return;
    setSql(`SELECT * FROM ${quoteIdentifier(dataset.relationName)}`);
    setResult(null);
    setError(null);
    void listAnalysisDatasets(dataset.workspaceId).then(setDatasets).catch(() => setDatasets([dataset]));
  }, [dataset]);

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
      const imported = await importAnalysisFile({
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
      onDatasetAdded?.(imported);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      setOperationId(null);
    }
  };

  const importSource = async () => {
    if (!dataset || running || !sourceConnectionId || !sourceSql.trim()) return;
    setRunning(true);
    const nextOperationId = `source-import-${crypto.randomUUID()}`;
    setOperationId(nextOperationId);
    setError(null);
    try {
      const imported = await importQuerySource({
        workspaceId: dataset.workspaceId,
        name: sourceConnections.find((item) => item.id === sourceConnectionId)?.label ?? "Source dataset",
        connectionId: sourceConnectionId,
        sql: sourceSql,
        operationId: nextOperationId,
        selection: fileSelection === "full" ? { mode: "full" } : fileSelection === "first_n"
          ? { mode: "first_n", rows: fileSampleRows }
          : { mode: "reservoir", rows: fileSampleRows, seed: 42 },
      });
      setDatasets(await listAnalysisDatasets(dataset.workspaceId));
      onDatasetAdded?.(imported);
      setSourceSql("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      setOperationId(null);
    }
  };

  return (
    <Dialog open={dataset !== null} onOpenChange={(_, data) => { if (!data.open) void close(); }}>
      <DialogSurface style={{ width: "min(1100px, 92vw)", maxWidth: "none", height: "min(780px, 90vh)" }}>
        <DialogBody style={{ height: "100%" }}>
          <DialogTitle>{t("analyzeLocally")}: {dataset?.name}</DialogTitle>
          <DialogContent style={{ display: "flex", minHeight: 0, flexDirection: "column", gap: 10 }}>
            {dataset && dataset.coverage !== "complete" && (
              <MessageBar intent="warning"><MessageBarBody>{dataset.coverage === "sampled" ? t("analysisSampledSnapshot") : t("analysisPartialSnapshot")}</MessageBarBody></MessageBar>
            )}
            {dataset && (
              <Text size={200}>
                {dataset.rowCount} {t("rows")} · {dataset.scannedRows} {t("analysisRowsScanned")} · SQL: {quoteIdentifier(dataset.relationName)}
              </Text>
            )}
            {datasets.length > 0 && (
              <Text size={200}>{datasets.map((item) => `${item.name}: ${quoteIdentifier(item.relationName)}`).join(" · ")}</Text>
            )}
            <details>
              <summary>{t("analysisAddSource")}</summary>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <select aria-label={t("activeConnection")} value={sourceConnectionId} onChange={(event) => setSourceConnectionId(event.target.value)}>
                  <option value="">{t("headerNoConnection")}</option>
                  {sourceConnections.filter((item) => item.dialect === "postgres").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <Input value={sourceSql} onChange={(_, data) => setSourceSql(data.value)} placeholder="SELECT …" aria-label={t("analysisSourceSql")} style={{ flex: 1 }} />
                <Button onClick={() => void importSource()} disabled={running || !sourceConnectionId || !sourceSql.trim()}>{t("analysisImportSource")}</Button>
              </div>
            </details>
            <Textarea
              aria-label={t("analysisSql")}
              resize="vertical"
              value={sql}
              onChange={(_, data) => setSql(data.value)}
              style={{ minHeight: 90, fontFamily: "monospace" }}
            />
            {running && <Spinner size="small" label={t("running")} />}
            <div style={{ flex: 1, minHeight: 260 }}>
              <ResultsGrid result={result} error={error} running={running} />
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => void close()}>{t("close")}</Button>
            {running && operationId && (
              <Button appearance="secondary" onClick={() => void cancelAnalysis(operationId)}>{t("stop")}</Button>
            )}
            <Button appearance="secondary" onClick={() => void exportResult("csv")} disabled={!dataset || running || !sql.trim()}>{t("analysisExportCsv")}</Button>
            <Button appearance="secondary" onClick={() => void exportResult("parquet")} disabled={!dataset || running || !sql.trim()}>{t("analysisExportParquet")}</Button>
            <select aria-label={t("analysisFileSelection")} value={fileSelection} onChange={(event) => setFileSelection(event.target.value as typeof fileSelection)} disabled={running}>
              <option value="full">{t("analysisFullSnapshot")}</option>
              <option value="first_n">{t("analysisFirstN")}</option>
              <option value="reservoir">{t("analysisReservoir")}</option>
            </select>
            {fileSelection !== "full" && <Input type="number" min={1} max={10_000} value={String(fileSampleRows)} onChange={(_, data) => setFileSampleRows(Math.max(1, Math.min(10_000, Number(data.value) || 1)))} aria-label={t("analysisSampleRows")} style={{ width: 90 }} />}
            <Button appearance="secondary" onClick={() => void importFile()} disabled={!dataset || running}>{t("analysisImportFile")}</Button>
            <Button appearance="primary" onClick={() => void run()} disabled={!dataset || running || !sql.trim()}>{t("run")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
