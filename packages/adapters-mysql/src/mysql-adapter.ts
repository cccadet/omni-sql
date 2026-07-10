import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import type {
  ConnectionConfig,
  ExplainResult,
  FunctionDef,
  IndexInfo,
  QueryResult,
  Relation,
} from "@omni-sql/ts-types";
import { mysqlDescriptor, mariadbDescriptor } from "@omni-sql/dialect-descriptors";
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
 * Adaptador MySQL real (Fase 4). Usa driver `mysql2/promise` com pool
 * nativo. Introspecção via `information_schema` — mesma família de views
 * ANSI usada pelo `adapters-pg`, mas MySQL não tem overload de função nem
 * precisa de um segundo join para achegar FK (`key_column_usage` já traz
 * `referenced_table_*` direto).
 *
 * O motor de autocomplete nunca viu isto — só consome a interface `Adapter`.
 * O dialeto `mariadb` reusa este adaptador (mesmo protocolo de fio).
 */
export class MysqlAdapter extends CachedAdapter implements Adapter {
  readonly dialect: "mysql" | "mariadb";

  private readonly pool: Pool;
  private runningThreadId: number | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config);
    this.dialect = config.dialect === "mariadb" ? "mariadb" : "mysql";
    this.pool = mysql.createPool({
      ...parseEndpoint(config.endpoint, config.user, password, config.options),
      connectionLimit: 4,
      connectTimeout: 10_000,
    });
  }

  async connect(): Promise<void> {
    const c = await this.pool.getConnection();
    await c.query("SELECT 1");
    c.release();
  }
  async close(): Promise<void> {
    await this.pool.end();
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
    const conn = await this.pool.getConnection();
    try {
      return await listSchemaNames(conn);
    } finally {
      conn.release();
    }
  }

  protected databaseName(): string {
    return this.dialect;
  }

  protected async introspectSchemas(): Promise<readonly (readonly [unknown, string, readonly Relation[]])[]> {
    const conn = await this.pool.getConnection();
    try {
      return await introspectSchemas(conn, this.schemaFilter);
    } finally {
      conn.release();
    }
  }

  protected async listFunctionsForSchema(schema: string): Promise<readonly FunctionDef[]> {
    const conn = await this.pool.getConnection();
    try {
      return await listFunctionsPerSchema(conn, schema);
    } finally {
      conn.release();
    }
  }

  async runQuery(sql: string, limit: number): Promise<QueryResult> {
    try {
      return await runQueryViaPool(this.pool, sql, limit, (threadId) => {
        this.runningThreadId = threadId;
      });
    } finally {
      this.runningThreadId = null;
    }
  }

  /** `KILL QUERY` numa conexão separada — `threadId` é sempre um inteiro gerado pelo driver, nunca entrada de usuário, então a interpolação é segura. */
  async cancelRunning(): Promise<void> {
    if (this.runningThreadId == null) return;
    await this.pool.query(`KILL QUERY ${this.runningThreadId}`);
  }

  async updateRow(spec: RowUpdateSpec): Promise<number> {
    return updateRowViaPool(this.pool, spec);
  }

  async explain(sql: string): Promise<ExplainResult> {
    const [rows] = await this.pool.query<(RowDataPacket & { EXPLAIN: string })[]>(
      `EXPLAIN FORMAT=JSON ${sql}`,
    );
    const textual = rows[0]?.EXPLAIN ?? "{}";
    return { textual, format: "json", raw: JSON.parse(textual) };
  }

  async listIndexes(schema: string, table: string): Promise<readonly IndexInfo[]> {
    return listIndexesViaPool(this.pool, schema, table);
  }

  async getDefinition(kind: "view" | "function", schema: string, name: string): Promise<string> {
    return getDefinitionViaPool(this.pool, kind, schema, name);
  }

  dialectDescriptor() {
    return this.dialect === "mariadb" ? mariadbDescriptor : mysqlDescriptor;
  }
}

// ─────────────────────────── Wire helpers

interface PoolOptions {
  uri?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}

function parseEndpoint(
  endpoint: string,
  user: string,
  password?: string,
  options?: Record<string, string | number | boolean>,
): PoolOptions {
  if (endpoint.startsWith("mysql://") || endpoint.startsWith("mariadb://")) {
    return { uri: endpoint.replace(/^mariadb:\/\//, "mysql://") };
  }
  // host:port/db sem user embutido — passa opções estruturadas ao pool.
  const [hostPort, db] = endpoint.split("/");
  const [host, port] = (hostPort ?? "").split(":");
  return {
    ...options,
    host: host ?? "",
    ...(port ? { port: Number(port) } : {}),
    database: db ?? "",
    user,
    ...(password !== undefined && password.length > 0 ? { password } : {}),
  };
}

export type { Pool, PoolConnection };
