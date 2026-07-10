import pg, { type Pool, type PoolClient } from "pg";
import type {
  ConnectionConfig,
  ExplainResult,
  FunctionDef,
  IndexInfo,
  QueryResult,
  Relation,
} from "@omni-sql/ts-types";
import { postgresDescriptor } from "@omni-sql/dialect-descriptors";
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
 * Adaptador PostgreSQL real (Fase 2).
 *
 * Usa driver `pg` (node-postgres) com pool nativo. Introspecção via
 * `information_schema` (relações/colunas constraints) + `pg_catalog`
 * (`pg_proc`, `pg_namespace`, `pg_type`) para funções com overloads.
 *
 * O motor de autocomplete nunca viu isto — só consome a interface `Adapter`.
 */
export class PostgresAdapter extends CachedAdapter implements Adapter {
  readonly dialect = "postgres" as const;

  private readonly pool: Pool;
  private runningPid: number | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config);
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

  async listAvailableSchemas(): Promise<readonly string[]> {
    const client = await this.pool.connect();
    try {
      return await listSchemaNames(client);
    } finally {
      client.release();
    }
  }

  protected databaseName(): string {
    return "postgres";
  }

  protected async introspectSchemas(): Promise<readonly (readonly [unknown, string, readonly Relation[]])[]> {
    const client = await this.pool.connect();
    try {
      return await introspectSchemas(client, this.schemaFilter);
    } finally {
      client.release();
    }
  }

  protected async listFunctionsForSchema(schema: string): Promise<readonly FunctionDef[]> {
    const client = await this.pool.connect();
    try {
      return await listFunctionsPerSchema(client, schema);
    } finally {
      client.release();
    }
  }

  async runQuery(sql: string, limit: number): Promise<QueryResult> {
    try {
      return await runQueryViaPool(this.pool, sql, limit, (pid) => {
        this.runningPid = pid;
      });
    } finally {
      this.runningPid = null;
    }
  }

  /** Cancela via `pg_cancel_backend` numa conexão separada — a conexão que roda a query fica ocupada até o driver notar o cancelamento. */
  async cancelRunning(): Promise<void> {
    if (this.runningPid == null) return;
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_cancel_backend($1)", [this.runningPid]);
    } finally {
      client.release();
    }
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

export type { Pool, PoolClient };
