import pg, { type Pool, type PoolClient } from "pg";
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
import { postgresDescriptor } from "@omni-sql/dialect-descriptors";
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
 * Adaptador PostgreSQL real (Fase 2).
 *
 * Usa driver `pg` (node-postgres) com pool nativo. Introspecção via
 * `information_schema` (relações/colunas constraints) + `pg_catalog`
 * (`pg_proc`, `pg_namespace`, `pg_type`) para funções com overloads.
 *
 * O motor de autocomplete nunca viu isto — só consome a interface `Adapter`.
 * Em Fase 4 este pacote é o template para MySQL/MariaDB/SQLServer/Oracle.
 */
export class PostgresAdapter implements Adapter {
  readonly id: string;
  readonly dialect = "postgres" as const;

  private readonly pool: Pool;
  private introspected: Database | null = null;
  private schemasCache: Schema[] = [];
  private relationsBySchema = new Map<string, Relation[]>();
  private functionsBySchema = new Map<string, FunctionDef[]>();
  private readonly schemaFilter?: readonly string[];

  constructor(config: ConnectionConfig, password?: string) {
    this.id = config.id;
    this.schemaFilter = config.schemas;
    const conn = parseEndpoint(config.endpoint, config.user, password, config.options);
    this.pool = new pg.Pool({
      connectionString: conn.connectionString,
      max: 4,
      statement_timeout: 30_000,
      ...(conn.directOptions ?? {}),
    });
  }

  async connect(): Promise<void> {
    const c = await this.pool.connect();
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
    const client = await this.pool.connect();
    try {
      const schemas = await introspectSchemas(client, this.schemaFilter);
      this.schemasCache = schemas.map(([, name]) => ({ database: "postgres", name }));
      this.relationsBySchema.clear();
      this.functionsBySchema.clear();
      for (const [, schemaName, rels] of schemas) {
        this.relationsBySchema.set(schemaName, [...rels]);
        const fns = await listFunctionsPerSchema(client, schemaName);
        this.functionsBySchema.set(schemaName, fns);
      }
      this.introspected = {
        connectionId: this.id,
        name: "postgres",
        schemas: this.schemasCache,
      };
      return this.introspected;
    } finally {
      client.release();
    }
  }

  async listAvailableSchemas(): Promise<readonly string[]> {
    const client = await this.pool.connect();
    try {
      return await listSchemaNames(client);
    } finally {
      client.release();
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
    const client = await this.pool.connect();
    try {
      const r = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
      return {
        textual: JSON.stringify(r.rows, null, 2),
        format: "json",
        raw: r.rows,
      };
    } finally {
      client.release();
    }
  }

  async listIndexes(schema: string, table: string): Promise<readonly IndexInfo[]> {
    return listIndexesViaPool(this.pool, schema, table);
  }

  async getDefinition(kind: "view" | "function", schema: string, name: string): Promise<string> {
    return getDefinitionViaPool(this.pool, kind, schema, name);
  }

  dialectDescriptor() {
    return postgresDescriptor;
  }
}

// ─────────────────────────── Wire helpers

interface ParsedEndpoint {
  connectionString?: string;
  directOptions?: Record<string, string | number | boolean>;
}

function parseEndpoint(
  endpoint: string,
  user: string,
  password?: string,
  options?: Record<string, string | number | boolean>,
): ParsedEndpoint {
  const directOptions: Record<string, string | number | boolean> = { ...options };
  if (password !== undefined && password.length > 0) {
    directOptions.password = password;
  }

  if (endpoint.startsWith("postgres://") || endpoint.startsWith("postgresql://")) {
    return { connectionString: endpoint, directOptions };
  }
  if (endpoint.startsWith("host=") || endpoint.startsWith("port=")) {
    return { connectionString: endpoint, directOptions };
  }
  // host:port/db without user — pass structured options to pg.Pool.
  const [hostPort, db] = endpoint.split("/");
  const [host, port] = (hostPort ?? "").split(":");
  return {
    directOptions: {
      ...directOptions,
      host: host ?? "",
      ...(port ? { port: Number(port) } : {}),
      database: db ?? "postgres",
      user,
    },
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

export const pgAdapterFactory: AdapterFactory = (config) => new PostgresAdapter(config);

export type { Pool, PoolClient };