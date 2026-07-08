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
  readonly options?: Record<string, string | number | boolean>;
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