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
import type { Adapter, RowUpdateSpec, TestResult } from "./index.ts";

/**
 * Base comum para adaptadores que cacheiam metadados após introspecção.
 * Subclasses implementam apenas conexão, execução e o fetch de metadados
 * específico do SGBD; o cache de schemas/relações/funções fica aqui.
 */
export abstract class CachedAdapter implements Adapter {
  readonly id: string;
  abstract readonly dialect: ConnectionConfig["dialect"];

  protected readonly schemaFilter?: readonly string[];
  protected introspected: Database | null = null;
  protected schemasCache: Schema[] = [];
  protected relationsBySchema = new Map<string, readonly Relation[]>();
  protected functionsBySchema = new Map<string, readonly FunctionDef[]>();

  constructor(config: ConnectionConfig) {
    this.id = config.id;
    this.schemaFilter = config.schemas;
  }

  abstract connect(): Promise<void>;
  abstract close(): Promise<void>;
  abstract test(): Promise<TestResult>;

  abstract listAvailableSchemas(): Promise<readonly string[]>;

  /** Retorna o nome do banco usado nos objetos Schema (ex: "postgres", "mysql"). */
  protected abstract databaseName(): string;

  /** Introspecção bruta: lista de schemas com suas relações já resolvidas. */
  protected abstract introspectSchemas(): Promise<readonly (readonly [unknown, string, readonly Relation[]])[]>;

  /** Funções de um schema — chamada durante o populate do cache. */
  protected abstract listFunctionsForSchema(schema: string): Promise<readonly FunctionDef[]>;

  async introspect(): Promise<Database> {
    const schemas = await this.introspectSchemas();
    const databaseName = this.databaseName();
    this.schemasCache = schemas.map(([, name]) => ({ database: databaseName, name }));
    this.relationsBySchema.clear();
    this.functionsBySchema.clear();
    for (const [, schemaName, rels] of schemas) {
      this.relationsBySchema.set(schemaName, [...rels]);
      const fns = await this.listFunctionsForSchema(schemaName);
      this.functionsBySchema.set(schemaName, fns);
    }
    this.introspected = {
      connectionId: this.id,
      name: databaseName,
      schemas: this.schemasCache,
    };
    return this.introspected;
  }

  listSchemas(): readonly Schema[] {
    return this.schemasCache;
  }

  listTables(schema: string): readonly Relation[] {
    return this.relationsBySchema.get(schema) ?? [];
  }

  listColumns(schema: string, table: string): Relation["columns"] {
    const rel = this.relationsBySchema.get(schema)?.find((r) => r.name === table);
    return rel ? rel.columns : [];
  }

  listFunctions(schema: string): readonly FunctionDef[] {
    return this.functionsBySchema.get(schema) ?? [];
  }

  abstract runQuery(sql: string, limit: number): Promise<QueryResult>;
  abstract explain(sql: string): Promise<ExplainResult>;
  abstract listIndexes(schema: string, table: string): Promise<readonly IndexInfo[]>;
  abstract getDefinition(kind: "view" | "function", schema: string, name: string): Promise<string>;
  abstract updateRow(spec: RowUpdateSpec): Promise<number>;
  abstract dialectDescriptor(): DialectDescriptor;
}
