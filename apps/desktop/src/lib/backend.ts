import type { ConnectionConfig, QueryResult, Database } from "@omni-sql/ts-types";
import type { Suggestion } from "@omni-sql/autocomplete-engine";

export interface ConnectionEntry {
  id: string;
  label: string;
  dialect: ConnectionConfig["dialect"];
  endpoint: string;
  user: string;
}

type AnyParams = Record<string, unknown> | undefined;

interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

const BACKEND_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BACKEND_URL ??
  "http://127.0.0.1:41920/rpc";

let counter = 0;

export const backend = {
  async call<T = unknown>(method: string, params: AnyParams): Promise<T> {
    const id = ++counter;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    });
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const rpc = (await res.json()) as RpcResponse<T>;
    if (rpc.error) {
      const err = new Error(rpc.error.message);
      (err as Error & { code?: number }).code = rpc.error.code;
      throw err;
    }
    return rpc.result as T;
  },
};

// Typed wrappers (referência; UI chama diretamente via `backend.call`).
export type BackendHandlers = {
  "connection.add": (p: { config: ConnectionConfig }) => Promise<{ connectionId: string; ok: boolean }>;
  "connection.list": () => Promise<{ configs: ConnectionEntry[] }>;
  "query.run": (p: { connectionId: string; sql: string; limit?: number }) => Promise<QueryResult>;
  "metadata.introspect": (p: { connectionId: string }) => Promise<Database>;
  "completion.get": (p: { connectionId: string; sql: string; cursor: number }) => Promise<{ suggestions: Suggestion[] }>;
};