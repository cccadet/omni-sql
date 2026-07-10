import type {
  ConnectionConfig,
  Database,
  ExplainResult,
  FunctionDef,
  IndexInfo,
  QueryResult,
  Relation,
  Schema,
} from "@omni-sql/ts-types";
import type { DialectDescriptor } from "@omni-sql/dialect-descriptors";

/**
 * Interface que todo suporte de SGBD implementa. Não conhece lexer, não
 * conhece cache, não conhece engine de autocomplete. A camada acima (backend
 * Node + autocomplete-engine) consome somente isto.
 *
 * Métodos com `By` retornam slices gravados em cache (Fase 1): nunca hitam o
 * banco ao vivo no caminho de keystroke. `introspect` é a única chamada que
 * fala com o banco e popula o cache.
 */
export interface Adapter {
  readonly id: string;
  readonly dialect: ConnectionConfig["dialect"];

  /** Abre e mantém a conexão subjacente. Lança QueryError em falha. */
  connect(): Promise<void>;
  /** Fechamento gracioso. */
  close(): Promise<void>;
  /** Testa conectividade sem levantar estado — usado em UI "Testar conexão". */
  test(): Promise<TestResult>;

  /** Introspecção completa — populando o cache unificado. */
  introspect(): Promise<Database>;
  /** Lista os schemas disponíveis no banco sem introspectar tabelas/colunas — usado pela UI para escolher o que indexar antes de rodar `introspect()`. */
  listAvailableSchemas(): Promise<readonly string[]>;

  // ─────────────────────── Lookups no cache (Fase 1 providencia estes via AdapterCache)
  listSchemas(): readonly Schema[];
  listTables(schema: string): readonly Relation[];
  listColumns(schema: string, table: string): Relation["columns"];
  listFunctions(schema: string): readonly FunctionDef[];

  /** Execução de query para results grid. Delegates ao pool do adaptador. */
  runQuery(sql: string, limit: number): Promise<QueryResult>;
  /** Plano de execução (textual em Fase 5, visual em Fase 9). */
  explain(sql: string): Promise<ExplainResult>;

  /** Índices de uma tabela — consulta ao vivo direto no dicionário de dados (não cacheada). */
  listIndexes(schema: string, table: string): Promise<readonly IndexInfo[]>;
  /** Texto de definição (`CREATE VIEW`/`CREATE FUNCTION`) de uma view ou função — consulta ao vivo. */
  getDefinition(kind: "view" | "function", schema: string, name: string): Promise<string>;

  /**
   * `UPDATE` de uma linha via chave primária — edição inline da grade de
   * resultados. `spec.where` deve cobrir exatamente as colunas de PK (quem
   * garante isso é a camada acima, via metadata-cache — o adaptador só
   * monta e executa o SQL parametrizado). Retorna `rowsAffected`.
   */
  updateRow(spec: RowUpdateSpec): Promise<number>;

  /** Descritor de dialeto consumido pelo lexer. */
  dialectDescriptor(): DialectDescriptor;
}

export interface RowUpdateSpec {
  readonly schema: string | null;
  readonly table: string;
  /** Coluna → novo valor. */
  readonly set: Readonly<Record<string, unknown>>;
  /** Coluna de PK → valor original (usado no `WHERE`). */
  readonly where: Readonly<Record<string, unknown>>;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  message?: string;
}

/** Fábrica por dialeto. Backend resolve adaptador por `dialect`. */
export type AdapterFactory = (config: ConnectionConfig, password?: string) => Adapter;

export class AdapterError extends Error {
  readonly causeTag:
    | "credentials"
    | "network"
    | "driver-missing"
    | "timeout"
    | "unsupported";
  constructor(
    causeTag: AdapterError["causeTag"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AdapterError";
    this.causeTag = causeTag;
  }
}

export { CachedAdapter } from "./cached-adapter.ts";
export {
  registerAdapter,
  resolveAdapter,
} from "./registry.ts";
