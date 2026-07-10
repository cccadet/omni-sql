import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
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
import { mysqlDescriptor } from "@omni-sql/dialect-descriptors";
import type { Adapter, AdapterFactory, RowUpdateSpec, TestResult } from "@omni-sql/adapters-core";
import {
  getDefinitionViaPool,
  introspectSchemas,
  listFunctionsPerSchema,
  listIndexesViaPool,
  listSchemaNames,
  runQueryViaPool,
  updateRowViaPool,
  type ColumnRow,
  type FunctionRow,
  type RelationRow,
} from "./introspection.ts";

/**
 * Adaptador MySQL real (Fase 4). Usa driver `mysql2/promise` com pool
 * nativo. Introspecção via `information_schema` — mesma família de views
 * ANSI usada pelo `adapters-pg`, mas MySQL não tem overload de função nem
 * precisa de um segundo join para achegar FK (`key_column_usage` já traz
 * `referenced_table_*` direto).
 *
 * O motor de autocomplete nunca viu isto — só consome a interface `Adapter`.
 * Serve de template para `adapters-mariadb` (mesmo protocolo de fio).
 */
export class MysqlAdapter implements Adapter {
  readonly id: string;
  readonly dialect = "mysql" as const;

  private readonly pool: Pool;
  private schemasCache: Schema[] = [];
  private relationsBySchema = new Map<string, Relation[]>();
  private functionsBySchema = new Map<string, FunctionDef[]>();
  private readonly schemaFilter?: readonly string[];

  constructor(config: ConnectionConfig, password?: string) {
    this.id = config.id;
    this.schemaFilter = config.schemas;
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

  async introspect(): Promise<Database> {
    const conn = await this.pool.getConnection();
    try {
      const schemas = await introspectSchemas(conn, this.schemaFilter);
      this.schemasCache = schemas.map(([, name]) => ({ database: name, name }));
      this.relationsBySchema.clear();
      this.functionsBySchema.clear();
      for (const [, schemaName, rels] of schemas) {
        this.relationsBySchema.set(schemaName, [...rels]);
        const fns = await listFunctionsPerSchema(conn, schemaName);
        this.functionsBySchema.set(schemaName, fns);
      }
      return {
        connectionId: this.id,
        name: "mysql",
        schemas: this.schemasCache,
      };
    } finally {
      conn.release();
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

  listSchemas(): readonly Schema[] {
    return this.schemasCache;
  }
  listTables(schema: string): readonly Relation[] {
    return this.relationsBySchema.get(schema) ?? [];
  }
  listColumns(schema: string, table: string): Relation["columns"] {
    const rels = this.relationsBySchema.get(schema);
    if (!rels) return [];
    const rel = rels.find((r) => r.name === table);
    return rel ? rel.columns : [];
  }
  listFunctions(schema: string): readonly FunctionDef[] {
    return this.functionsBySchema.get(schema) ?? [];
  }

  async runQuery(sql: string, limit: number): Promise<QueryResult> {
    return runQueryViaPool(this.pool, sql, limit);
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
    return mysqlDescriptor;
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

// Re-exports para consumidores que queiram reusar introspection helpers.
export {
  introspectSchemas,
  listFunctionsPerSchema,
  type ColumnRow,
  type FunctionRow,
  type RelationRow,
};

export const mysqlAdapterFactory: AdapterFactory = (config) => new MysqlAdapter(config);

export type { Pool, PoolConnection };
