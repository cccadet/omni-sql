import oracledb, { type Connection, type Pool } from "oracledb";
import type {
  ConnectionConfig,
  ExplainResult,
  FunctionDef,
  IndexInfo,
  QueryResult,
  Relation,
} from "@omni-sql/ts-types";
import { oracleDescriptor } from "@omni-sql/dialect-descriptors";
import { databaseDiagnostic, type Adapter, type RowInsertSpec, type RowUpdateSpec, type TestResult } from "@omni-sql/adapters-core";
import { CachedAdapter } from "@omni-sql/adapters-core";
import {
  getDefinitionViaConnection,
  insertRowViaConnection,
  introspectSchemas,
  isOracleExplainableStatement,
  listFunctionsPerSchema,
  listIndexesViaConnection,
  listSchemaNames,
  runQueryViaConnection,
  stripTrailingStatementDelimiter,
  updateRowViaConnection,
} from "./introspection.ts";

const ORACLE_QUOTE_PAIRS: Readonly<Record<string, string>> = {
  "[": "]", "(": ")", "{": "}", "<": ">",
};

function afterTerminator(sql: string, start: number, terminator: string): number {
  const end = sql.indexOf(terminator, start);
  return end < 0 ? sql.length : end + terminator.length;
}

function afterQuotedText(sql: string, start: number, quote: string): number {
  let cursor = start + 1;
  while (cursor < sql.length) {
    if (sql[cursor] !== quote) {
      cursor += 1;
    } else if (sql[cursor + 1] === quote) {
      cursor += 2;
    } else {
      return cursor + 1;
    }
  }
  return sql.length;
}

function afterAlternativeQuotedText(sql: string, start: number): number | null {
  const prefix = sql[start]?.toLowerCase() === "q" && sql[start + 1] === "'";
  const opener = sql[start + 2];
  if (!prefix || opener === undefined) return null;
  const closer = ORACLE_QUOTE_PAIRS[opener] ?? opener;
  return afterTerminator(sql, start + 3, `${closer}'`);
}

function bindAt(sql: string, start: number): RegExpExecArray | null {
  if (sql[start] !== ":" || sql[start - 1] === ":" || sql[start + 1] === ":") return null;
  return /^:([A-Za-z_][A-Za-z0-9_$#]*)/.exec(sql.slice(start));
}

/**
 * Produz valores neutros para os binds nomeados usados apenas pelo EXPLAIN
 * PLAN. O scanner ignora comentários, strings, identificadores quoted e a
 * sintaxe alternativa de strings do Oracle para não inventar placeholders.
 */
export function oracleExplainBinds(sql: string): Record<string, null> {
  const binds: Record<string, null> = {};
  let cursor = 0;
  while (cursor < sql.length) {
    if (sql.startsWith("--", cursor)) {
      cursor = afterTerminator(sql, cursor + 2, "\n");
      continue;
    }
    if (sql.startsWith("/*", cursor)) {
      cursor = afterTerminator(sql, cursor + 2, "*/");
      continue;
    }
    const alternativeQuoteEnd = afterAlternativeQuotedText(sql, cursor);
    if (alternativeQuoteEnd !== null) {
      cursor = alternativeQuoteEnd;
      continue;
    }
    const current = sql[cursor]!;
    if (current === "'" || current === '"') {
      cursor = afterQuotedText(sql, cursor, current);
      continue;
    }
    const bind = bindAt(sql, cursor);
    if (bind) {
      binds[bind[1]!] = null;
      cursor += bind[0].length;
      continue;
    }
    cursor += 1;
  }
  return binds;
}

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
  private activeQuery: { readonly connection: Connection; readonly token: symbol } | null = null;

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
    const activeQuery = { connection: conn, token: Symbol() };
    this.activeQuery = activeQuery;
    try {
      // Oracle exige FROM DUAL para SELECTs sem cláusula FROM.
      const normalized = stripTrailingStatementDelimiter(sql);
      const needsDual = /^\s*SELECT\b/i.test(normalized) && !/\bFROM\b/i.test(normalized);
      const finalSql = needsDual ? `${normalized} FROM DUAL` : sql;
      return await runQueryViaConnection(conn, finalSql, limit);
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      if (this.activeQuery?.token === activeQuery.token) this.activeQuery = null;
      await conn.close();
    }
  }

  async cancelRunning(): Promise<void> {
    const activeQuery = this.activeQuery;
    if (!activeQuery) return;
    try {
      await activeQuery.connection.break();
    } catch {
      // `break()` is best-effort; runQuery owns query and connection cleanup.
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
  async insertRow(spec: RowInsertSpec): Promise<number> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      return await insertRowViaConnection(conn, spec);
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
      await conn.execute(
        `EXPLAIN PLAN SET STATEMENT_ID = '${planId}' FOR ${sql}`,
        oracleExplainBinds(sql),
      );
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

  async validateQuery(sql: string) {
    if (!isOracleExplainableStatement(sql)) return [];
    try { await this.explain(sql); return []; }
    catch (e) { return [databaseDiagnostic(sql, e, this.dialect)] as const; }
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
