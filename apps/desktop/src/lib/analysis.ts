import { invoke } from "@tauri-apps/api/core";
import type { QueryResult } from "@omni-sql/ts-types";

export interface DatasetColumn {
  readonly name: string;
  readonly originalName: string;
  readonly dataType: string;
  readonly sourceDataType: string;
  readonly nullable: boolean;
}

export interface DatasetRef {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly relationName: string;
  readonly columns: readonly DatasetColumn[];
  readonly rowCount: number;
  readonly approximateBytes: number;
  readonly createdAtMs: number;
  readonly coverage: "complete" | "sampled" | "truncated";
  readonly selection: { mode: "full" } | { mode: "first_n"; rows: number } | { mode: "reservoir"; rows: number; seed: number };
  readonly retainedTarget?: number;
  readonly scannedRows: number;
  readonly sourceTotal?: number;
  readonly sourceConnectionId?: string;
  readonly sourceSql?: string;
}

export interface AnalysisOperationStatus {
  readonly operationId: string;
  readonly state: "running" | "cancelling" | "succeeded" | "cancelled" | "failed";
  readonly scannedRows: number;
  readonly retainedRows: number;
  readonly processedBytes: number;
  readonly startedAtMs: number;
  readonly finishedAtMs?: number;
}

export interface AnalysisResultHandle {
  readonly id: string;
  readonly workspaceId: string;
  readonly columns: QueryResult["columns"];
  readonly rowCount: number;
  readonly createdAtMs: number;
}

export interface NormalizedAnalysisSource {
  readonly sql: string;
  readonly suggestedName?: string;
}

function parseRelationPath(value: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '"') {
      current += character;
      if (quoted && value[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "." && !quoted) {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current.trim());
  if (quoted || parts.length > 3 || parts.some((part) => !part)) return null;

  const identifiers = parts.map((part) => {
    if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(part)) return part;
    if (/^"(?:[^"]|"")+"$/.test(part)) return part.slice(1, -1).replaceAll('""', '"');
    return null;
  });
  return identifiers.every((part): part is string => part !== null) ? identifiers : null;
}

function quoteSourceIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Accepts a PostgreSQL SELECT/WITH query or a one-to-three-part relation name. */
export function normalizeAnalysisSource(value: string): NormalizedAnalysisSource | null {
  const trimmed = value.trim();
  if (/^(?:select|with)\b/i.test(trimmed)) return { sql: trimmed };

  const relationParts = parseRelationPath(trimmed);
  if (!relationParts) return null;
  return {
    sql: `SELECT * FROM ${relationParts.map(quoteSourceIdentifier).join(".")}`,
    suggestedName: relationParts.at(-1),
  };
}

function transportValue(value: unknown): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(transportValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, transportValue(nested)]));
  }
  throw new Error(`Unsupported analytical value: ${typeof value}`);
}

export async function importQueryResult(input: {
  workspaceId: string;
  name: string;
  result: QueryResult;
  sourceConnectionId?: string;
  sourceSql?: string;
  selection?:
    | { mode: "full" }
    | { mode: "first_n"; rows: number }
    | { mode: "reservoir"; rows: number; seed: number };
}): Promise<DatasetRef> {
  return invoke<DatasetRef>("analysis_import_result", {
    request: {
      operationId: `import-${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      name: input.name,
      columns: input.result.columns,
      rows: input.result.rows.map((row) => row.map(transportValue)),
      rowsMoreAvailable: input.result.rowsMoreAvailable,
      sourceConnectionId: input.sourceConnectionId,
      sourceSql: input.sourceSql,
      selection: input.selection ?? { mode: "full" },
    },
  });
}

export async function importQuerySource(input: {
  workspaceId: string;
  name: string;
  connectionId: string;
  sql: string;
  operationId?: string;
  selection:
    | { mode: "full" }
    | { mode: "first_n"; rows: number }
    | { mode: "reservoir"; rows: number; seed: number };
  batchSize?: number;
}): Promise<DatasetRef> {
  return invoke<DatasetRef>("analysis_import_source", {
    request: {
      operationId: input.operationId ?? `import-${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      name: input.name,
      connectionId: input.connectionId,
      sql: input.sql,
      selection: input.selection,
      batchSize: input.batchSize ?? 1_000,
    },
  });
}

export async function runAnalysis(workspaceId: string, sql: string, limit = 1_000, operationId = `query-${crypto.randomUUID()}`): Promise<QueryResult> {
  const result = await invoke<Omit<QueryResult, "elapsedMs">>("analysis_query", {
    request: { operationId, workspaceId, sql, limit },
  });
  return { ...result, elapsedMs: 0 };
}

export async function startStableAnalysis(workspaceId: string, sql: string, operationId = `query-start-${crypto.randomUUID()}`): Promise<AnalysisResultHandle> {
  return invoke<AnalysisResultHandle>("analysis_query_start", { request: { operationId, workspaceId, sql } });
}

export async function readStableAnalysisPage(workspaceId: string, handleId: string, offset: number, limit = 1_000, operationId = `query-page-${crypto.randomUUID()}`): Promise<QueryResult> {
  const result = await invoke<Omit<QueryResult, "elapsedMs">>("analysis_query_page", { request: { operationId, workspaceId, handleId, offset, limit } });
  return { ...result, elapsedMs: 0 };
}

export async function dropStableAnalysis(workspaceId: string, handleId: string): Promise<boolean> {
  return invoke<boolean>("analysis_query_drop", { workspaceId, handleId });
}

export async function cancelAnalysis(operationId: string): Promise<boolean> {
  return invoke<boolean>("analysis_cancel", { operationId });
}

export async function getAnalysisOperationStatus(operationId: string): Promise<AnalysisOperationStatus | null> {
  return invoke<AnalysisOperationStatus | null>("analysis_operation_status", { operationId });
}

export async function exportAnalysis(input: {
  workspaceId: string;
  sql: string;
  path: string;
  format: "csv" | "parquet" | "arrow_ipc";
  operationId?: string;
}): Promise<{ path: string; rows: number; bytes: number }> {
  return invoke("analysis_export_query", {
    request: {
      operationId: input.operationId ?? `export-${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      sql: input.sql,
      path: input.path,
      format: input.format,
    },
  });
}

export async function importAnalysisFile(input: {
  workspaceId: string;
  name: string;
  path: string;
  format: "csv" | "parquet";
  selection:
    | { mode: "full" }
    | { mode: "first_n"; rows: number }
    | { mode: "reservoir"; rows: number; seed: number };
  operationId?: string;
}): Promise<DatasetRef> {
  return invoke<DatasetRef>("analysis_import_file", {
    request: {
      operationId: input.operationId ?? `file-import-${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      name: input.name,
      path: input.path,
      format: input.format,
      selection: input.selection,
    },
  });
}

export async function listAnalysisDatasets(workspaceId: string): Promise<readonly DatasetRef[]> {
  return invoke<DatasetRef[]>("analysis_list_datasets", { workspaceId });
}

export async function renameAnalysisDataset(workspaceId: string, datasetId: string, name: string): Promise<DatasetRef> {
  return invoke<DatasetRef>("analysis_rename_dataset", { workspaceId, datasetId, name });
}

export async function dropAnalysisDataset(workspaceId: string, datasetId: string): Promise<boolean> {
  return invoke<boolean>("analysis_drop_dataset", { workspaceId, datasetId });
}

export async function clearAnalysis(workspaceId: string): Promise<number> {
  return invoke<number>("analysis_clear", { workspaceId });
}
