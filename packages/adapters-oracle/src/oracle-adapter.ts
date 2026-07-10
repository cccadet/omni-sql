import oracledb, { type Pool } from "oracledb";
import type {
  ConnectionConfig,
  ExplainResult,
  FunctionDef,
  IndexInfo,
  QueryResult,
  Relation,
} from "@omni-sql/ts-types";
import { oracleDescriptor } from "@omni-sql/dialect-descriptors";
import type { Adapter, RowUpdateSpec, TestResult } from "@omni-sql/adapters-core";
import { CachedAdapter } from "@omni-sql/adapters-core";
import {
  getDefinitionViaConnection,
  introspectSchemas,
  listFunctionsPerSchema,
  listIndexesViaConnection,
  listSchemaNames,
  runQueryViaConnection,
  updateRowViaConnection,
} from "./introspection.ts";

/**
 * Adaptador Oracle real. Usa `oracledb` em Thin mode (puro JS, sem Oracle
 * Instant Client) — mesma forma de conexão que node-oracledb usa por padrão
 * desde a v6. Introspecção via `ALL_TABLES`/`ALL_TAB_COLUMNS`/
 * `ALL_CONSTRAINTS` (dicionário de dados, equivalente ao
 * `information_schema` do Postgres).
 *
 * O motor de autocomplete nunca viu isto — só consome a interface `Adapter`.
 */
export class OracleAdapter extends CachedAdapter implements Adapter {
  readonly dialect = "oracle" as const;

  private readonly connectString: string;
  private readonly user: string;
  private readonly password: string;
  private poolPromise: Promise<Pool> | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config);
    this.connectString = config.endpoint;
    this.user = config.user;
    this.password = password ?? "";
  }

  private getPool(): Promise<Pool> {
    if (!this.poolPromise) {
      this.poolPromise = oracledb.createPool({
        user: this.user,
        password: this.password,
        connectString: this.connectString,
        poolMin: 0,
        poolMax: 4,
        poolTimeout: 60,
      });
    }
    return this.poolPromise;
  }

  async connect(): Promise<void> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      await conn.execute("SELECT 1 FROM DUAL");
    } finally {
      await conn.close();
    }
  }

  async close(): Promise<void> {
    if (!this.poolPromise) return;
    const pool = await this.poolPromise;
    this.poolPromise = null;
    await pool.close(0);
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
    const conn = await pool.getConnection();
    try {
      return await listSchemaNames(conn);
    } finally {
      await conn.close();
    }
  }

  protected databaseName(): string {
    return "oracle";
  }

  protected async introspectSchemas(): Promise<readonly (readonly [unknown, string, readonly Relation[]])[]> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      return await introspectSchemas(conn, this.schemaFilter);
    } finally {
      await conn.close();
    }
  }

  protected async listFunctionsForSchema(schema: string): Promise<readonly FunctionDef[]> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      return await listFunctionsPerSchema(conn, schema);
    } finally {
      await conn.close();
    }
  }

  async runQuery(sql: string, limit: number): Promise<QueryResult> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      return await runQueryViaConnection(conn, sql, limit);
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      await conn.close();
    }
  }

  async updateRow(spec: RowUpdateSpec): Promise<number> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      return await updateRowViaConnection(conn, spec);
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      await conn.close();
    }
  }

  async explain(sql: string): Promise<ExplainResult> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      // STATEMENT_ID do EXPLAIN PLAN exige literal (bind variable não é
      // aceito nessa posição); planId é gerado internamente, não vem de
      // entrada do usuário, então a interpolação aqui é segura.
      const planId = `omni_${Date.now().toString(36)}`;
      await conn.execute(`EXPLAIN PLAN SET STATEMENT_ID = '${planId}' FOR ${sql}`);
      const r = await conn.execute(
        `SELECT plan_table_output AS "line" FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', :planId, 'BASIC'))`,
        { planId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const rows = (r.rows ?? []) as Array<{ line: string }>;
      const textual = rows.map((row) => row.line).join("\n");
      return { textual, format: "text", raw: rows };
    } finally {
      await conn.close();
    }
  }

  async listIndexes(schema: string, table: string): Promise<readonly IndexInfo[]> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      return await listIndexesViaConnection(conn, schema, table);
    } finally {
      await conn.close();
    }
  }

  async getDefinition(kind: "view" | "function", schema: string, name: string): Promise<string> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      return await getDefinitionViaConnection(conn, kind, schema, name);
    } finally {
      await conn.close();
    }
  }

  dialectDescriptor() {
    return oracleDescriptor;
  }
}
