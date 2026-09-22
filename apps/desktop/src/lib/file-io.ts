import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

const FILTERS = [{ name: "SQL", extensions: ["sql"] }];
const JAR_FILTERS = [{ name: "JAR", extensions: ["jar"] }];

export function basenameNoExt(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.sql$/i, "");
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  return (await save({ filters: FILTERS, defaultPath: `${defaultName}.sql` })) ?? null;
}

export async function writeSqlFile(path: string, contents: string): Promise<void> {
  await invoke("write_text_file", { path, contents });
}

export async function exportCsvFile(contents: string): Promise<string | null> {
  return invoke<string | null>("write_csv_file", { contents });
}

export async function openExportedFile(path: string): Promise<void> {
  await invoke("open_csv_file", { path });
}

export async function revealExportedFile(path: string): Promise<void> {
  await invoke("reveal_csv_file", { path });
}

export async function pickOpenPath(): Promise<string | null> {
  const result = await openDialog({ filters: FILTERS, multiple: false });
  return typeof result === "string" ? result : null;
}

export async function readSqlFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export async function pickJarPath(): Promise<string | null> {
  const result = await openDialog({ filters: JAR_FILTERS, multiple: false });
  return typeof result === "string" ? result : null;
}

export async function pickAnalysisExportPath(defaultName: string, format: "csv" | "parquet" | "arrow"): Promise<string | null> {
  const labels = { csv: "CSV", parquet: "Parquet", arrow: "Arrow IPC" } as const;
  return (await save({
    filters: [{ name: labels[format], extensions: [format] }],
    defaultPath: `${defaultName}.${format}`,
  })) ?? null;
}

export async function pickAnalysisImportPath(): Promise<string | null> {
  const result = await openDialog({
    filters: [{ name: "Analytical data", extensions: ["csv", "parquet"] }],
    multiple: false,
  });
  return typeof result === "string" ? result : null;
}
