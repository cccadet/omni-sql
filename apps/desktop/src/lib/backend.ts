import type {
  ConnectionConfig,
  IndexInfo,
  ObjectDefinitionKind,
} from "@omni-sql/ts-types";
import { invoke } from "@tauri-apps/api/core";
export type { SqlDiagnostic } from "@omni-sql/ts-types";

export interface ConnectionEntry {
  id: string;
  label: string;
  dialect: ConnectionConfig["dialect"];
  endpoint: string;
  user: string;
  options?: Record<string, string | number | boolean>;
  schemas?: string[];
  lastSyncedAt?: number;
}

export interface RelationColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  foreignKeyTo?: ColumnRef;
}

export interface RelationInfo {
  schema: string;
  name: string;
  kind: "table" | "view";
  columns: RelationColumn[];
}

export interface ColumnRef {
  schema: string;
  table: string;
  column: string;
}

type AnyParams = Record<string, unknown> | undefined;

interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

const VITE_ENV = (import.meta as unknown as { env?: Record<string, string | boolean> }).env;
const DEFAULT_BACKEND_URL = "http://127.0.0.1:41920/rpc";

function resolveBackendUrl(): string {
  const configuredUrl = VITE_ENV?.VITE_BACKEND_URL?.toString();
  const url = configuredUrl || DEFAULT_BACKEND_URL;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid backend URL: ${url}`);
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`Invalid backend URL protocol: ${parsed.protocol}`);
  }

  const isRelease = VITE_ENV?.PROD === true || VITE_ENV?.PROD === "true";
  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "[::1]";
  if (isRelease && !isLoopback) {
    throw new Error("Release builds may only use a loopback backend URL");
  }

  return parsed.toString();
}

const BACKEND_URL = resolveBackendUrl();

// The desktop shell owns this value and generates a new one for every run. In
// the Vite browser preview there is no Tauri bridge, so retain the existing
// dev workflow with a non-production fallback. Production fails closed if the
// shell cannot provide its token.
const DEV_AUTH_TOKEN = "dev-token";
let authTokenPromise: Promise<string | undefined> | undefined;

async function getAuthToken(): Promise<string | undefined> {
  authTokenPromise ??= invoke<string>("get_auth_token").then((token) => {
    if (!token.trim()) throw new Error("Tauri returned an empty backend token");
    return token;
  }).catch((error: unknown) => {
    if (VITE_ENV?.DEV === true || VITE_ENV?.DEV === "true") {
      return VITE_ENV.VITE_BACKEND_AUTH_TOKEN?.toString() || DEV_AUTH_TOKEN;
    }
    throw error;
  });
  return authTokenPromise;
}

let counter = 0;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 4,
  delayMs = 250,
): Promise<Response> {
  let lastErr: Error | undefined;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, init);
      return res;
    } catch (e) {
      lastErr = e as Error;
      if (i < retries) {
        await sleep(delayMs * (i + 1));
      }
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

export const backend = {
  async call<T = unknown>(method: string, params: AnyParams): Promise<T> {
    const id = ++counter;
    const authToken = await getAuthToken();
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    });
    const res = await fetchWithRetry(BACKEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Backend request failed: ${res.status} ${res.statusText}`.trim());
    }

    let rpc: RpcResponse<T>;
    try {
      rpc = (await res.json()) as RpcResponse<T>;
    } catch {
      throw new Error("Backend returned an invalid JSON body");
    }

    const hasResult = rpc !== null && typeof rpc === "object" &&
      Object.prototype.hasOwnProperty.call(rpc, "result");
    const hasError = rpc !== null && typeof rpc === "object" &&
      Object.prototype.hasOwnProperty.call(rpc, "error");
    if (
      rpc === null ||
      typeof rpc !== "object" ||
      rpc.jsonrpc !== "2.0" ||
      (typeof rpc.id !== "string" && typeof rpc.id !== "number" && rpc.id !== null) ||
      hasResult === hasError
    ) {
      throw new Error("Backend returned an invalid JSON-RPC body");
    }

    if (hasError) {
      if (
        rpc.error === null ||
        typeof rpc.error !== "object" ||
        typeof rpc.error.code !== "number" ||
        typeof rpc.error.message !== "string"
      ) {
        throw new Error("Backend returned an invalid JSON-RPC error");
      }
      const err = new Error(rpc.error.message);
      (err as Error & { code?: number }).code = rpc.error.code;
      throw err;
    }
    return rpc.result as T;
  },
};

export type { IndexInfo, ObjectDefinitionKind };
