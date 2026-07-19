import type {
  ConnectionConfig,
  ExplainResult,
  FunctionDef,
  IndexInfo,
  QueryResult,
  Relation,
} from "@omni-sql/ts-types";
import { randomUUID } from "node:crypto";
import { jdbcGenericDescriptor } from "@omni-sql/dialect-descriptors";
import type { Adapter, RowUpdateSpec, TestResult } from "@omni-sql/adapters-core";
import { CachedAdapter } from "@omni-sql/adapters-core";
import { jdbcClose, jdbcConnect, jdbcIntrospect, jdbcListSchemas, jdbcQuery, type JdbcTableBody } from "./sidecar-client.ts";

/**
 * Adaptador JDBC genérico (Fase 6). Não fala com o banco diretamente — o
 * `.jar` do driver aponta pra um banco arbitrário e só a JVM sabe carregar e
 * falar JDBC com ele (Node não tem runtime JDBC). A conexão de verdade
 * (`java.sql.Connection`) vive no sidecar (`services/jvm-sidecar`), mantida
 * viva entre chamadas por `id` — este adaptador é só um client HTTP fino
 * pros endpoints `/jdbc/*`.
 *
 * `config.endpoint` é a JDBC URL; `config.options.jarPath` e
 * `config.options.driverClassName` apontam o `.jar` e a classe `java.sql.Driver`.
 *
 * Introspecção de schemas/tabelas/colunas usa `DatabaseMetaData` no sidecar
 * (JDBC padrão, genérico entre drivers). ponytail: funções, índices, FKs e
 * edição de célula ficam fora de escopo — `getFunctions`/`getImportedKeys`
 * não são confiáveis entre drivers JDBC arbitrários.
 */
export class JdbcAdapter extends CachedAdapter implements Adapter {
  readonly dialect = "jdbc-generic" as const;

  private readonly jarPath: string;
  private readonly driverClassName: string;
  private readonly jdbcUrl: string;
  private readonly user: string;
  private readonly password?: string;
  /** Handle owned by this adapter instance, never the persisted connection id. */
  private readonly remoteHandleId = randomUUID();
  private connected = false;
  private connecting?: Promise<void>;

  constructor(config: ConnectionConfig, password?: string) {
    super(config);
    const jarPath = config.options?.jarPath;
    const driverClassName = config.options?.driverClassName;
    if (typeof jarPath !== "string" || jarPath.length === 0) {
      throw new Error("jdbc-generic requer options.jarPath (caminho do .jar do driver)");
    }
    if (typeof driverClassName !== "string" || driverClassName.length === 0) {
      throw new Error("jdbc-generic requer options.driverClassName (classe java.sql.Driver)");
    }
    this.jarPath = jarPath;
    this.driverClassName = driverClassName;
    this.jdbcUrl = config.endpoint;
    this.user = config.user;
    this.password = password;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = jdbcConnect({
      connectionId: this.remoteHandleId,
      jarPath: this.jarPath,
      driverClassName: this.driverClassName,
      jdbcUrl: this.jdbcUrl,
      user: this.user,
      password: this.password,
    }).then(() => {
      this.connected = true;
    });
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async close(): Promise<void> {
    if (this.connecting) await this.connecting.catch(() => {});
    if (!this.connected) return;
    try {
      await jdbcClose(this.remoteHandleId);
    } finally {
      this.connected = false;
    }
  }

  /** Ao contrário do pool dos demais adaptadores, `connect()` aqui deixa uma `java.sql.Connection` viva no sidecar — fecha de novo no fim pra não vazar. */
  async test(): Promise<TestResult> {
    const t0 = Date.now();
    try {
      await this.connect();
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, message: (e as Error).message };
    } finally {
      await this.close().catch(() => {});
    }
  }

  async listAvailableSchemas(): Promise<readonly string[]> {
    return jdbcListSchemas(this.remoteHandleId);
  }

  protected databaseName(): string {
    return "jdbc-generic";
  }

  protected async introspectSchemas(): Promise<readonly (readonly [unknown, string, readonly Relation[]])[]> {
    const schemas = await jdbcIntrospect(this.remoteHandleId, this.schemaFilter);
    return schemas.map((s, i) => [i, s.name, s.tables.map((t) => toRelation(s.name, t))] as const);
  }

  protected async listFunctionsForSchema(_schema: string): Promise<readonly FunctionDef[]> {
    return [];
  }

  async runQuery(sql: string, limit: number): Promise<QueryResult> {
    return jdbcQuery(this.remoteHandleId, sql, limit);
  }

  async explain(_sql: string): Promise<ExplainResult> {
    throw new Error("EXPLAIN não é suportado para jdbc-generic — sintaxe varia por driver, sem forma padrão via JDBC");
  }

  async listIndexes(_schema: string, _table: string): Promise<readonly IndexInfo[]> {
    return [];
  }

  async getDefinition(_kind: "view" | "function", _schema: string, _name: string): Promise<string> {
    throw new Error(
      "getDefinition não é suportado para jdbc-generic — sem SQL padrão pra texto de CREATE VIEW/FUNCTION entre drivers",
    );
  }

  async updateRow(_spec: RowUpdateSpec): Promise<number> {
    throw new Error(
      "edição de célula não é suportada para jdbc-generic ainda — precisaria de um endpoint de statement parametrizado no sidecar",
    );
  }

  dialectDescriptor() {
    return jdbcGenericDescriptor;
  }
}

/** Sem `constraints`: FKs via `getImportedKeys` ficam fora de escopo (ver comentário de topo). */
function toRelation(schema: string, table: JdbcTableBody): Relation {
  return {
    schema,
    name: table.name,
    kind: table.kind,
    columns: table.columns.map((c) => ({
      name: c.name,
      dataType: c.dataType,
      nullable: c.nullable,
      isPrimaryKey: c.isPrimaryKey,
      ordinalPosition: c.ordinalPosition,
    })),
    constraints: [],
  };
}
