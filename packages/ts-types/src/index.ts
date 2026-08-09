/**
 * Modelo unificado de metadados (Fase 1).
 * Consumido por adaptadores (Fase 2/4/6/7), camada de cache (Fase 1) e motor
 * de autocomplete (Fase 3). Ninguém abaixo desta camada conhece isto.
 */

// ─────────────────────────── Tipos primitivos

/** Identificador qualificado de SGBD. */
export type DialectId =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "sqlserver"
  | "oracle"
  | "jdbc-generic"
  | "odbc";

// ─────────────────────────── Entidades do modelo

export interface Column {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly isPrimaryKey: boolean;
  /** Referência FK alvo (schema.table.column), se aplicável. */
  readonly foreignKeyTo?: ColumnRef;
  readonly defaultValue?: string;
  readonly ordinalPosition: number;
}

export interface ColumnRef {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}

export type ConstraintKind = "primary" | "foreign" | "unique";

export interface Constraint {
  readonly name: string;
  readonly kind: ConstraintKind;
  readonly columns: readonly string[];
  /** Para FK: alvo referenciado. */
  readonly references?: ColumnRef;
}

export type RelationKind = "table" | "view";

export interface Relation {
  readonly schema: string;
  readonly name: string;
  readonly kind: RelationKind;
  readonly columns: readonly Column[];
  readonly constraints: readonly Constraint[];
  readonly lastSyncedAt?: number;
}

export interface FunctionParameter {
  readonly name: string;
  readonly dataType: string;
  readonly mode: "in" | "out" | "inout";
  readonly defaultValue?: string;
  readonly ordinalPosition: number;
}

export interface FunctionOverload {
  readonly parameters: readonly FunctionParameter[];
  readonly returnType: string;
}

export interface FunctionDef {
  readonly schema: string;
  readonly name: string;
  readonly overloads: readonly FunctionOverload[];
  readonly lastSyncedAt?: number;
}

export interface IndexInfo {
  readonly name: string;
  readonly unique: boolean;
  readonly primary: boolean;
  readonly columns: readonly string[];
}

/** Objetos cujo texto de definição (CREATE ...) pode ser exibido ao usuário. */
export type ObjectDefinitionKind = "table" | "view" | "function";

export interface Schema {
  readonly database: string;
  readonly name: string;
  readonly lastSyncedAt?: number;
}

export interface Database {
  readonly connectionId: string;
  readonly name: string;
  readonly schemas: readonly Schema[];
  readonly lastSyncedAt?: number;
}

// ─────────────────────────── Conexão

export interface ConnectionConfig {
  readonly id: string;
  readonly label: string;
  readonly dialect: DialectId;
  /** URL/DSN/host conforme o dialeto; formato livre interpretado pelo adaptador. */
  readonly endpoint: string;
  readonly user: string;
  /** Senha nunca persistida em config — vem do keyring no runtime. */
  readonly passwordSlot?: string;
  /** Flat persisted group; undefined is accepted for legacy callers, null means root. */
  readonly groupId?: string | null;
  readonly options?: Record<string, string | number | boolean>;
  /** Allowlist de schemas a introspectar; `undefined`/vazio = todos (comportamento padrão). */
  readonly schemas?: readonly string[];
}

export interface ConnectionGroup {
  readonly id: string;
  readonly name: string;
}

// ─────────────────────────── Resultados de query

export interface QueryResultColumn {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
}

export interface QueryResult {
  readonly columns: readonly QueryResultColumn[];
  /** Linhas como arrays posicionais alinhados às colunas. */
  readonly rows: readonly unknown[][];
  readonly rowsAffected?: number;
  readonly rowsMoreAvailable: boolean;
  readonly elapsedMs: number;
}

export interface ExplainResult {
  readonly textual: string;
  readonly format: "text" | "json" | "xml" | "dot";
  readonly raw: unknown;
}

// ─────────────────────────── Editabilidade da grade de resultados

/** Tabela de origem de um SELECT elegível para edição de célula. */
export interface EditableTable {
  readonly schema: string | null;
  readonly name: string;
}

/** Uma coluna projetada: nome real da coluna de origem, ou `null` se for uma expressão. */
export interface EditableColumn {
  readonly sourceColumn: string | null;
}

/**
 * Resultado da análise (via sidecar JVM/Calcite) de se uma query é um
 * `SELECT` simples de uma tabela só — condição mínima para a grade de
 * resultados permitir edição de célula com segurança.
 */
export interface QueryEditability {
  readonly editable: boolean;
  readonly reason: string | null;
  readonly table: EditableTable | null;
  /** `true` quando a projeção inteira é `*` (colunas mapeiam 1:1 por nome). */
  readonly selectStar: boolean;
  /** Posicional, alinhado a `QueryResult.columns` — vazio quando `selectStar`. */
  readonly columns: readonly EditableColumn[];
}

/**
 * Versão enriquecida de `QueryEditability`: combina a análise sintática do
 * sidecar (Calcite, dialeto-agnóstico) com a chave primária real da tabela,
 * resolvida server-side via metadata-cache. É isto que a UI consome — o
 * backend nunca confia de volta em `pkColumns`/`table` vindos do cliente ao
 * executar o `UPDATE` (revalida contra o cache antes de gravar).
 */
export interface RowEditability {
  readonly editable: boolean;
  readonly reason: string | null;
  /** `schema` sempre concreto (nunca `null`) quando `editable`. */
  readonly table: EditableTable | null;
  /** Vazio quando não editável (sem PK conhecida, tabela não introspectada, etc.). */
  readonly pkColumns: readonly string[];
  readonly selectStar: boolean;
  readonly columns: readonly EditableColumn[];
}

export class QueryError extends Error {
  readonly causeTag: QueryErrorCause;
  readonly sqlState?: string;
  constructor(causeTag: QueryErrorCause, message: string, sqlState?: string) {
    super(message);
    this.name = "QueryError";
    this.causeTag = causeTag;
    if (sqlState !== undefined) this.sqlState = sqlState;
  }
}

export type QueryErrorCause =
  | "credentials"
  | "network"
  | "driver-missing"
  | "timeout"
  | "syntax"
  | "permission"
  | "unknown";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface SqlDiagnostic {
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  /** Character offsets in the submitted SQL statement. */
  readonly start: number;
  readonly end: number;
  readonly source: "dialect" | "database" | "polyglot";
  readonly sourceDialect?: DialectId;
  readonly targetDialect?: DialectId;
  readonly transpiledSql?: string;
  readonly transpileMessage?: string;
}

export interface SqlExecutionError {
  readonly message: string;
  readonly code?: string;
  readonly position?: {
    readonly start: number;
    readonly end?: number;
  };
}

// ─────────────────────────── MCP bridge

/** Tools exposed by the local MCP bridge. Keep this list intentionally closed. */
export type McpToolName =
  | "getActiveSql"
  | "getActiveConnectionContext"
  | "getSchemaSummary"
  | "getLatestSqlExecutionError"
  | "openSqlTab"
  | "proposeSqlEdit";

export const MCP_MAX_HTTP_BODY_BYTES = 64 * 1024;
export const MCP_MAX_ARGUMENT_BYTES = 48 * 1024;
export const MCP_MAX_STRING_BYTES = 32 * 1024;
export const MCP_MAX_BRIDGE_RESULT_BYTES = 256 * 1024;
export const MCP_MAX_QUEUE_SIZE = 32;
export const MCP_MAX_UI_WAIT_MS = 30_000;
export const MCP_REQUEST_TIMEOUT_MS = 120_000;
export const MCP_LISTENER_LEASE_MS = 30_000;
export const MCP_MAX_REQUEST_ID_BYTES = 128;
export const MCP_MAX_LISTENER_ID_BYTES = 128;
export const MCP_MAX_ERROR_MESSAGE_BYTES = 1_024;
export const MCP_MAX_SQL_BYTES = MCP_MAX_STRING_BYTES;
export const MCP_MAX_TITLE_BYTES = 256;
export const MCP_MAX_RATIONALE_BYTES = 8 * 1024;
export const MCP_MAX_CONNECTION_ID_BYTES = 256;

export const MCP_LIMITS = {
  maxHttpBodyBytes: MCP_MAX_HTTP_BODY_BYTES,
  maxArgumentBytes: MCP_MAX_ARGUMENT_BYTES,
  maxStringBytes: MCP_MAX_STRING_BYTES,
  maxBridgeResultBytes: MCP_MAX_BRIDGE_RESULT_BYTES,
  maxQueueSize: MCP_MAX_QUEUE_SIZE,
  maxUiWaitMs: MCP_MAX_UI_WAIT_MS,
  requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS,
  listenerLeaseMs: MCP_LISTENER_LEASE_MS,
  maxRequestIdBytes: MCP_MAX_REQUEST_ID_BYTES,
  maxListenerIdBytes: MCP_MAX_LISTENER_ID_BYTES,
  maxErrorMessageBytes: MCP_MAX_ERROR_MESSAGE_BYTES,
  maxSqlBytes: MCP_MAX_SQL_BYTES,
  maxTitleBytes: MCP_MAX_TITLE_BYTES,
  maxRationaleBytes: MCP_MAX_RATIONALE_BYTES,
  maxConnectionIdBytes: MCP_MAX_CONNECTION_ID_BYTES,
} as const;

export interface McpToolArgsByName {
  getActiveSql: Record<string, never>;
  getActiveConnectionContext: Record<string, never>;
  getSchemaSummary: Record<string, never>;
  getLatestSqlExecutionError: Record<string, never>;
  openSqlTab: {
    readonly title: string;
    readonly sql: string;
    readonly connectionId?: string;
  };
  proposeSqlEdit: {
    readonly sql: string;
    readonly rationale: string;
  };
}

export type McpToolArgs<K extends McpToolName = McpToolName> = McpToolArgsByName[K];

/** Exact request body shared by MCP HTTP clients and backend validation. */
export type McpToolRequest<K extends McpToolName = McpToolName> = {
  [T in K]: {
    readonly tool: T;
    readonly args: McpToolArgsByName[T];
  };
}[K];

export interface McpSchemaSummaryColumn {
  readonly name: string;
  readonly dataType: string;
}

export interface McpSchemaSummaryRelation {
  readonly name: string;
  readonly kind: "table" | "view";
  readonly columns: readonly McpSchemaSummaryColumn[];
}

export interface McpSchemaSummarySchema {
  readonly name: string;
  readonly relations: readonly McpSchemaSummaryRelation[];
}

export interface McpToolResultByName {
  getActiveSql: {
    readonly sql: string;
  };
  getActiveConnectionContext: {
    readonly connectionId: string;
    readonly label: string;
    readonly dialect: DialectId;
  };
  getSchemaSummary: {
    readonly connectionId: string;
    readonly schemas: readonly McpSchemaSummarySchema[];
  };
  getLatestSqlExecutionError: {
    readonly error: SqlExecutionError | null;
  };
  openSqlTab: {
    readonly opened: boolean;
  };
  proposeSqlEdit: {
    readonly approved: boolean;
  };
}

export type McpToolResult<K extends McpToolName = McpToolName> = McpToolResultByName[K];

/** Request delivered from backend to the single desktop UI listener. */
export type McpBridgeRequest = McpToolRequest & {
  readonly id: string;
  /** Absolute deadline for UI response, in epoch milliseconds. */
  readonly expiresAt: number;
};

export type McpErrorCode = "invalid" | "unavailable" | "rejected" | "stale" | "timeout";

export interface McpError {
  readonly code: McpErrorCode;
  readonly message: string;
}

/** Response returned by desktop UI for a bridge request. */
export type McpBridgeResponse =
  | {
    readonly id: string;
    readonly ok: true;
    /** Untrusted UI payload; bridge validates against originating tool. */
    readonly result: unknown;
  }
  | {
    readonly id: string;
    readonly ok: false;
    readonly error: McpError;
  };

/** Body accepted by authenticated POST /mcp. */
export type McpHttpRequest = McpToolRequest;

export interface McpHttpSuccess<K extends McpToolName = McpToolName> {
  readonly result: McpToolResultByName[K];
}

export type McpHttpErrorCode = "unauthorized" | McpErrorCode;

export interface McpHttpError {
  readonly code: McpHttpErrorCode;
  readonly message: string;
}

export interface McpHttpFailure {
  readonly error: McpHttpError;
}

export type McpHttpResponse<K extends McpToolName = McpToolName> = McpHttpSuccess<K> | McpHttpFailure;

export interface McpUiNextParams {
  /** Stable ID generated by desktop frontend; omitted callers use default session. */
  readonly listenerId?: string;
  /** Long-poll duration. Backend clamps it to its bounded maximum. */
  readonly waitMs?: number;
}

export type McpUiNextResult = McpBridgeRequest | null;

export type McpUiRespondParams = McpBridgeResponse & {
  readonly listenerId?: string;
};

export interface McpUiRespondResult {
  readonly accepted: true;
}

export interface McpStatusResult {
  readonly uiConnected: boolean;
  readonly queueSize: number;
  readonly inFlight: number;
  readonly maxQueueSize: number;
  readonly timeoutMs: number;
}
