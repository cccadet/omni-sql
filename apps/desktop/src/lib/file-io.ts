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
