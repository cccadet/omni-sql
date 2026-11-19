import { invoke } from "@tauri-apps/api/core";

/** Mirrors the engine default and bounds in data_engine.rs. */
export const DEFAULT_ANALYSIS_MEMORY_LIMIT_MB = 512;
export const ANALYSIS_MEMORY_LIMIT_OPTIONS_MB = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768] as const;

const MEMORY_LIMIT_KEY = "omni-sql:analysisMemoryLimitMb";

export function formatMemoryLimit(memoryLimitMb: number): string {
  return memoryLimitMb >= 1024 && memoryLimitMb % 1024 === 0 ? `${memoryLimitMb / 1024} GB` : `${memoryLimitMb} MB`;
}

export function loadAnalysisMemoryLimit(): number {
  try {
    const stored = Number(localStorage.getItem(MEMORY_LIMIT_KEY));
    return (ANALYSIS_MEMORY_LIMIT_OPTIONS_MB as readonly number[]).includes(stored) ? stored : DEFAULT_ANALYSIS_MEMORY_LIMIT_MB;
  } catch {
    return DEFAULT_ANALYSIS_MEMORY_LIMIT_MB;
  }
}

export function saveAnalysisMemoryLimit(memoryLimitMb: number): void {
  try {
    localStorage.setItem(MEMORY_LIMIT_KEY, String(memoryLimitMb));
  } catch {
    // localStorage indisponível/cheio — a configuração só não persiste.
  }
}

/** Applies the limit to the DuckDB engine; resolves with the value the engine now uses. */
export async function applyAnalysisMemoryLimit(memoryLimitMb: number): Promise<number> {
  return invoke<number>("analysis_set_memory_limit", { memoryLimitMb });
}
