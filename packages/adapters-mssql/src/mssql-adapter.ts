import sql, { type ConnectionPool, type Request, type config as MssqlConfig } from "mssql";
import type {
  ConnectionConfig,
  ExplainResult,
  FunctionDef,
  IndexInfo,
  QueryResult,
  Relation,
} from "@omni-sql/ts-types";
import { sqlserverDescriptor } from "@omni-sql/dialect-descriptors";
import type { Adapter, RowUpdateSpec, TestResult } from "@omni-sql/adapters-core";
import { CachedAdapter } from "@omni-sql/adapters-core";
import {
  getDefinitionViaPool,
  introspectSchemas,
  listFunctionsPerSchema,
  listIndexesViaPool,
  listSchemaNames,
  runQueryViaPool,
  updateRowViaPool,
} from "./introspection.ts";

/**
 * Adaptador SQL Server real (Fase 4). Usa driver `mssql` (Tedious por baixo),
 * pool nativo. Introspecção via `INFORMATION_SCHEMA.*` (mesma família ANSI
 * do Postgres) para tabelas/colunas/funções, mais `sys.*` para índices, que
 * o `INFORMATION_SCHEMA` não expõe.
 *
 * O motor de autocomplete nunca viu isto — só consome a interface `Adapter`.
 */
export class MssqlAdapter extends CachedAdapter implements Adapter {
  readonly dialect = "sqlserver" as const;

  private readonly poolConfig: MssqlConfig;
  private poolPromise: Promise<ConnectionPool> | null = null;
  private runningRequest: Request | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config);
    this.poolConfig = parseEndpoint(config.endpoint, config.user, password, config.options);
  }

  private getPool(): Promise<ConnectionPool> {
    if (!this.poolPromise) {
      const pool = new sql.ConnectionPool(this.poolConfig);
      // Sem listener, um erro de pool (drop de conexão em runtime, não só na
      // conexão inicial) vira exceção não tratada no processo — o rejeito da
      // Promise de `.connect()` já cobre a falha de dial em si.
      pool.on("error", () => undefined);
      this.poolPromise = pool.connect();
    }
    return this.poolPromise;
  }

  async connect(): Promise<void> {
    const pool = await this.getPool();
    await pool.request().query("SELECT 1");
  }

  async close(): Promise<void> {
    if (!this.poolPromise) return;
    const promise = this.poolPromise;
    this.poolPromise = null;
    try {
      const pool = await promise;
      await pool.close();
    } catch {
      // `.connect()` já rejeitou (falha de dial) — nada para fechar. Reawaitar
      // `promise` aqui sem o try/catch relança a mesma rejeição como exceção
      // não tratada, já que ninguém mais está esperando por ela.
    }
  }

  async test(): Promise<TestResult> {
    const t0 = Date.now();
    try {
      await this.connect();
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, message: (e as Error).message };
    }
  }

  async listAvailableSchemas(): Promise<readonly string[]> {
    const pool = await this.getPool();
    return listSchemaNames(pool);
  }

  protected databaseName(): string {
    return "sqlserver";
  }

  protected async introspectSchemas(): Promise<readonly (readonly [unknown, string, readonly Relation[]])[]> {
    const pool = await this.getPool();
    return introspectSchemas(pool, this.schemaFilter);
  }

  protected async listFunctionsForSchema(schema: string): Promise<readonly FunctionDef[]> {
    const pool = await this.getPool();
    return listFunctionsPerSchema(pool, schema);
  }

  async runQuery(sqlText: string, limit: number): Promise<QueryResult> {
    const pool = await this.getPool();
    try {
      return await runQueryViaPool(pool, sqlText, limit, (request) => {
        this.runningRequest = request;
      });
    } finally {
      this.runningRequest = null;
    }
  }

  /** `Request.cancel()` é suportado nativamente pelo driver `mssql` para abortar um request em andamento na mesma conexão. */
  async cancelRunning(): Promise<void> {
    this.runningRequest?.cancel();
  }

  async updateRow(spec: RowUpdateSpec): Promise<number> {
    const pool = await this.getPool();
    return updateRowViaPool(pool, spec);
  }

  /**
   * T-SQL não tem `EXPLAIN` — `SET SHOWPLAN_XML ON` faz a sessão devolver o
   * plano em vez de executar as instruções seguintes. Isola isso numa
   * transaction própria (garante que ON/query/OFF rodam na mesma conexão
   * física do pool) e dá rollback no final — a query nunca chega a executar
   * de fato enquanto SHOWPLAN está ligado, mas o rollback cobre qualquer
   * side effect residual da própria troca de modo da sessão.
   */
  async explain(sqlText: string): Promise<ExplainResult> {
    const pool = await this.getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).batch("SET SHOWPLAN_XML ON");
      const planResult = await new sql.Request(tx).batch<Record<string, string>>(sqlText);
      await new sql.Request(tx).batch("SET SHOWPLAN_XML OFF");
      await tx.rollback();
      const row = planResult.recordset?.[0];
      const xml = row ? (Object.values(row)[0] ?? "") : "";
      return { textual: xml, format: "xml", raw: planResult.recordset };
    } catch (e) {
      await tx.rollback().catch(() => undefined);
      throw e;
    }
  }

  async listIndexes(schema: string, table: string): Promise<readonly IndexInfo[]> {
    const pool = await this.getPool();
    return listIndexesViaPool(pool, schema, table);
  }

  async getDefinition(kind: "view" | "function", schema: string, name: string): Promise<string> {
    const pool = await this.getPool();
    return getDefinitionViaPool(pool, kind, schema, name);
  }

  dialectDescriptor() {
    return sqlserverDescriptor;
  }
}

// ─────────────────────────── Wire helpers

function parseEndpoint(
  endpoint: string,
  user: string,
  password?: string,
  options?: Record<string, string | number | boolean>,
): MssqlConfig {
  const base: MssqlConfig = {
    user,
    password: password ?? "",
    server: endpoint,
    database: "",
    options: { trustServerCertificate: true, encrypt: false, ...(options ?? {}) },
    pool: { max: 4 },
  };
  // host:port/db ou host/db — mssql exige `server`/`port`/`database` separados.
  const [hostPort, db] = endpoint.split("/");
  const [host, port] = (hostPort ?? "").split(":");
  return {
    ...base,
    server: host ?? endpoint,
    ...(port ? { port: Number(port) } : {}),
    ...(db ? { database: db } : {}),
  };
}

export type { ConnectionPool };
