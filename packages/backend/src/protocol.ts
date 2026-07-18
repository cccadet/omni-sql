import type {
  ConnectionConfig,
  QueryResult,
  Database,
  RowEditability,
  FunctionDef,
  IndexInfo,
  ObjectDefinitionKind,
  ExplainResult,
  SqlDiagnostic,
} from "@omni-sql/ts-types";
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

export type RpcMethod = keyof RpcRouter;

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

export interface CancelQueryParams {
  connectionId: string;
}
export interface CancelQueryResult {
  cancelled: boolean;
}

export interface ExplainQueryParams {
  connectionId: string;
  sql: string;
}
export type ExplainQueryResult = ExplainResult;

export interface DiagnoseQueryParams {
  connectionId: string;
  sql: string;
}
export interface DiagnoseQueryResult {
  diagnostics: readonly SqlDiagnostic[];
}

export interface AnalyzeEditabilityParams {
  connectionId: string;
  sql: string;
}
export type AnalyzeEditabilityResult = RowEditability;

export interface UpdateRowParams {
  connectionId: string;
  table: { schema: string; name: string };
  /** Coluna → novo valor. */
  set: Record<string, unknown>;
  /** Coluna de PK → valor original — deve cobrir exatamente a PK da tabela. */
  where: Record<string, unknown>;
}
export interface UpdateRowResult {
  rowsAffected: number;
}

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
      foreignKeyTo?: { schema: string; table: string; column: string };
    }>;
  }>;
}

export interface ListSchemasParams {
  config: ConnectionConfig;
  password?: string;
}
export interface ListSchemasResult {
  schemas: readonly string[];
}

export interface ListFunctionsParams {
  connectionId: string;
  schema?: string;
}
export interface ListFunctionsResult {
  functions: readonly FunctionDef[];
}

export interface ListIndexesParams {
  connectionId: string;
  schema: string;
  table: string;
}
export interface ListIndexesResult {
  indexes: readonly IndexInfo[];
}

export interface GetDefinitionParams {
  connectionId: string;
  kind: ObjectDefinitionKind;
  schema: string;
  name: string;
}
export interface GetDefinitionResult {
  sql: string;
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
  "connection.listSchemas": (p: ListSchemasParams) => Promise<ListSchemasResult>;
  "query.run": (p: RunQueryParams) => Promise<RunQueryResult>;
  "query.cancel": (p: CancelQueryParams) => Promise<CancelQueryResult>;
  "query.explain": (p: ExplainQueryParams) => Promise<ExplainQueryResult>;
  "query.diagnose": (p: DiagnoseQueryParams) => Promise<DiagnoseQueryResult>;
  "query.analyzeEditability": (p: AnalyzeEditabilityParams) => Promise<AnalyzeEditabilityResult>;
  "row.update": (p: UpdateRowParams) => Promise<UpdateRowResult>;
  "metadata.introspect": (p: IntrospectParams) => Promise<IntrospectResult>;
  "metadata.listRelations": (p: ListRelationsParams) => Promise<ListRelationsResult>;
  "metadata.listFunctions": (p: ListFunctionsParams) => Promise<ListFunctionsResult>;
  "metadata.listIndexes": (p: ListIndexesParams) => Promise<ListIndexesResult>;
  "metadata.getDefinition": (p: GetDefinitionParams) => Promise<GetDefinitionResult>;
  "completion.get": (p: CompletionParams) => Promise<CompletionResult>;
}

export type RpcHandler<K extends keyof RpcRouter> = RpcRouter[K];
