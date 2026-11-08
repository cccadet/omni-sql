import { useSyncExternalStore } from "react";

export const ENVIRONMENTS_KEY = "omni-sql:environments";

export const ENVIRONMENT_COLORS = ["green", "yellow", "orange", "red", "berry", "purple", "blue", "teal", "gray"] as const;
export type EnvironmentColor = (typeof ENVIRONMENT_COLORS)[number];

/** Built-in ids are stable so imports (e.g. DBeaver dev/test/prod) and existing connections keep resolving. */
export const BUILT_IN_ENVIRONMENT_IDS = ["development", "staging", "production"] as const;
export type BuiltInEnvironmentId = (typeof BUILT_IN_ENVIRONMENT_IDS)[number];

export interface EnvironmentDefinition {
  id: string;
  /** Custom name; absent on a built-in environment means "use the translated default name". */
  name?: string;
  color: EnvironmentColor;
}

export const DEFAULT_ENVIRONMENTS: readonly EnvironmentDefinition[] = [
  { id: "development", color: "green" },
  { id: "staging", color: "yellow" },
  { id: "production", color: "red" },
];

const MAX_ENVIRONMENTS = 50;
const MAX_NAME_LENGTH = 60;

export function isBuiltInEnvironmentId(id: string): id is BuiltInEnvironmentId {
  return (BUILT_IN_ENVIRONMENT_IDS as readonly string[]).includes(id);
}

function isColor(value: unknown): value is EnvironmentColor {
  return typeof value === "string" && (ENVIRONMENT_COLORS as readonly string[]).includes(value);
}

/** Validates stored data; anything malformed falls back to the defaults rather than breaking the UI. */
export function parseEnvironments(raw: string | null): EnvironmentDefinition[] {
  if (raw === null) return [...DEFAULT_ENVIRONMENTS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_ENVIRONMENTS];
    const seen = new Set<string>();
    const result: EnvironmentDefinition[] = [];
    for (const item of parsed.slice(0, MAX_ENVIRONMENTS)) {
      if (!item || typeof item !== "object") continue;
      const { id, name, color } = item as Record<string, unknown>;
      if (typeof id !== "string" || !id || seen.has(id) || !isColor(color)) continue;
      const trimmed = typeof name === "string" ? name.trim().slice(0, MAX_NAME_LENGTH) : "";
      if (!trimmed && !isBuiltInEnvironmentId(id)) continue;
      seen.add(id);
      result.push(trimmed ? { id, name: trimmed, color } : { id, color });
    }
    return result;
  } catch {
    return [...DEFAULT_ENVIRONMENTS];
  }
}

function readStored(): EnvironmentDefinition[] {
  try {
    return parseEnvironments(localStorage.getItem(ENVIRONMENTS_KEY));
  } catch {
    return [...DEFAULT_ENVIRONMENTS];
  }
}

let current: EnvironmentDefinition[] | null = null;
const listeners = new Set<() => void>();

function snapshot(): EnvironmentDefinition[] {
  current ??= readStored();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== ENVIRONMENTS_KEY) return;
    current = readStored();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveEnvironments(next: readonly EnvironmentDefinition[]) {
  current = parseEnvironments(JSON.stringify(next));
  try {
    localStorage.setItem(ENVIRONMENTS_KEY, JSON.stringify(current));
  } catch {
    // localStorage unavailable: changes only last for this session.
  }
  for (const listener of listeners) listener();
}

/** Test helper: forget the cached list so the next read comes from localStorage again. */
export function resetEnvironmentsCache() {
  current = null;
}

export function useEnvironments(): readonly EnvironmentDefinition[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function newEnvironmentId(): string {
  return `env-${crypto.randomUUID()}`;
}
