import type {
  ConnectionConfig,
  ConnectionGroup,
  QueryResult,
  Database,
  RowEditability,
  FunctionDef,
  IndexInfo,
  ObjectDefinitionKind,
  ExplainResult,
  SqlDiagnostic,
  McpStatusResult,
  McpHistoryResult,
  McpUiNextParams,
  McpUiNextResult,
  McpUiRespondParams,
  McpUiRespondResult,
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
    Omit<ConnectionConfig, "passwordSlot" | "groupId"> & {
      groupId: string | null;
      lastSyncedAt?: number;
    }
  >;
}

export interface ListConnectionGroupsResult {
  groups: ReadonlyArray<ConnectionGroup>;
}

export interface CreateConnectionGroupParams {
  name: string;
}
export interface CreateConnectionGroupResult {
  group: ConnectionGroup;
}

export interface RenameConnectionGroupParams {
  groupId: string;
  name: string;
}
export interface RenameConnectionGroupResult {
  group: ConnectionGroup;
}

export interface DeleteConnectionGroupParams {
  groupId: string;
}
export interface DeleteConnectionGroupResult {
  ok: boolean;
}

export interface MoveConnectionParams {
  connectionId: string;
  groupId: string | null;
}
export interface MoveConnectionResult {
  ok: boolean;
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

export interface ConnectionStatusParams {
  connectionId: string;
}

export interface RunQueryParams {
  connectionId: string;
  sql: string;
  limit?: number;
  /** Explicit acknowledgement required when the server detects destructive SQL. */
  executionRiskAccepted?: boolean;
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
export interface InsertRowParams {
  connectionId: string;
  table: { schema: string; name: string };
  values: Record<string, unknown>;
}
export interface InsertRowResult { rowsAffected: number; }

export interface IntrospectParams {
  connectionId: string;
}
export type IntrospectResult = Database;

export interface ListRelationsParams {
  connectionId: string;
  schema?: string;
  includeColumns?: boolean;
  search?: string;
}
export interface ListRelationsResult {
  relations: ReadonlyArray<{
    schema: string;
    name: string;
    kind: "table" | "view";
    columns?: ReadonlyArray<{
      name: string;
      dataType: string;
      nullable: boolean;
      isPrimaryKey: boolean;
      foreignKeyTo?: { schema: string; table: string; column: string };
    }>;
  }>;
}
export interface ListColumnsParams {
  connectionId: string;
  schema: string;
  table: string;
}
export interface ListColumnsResult {
  columns: NonNullable<ListRelationsResult["relations"][number]["columns"]>;
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

export interface UpdateCheckParams {
  currentVersion: string;
}
export interface UpdateCheckResult {
  available: boolean;
  version?: string;
  releaseUrl?: string;
}

export interface McpUiRouter {
  "mcp.ui.next": (p?: McpUiNextParams, context?: McpUiRequestContext) => Promise<McpUiNextResult>;
  "mcp.ui.respond": (p: McpUiRespondParams) => Promise<McpUiRespondResult>;
  "mcp.status": () => Promise<McpStatusResult>;
  "mcp.history": () => Promise<McpHistoryResult>;
}

export interface McpUiRequestContext {
  readonly signal: AbortSignal;
}

// ─────────────────────────── Routing table

export interface RpcRouter {
  "connection.add": (p: AddConnectionParams) => Promise<AddConnectionResult>;
  "connection.list": () => Promise<ListConnectionsResult>;
  "connection.remove": (p: { connectionId: string }) => Promise<{ ok: boolean }>;
  "connectionGroup.list": () => Promise<ListConnectionGroupsResult>;
  "connectionGroup.create": (p: CreateConnectionGroupParams) => Promise<CreateConnectionGroupResult>;
  "connectionGroup.rename": (p: RenameConnectionGroupParams) => Promise<RenameConnectionGroupResult>;
  "connectionGroup.delete": (p: DeleteConnectionGroupParams) => Promise<DeleteConnectionGroupResult>;
  "connection.move": (p: MoveConnectionParams) => Promise<MoveConnectionResult>;
  "connection.test": (p: TestConnectionParams) => Promise<TestConnectionResult>;
  "connection.status": (p: ConnectionStatusParams) => Promise<TestConnectionResult>;
  "connection.listSchemas": (p: ListSchemasParams) => Promise<ListSchemasResult>;
  "query.run": (p: RunQueryParams) => Promise<RunQueryResult>;
  "query.cancel": (p: CancelQueryParams) => Promise<CancelQueryResult>;
  "query.explain": (p: ExplainQueryParams) => Promise<ExplainQueryResult>;
  "query.diagnose": (p: DiagnoseQueryParams) => Promise<DiagnoseQueryResult>;
  "query.analyzeEditability": (p: AnalyzeEditabilityParams) => Promise<AnalyzeEditabilityResult>;
  "row.update": (p: UpdateRowParams) => Promise<UpdateRowResult>;
  "row.insert": (p: InsertRowParams) => Promise<InsertRowResult>;
  "metadata.introspect": (p: IntrospectParams) => Promise<IntrospectResult>;
  "metadata.listRelations": (p: ListRelationsParams) => Promise<ListRelationsResult>;
  "metadata.listColumns": (p: ListColumnsParams) => Promise<ListColumnsResult>;
  "metadata.listFunctions": (p: ListFunctionsParams) => Promise<ListFunctionsResult>;
  "metadata.listIndexes": (p: ListIndexesParams) => Promise<ListIndexesResult>;
  "metadata.getDefinition": (p: GetDefinitionParams) => Promise<GetDefinitionResult>;
  "completion.get": (p: CompletionParams) => Promise<CompletionResult>;
  "update.check": (p: UpdateCheckParams) => Promise<UpdateCheckResult>;
  "mcp.ui.next": (p?: McpUiNextParams, context?: McpUiRequestContext) => Promise<McpUiNextResult>;
  "mcp.ui.respond": (p: McpUiRespondParams) => Promise<McpUiRespondResult>;
  "mcp.status": () => Promise<McpStatusResult>;
  "mcp.history": () => Promise<McpHistoryResult>;
}

export type BackendRpcRouter = Omit<RpcRouter, keyof McpUiRouter>;

export type RpcHandler<K extends keyof RpcRouter> = RpcRouter[K];
