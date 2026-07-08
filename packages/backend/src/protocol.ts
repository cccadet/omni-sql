import type { ConnectionConfig, QueryResult, Database } from "@omni-sql/ts-types";
import type { Suggestion } from "@omni-sql/autocomplete-engine";

// ─────────────────────────── JSON-RPC envelope

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: P;
}

export interface JsonRpcResponse<R = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: R;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ─────────────────────────── Methods (typed contracts)

export type RpcMethod =
  | "connection.add"
  | "connection.list"
  | "connection.remove"
  | "connection.test"
  | "query.run"
  | "metadata.introspect"
  | "metadata.listRelations"
  | "completion.get";

// ─────────────────────────── Params/Results

export interface AddConnectionParams {
  config: ConnectionConfig;
  password?: string;
}
export interface AddConnectionResult {
  connectionId: string;
  ok: boolean;
}

export interface ListConnectionsResult {
  configs: ReadonlyArray<
    Omit<ConnectionConfig, "passwordSlot"> & { lastSyncedAt?: number }
  >;
}

export interface TestConnectionParams {
  config: ConnectionConfig;
  password?: string;
}
export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  message?: string;
}

export interface RunQueryParams {
  connectionId: string;
  sql: string;
  limit?: number;
}
export type RunQueryResult = QueryResult;

export interface IntrospectParams {
  connectionId: string;
}
export type IntrospectResult = Database;

export interface ListRelationsParams {
  connectionId: string;
  schema?: string;
}
export interface ListRelationsResult {
  relations: ReadonlyArray<{
    schema: string;
    name: string;
    kind: "table" | "view";
    columns: ReadonlyArray<{
      name: string;
      dataType: string;
      nullable: boolean;
      isPrimaryKey: boolean;
    }>;
  }>;
}

export interface CompletionParams {
  connectionId: string;
  sql: string;
  cursor: number;
}
export interface CompletionResult {
  suggestions: readonly Suggestion[];
}

// ─────────────────────────── Routing table

export interface RpcRouter {
  "connection.add": (p: AddConnectionParams) => Promise<AddConnectionResult>;
  "connection.list": () => Promise<ListConnectionsResult>;
  "connection.remove": (p: { connectionId: string }) => Promise<{ ok: boolean }>;
  "connection.test": (p: TestConnectionParams) => Promise<TestConnectionResult>;
  "query.run": (p: RunQueryParams) => Promise<RunQueryResult>;
  "metadata.introspect": (p: IntrospectParams) => Promise<IntrospectResult>;
  "metadata.listRelations": (p: ListRelationsParams) => Promise<ListRelationsResult>;
  "completion.get": (p: CompletionParams) => Promise<CompletionResult>;
}

export type RpcHandler<K extends keyof RpcRouter> = RpcRouter[K];