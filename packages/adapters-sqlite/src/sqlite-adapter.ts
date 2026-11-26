import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  Column,
  ConnectionConfig,
  Constraint,
  ExplainResult,
  FunctionDef,
  IndexInfo,
  QueryResult,
  QueryResultColumn,
  Relation,
} from "@omni-sql/ts-types";
import { quoteIdentifier, sqliteDescriptor } from "@omni-sql/dialect-descriptors";
import {
  AdapterError,
  CachedAdapter,
  databaseDiagnostic,
  type Adapter,
  type QueryBatch,
  type QueryStreamOptions,
  type RowInsertSpec,
  type RowUpdateSpec,
  type TestResult,
} from "@omni-sql/adapters-core";

const MEMORY = ":memory:";
const BUSY_TIMEOUT_MS = 5_000;

type Row = Record<string, unknown>;

/**
 * Adaptador SQLite sobre o `node:sqlite` embutido no Node 22 (sem driver
 * nativo extra). O endpoint é o caminho absoluto do arquivo, ou `:memory:`.
 *
 * "Schemas" são os bancos anexados (`main` e os `ATTACH`); `temp` fica de
 * fora. O driver é síncrono: cada chamada bloqueia o event loop enquanto o
 * SQLite trabalha, por isso não há `cancelRunning`. `streamQuery` devolve o
 * controle ao event loop entre lotes e respeita o `AbortSignal` ali.
 *
 * Leitura segura (`runReadOnlyQuery`) usa uma segunda conexão aberta com
 * `readOnly: true`, que nenhum `PRAGMA` consegue reabrir para escrita.
 */
export class SqliteAdapter extends CachedAdapter implements Adapter {
  readonly dialect = "sqlite" as const;

  private readonly location: string;
  private readonly openReadOnly: boolean;
  private db: DatabaseSync | null = null;
  private readOnlyDb: DatabaseSync | null = null;

  constructor(config: ConnectionConfig, _password?: string) {
    super(config);
    this.location = resolveSqlitePath(config.endpoint);
    this.openReadOnly = config.options?.readOnly === true || config.options?.readOnly === "true";
  }

  // ─────────────────────────── Lifecycle

  async connect(): Promise<void> {
    this.connection().prepare("SELECT 1").get();
  }

  async close(): Promise<void> {
    this.db?.close();
    this.readOnlyDb?.close();
    this.db = null;
    this.readOnlyDb = null;
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

  private connection(): DatabaseSync {
    this.db ??= this.open(this.openReadOnly);
    return this.db;
  }

  private open(readOnly: boolean): DatabaseSync {
    if (this.location !== MEMORY) {
      // DatabaseSync cria o arquivo quando ele não existe; um caminho com erro
      // de digitação viraria um banco vazio em silêncio.
      if (!existsSync(this.location)) throw new SqliteFileError("SQLite file not found. Check the path.");
      if (!statSync(this.location).isFile()) throw new SqliteFileError("SQLite path is not a file. Choose a database file.");
    }
    const db = new DatabaseSync(this.location, { readOnly });
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    return db;
  }

  // ─────────────────────────── Metadata

  async listAvailableSchemas(): Promise<readonly string[]> {
    return this.attachedSchemas();
  }

  protected databaseName(): string {
    return this.location === MEMORY ? MEMORY : basename(this.location);
  }

  private attachedSchemas(): string[] {
    const rows = this.connection().prepare("SELECT name FROM pragma_database_list ORDER BY seq").all() as Row[];
    return rows.map((row) => String(row.name)).filter((name) => name !== "temp");
  }

  protected async introspectSchemas(): Promise<readonly (readonly [unknown, string, readonly Relation[]])[]> {
    const db = this.connection();
    const wanted = this.schemaFilter && this.schemaFilter.length > 0 ? new Set(this.schemaFilter) : null;
    return this.attachedSchemas()
      .filter((schema) => !wanted || wanted.has(schema))
      .map((schema) => [null, schema, introspectSchema(db, schema)] as const);
  }

  protected async listFunctionsForSchema(schema: string): Promise<readonly FunctionDef[]> {
    // Funções do SQLite são globais à conexão; publicá-las só em `main`
    // evita duplicar a lista por banco anexado.
    if (schema !== "main") return [];
    let rows: Row[];
    try {
      rows = this.connection().prepare("SELECT name, narg FROM pragma_function_list ORDER BY name, narg").all() as Row[];
    } catch {
      return [];
    }
    const byName = new Map<string, Set<number>>();
    for (const row of rows) {
      const name = String(row.name);
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name)!.add(Number(row.narg));
    }
    return [...byName].map(([name, arities]) => ({
      schema,
      name,
      overloads: [...arities].sort((a, b) => a - b).map((narg) => ({
        returnType: "any",
        parameters: Array.from({ length: Math.max(narg, 0) }, (_, i) => ({
          name: `arg${i + 1}`,
          dataType: "any",
          mode: "in" as const,
          ordinalPosition: i + 1,
        })),
      })),
    }));
  }

  async listIndexes(schema: string, table: string): Promise<readonly IndexInfo[]> {
    const db = this.connection();
    const indexes = (db.prepare("SELECT name, \"unique\", origin FROM pragma_index_list(?, ?) ORDER BY seq").all(table, schema) as Row[])
      .map((row): IndexInfo => ({
        name: String(row.name),
        unique: Number(row.unique) === 1,
        primary: row.origin === "pk",
        columns: (db.prepare("SELECT name FROM pragma_index_info(?, ?) ORDER BY seqno").all(String(row.name), schema) as Row[])
          .map((column) => (column.name === null ? "<expression>" : String(column.name))),
      }));
    // `INTEGER PRIMARY KEY` é alias do rowid e não gera índice próprio.
    if (!indexes.some((index) => index.primary)) {
      const pk = primaryKeyColumns(db, schema, table);
      if (pk.length > 0) indexes.unshift({ name: "PRIMARY KEY", unique: true, primary: true, columns: pk });
    }
    return indexes;
  }

  async getDefinition(kind: "view" | "function", schema: string, name: string): Promise<string> {
    if (kind === "function") {
      throw new AdapterError("unsupported", "SQLite functions are built in or registered by the host; they have no SQL definition");
    }
    return objectSql(this.connection(), schema, "view", name);
  }

  async getTableDefinition(schema: string, name: string): Promise<string> {
    const db = this.connection();
    const table = objectSql(db, schema, "table", name);
    const extra = (db.prepare(
      `SELECT sql FROM ${quoteIdentifier(sqliteDescriptor, schema)}.sqlite_schema
       WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name`,
    ).all(name) as Row[]).map((row) => String(row.sql));
    return [table, ...extra].map((sql) => `${sql};`).join("\n\n");
  }

  // ─────────────────────────── Execution

  async runQuery(sql: string, limit: number): Promise<QueryResult> {
    return execute(this.connection(), sql, limit);
  }

  async runReadOnlyQuery(sql: string, limit: number): Promise<QueryResult> {
    if (this.location !== MEMORY) {
      this.readOnlyDb ??= this.open(true);
      return execute(this.readOnlyDb, sql, limit);
    }
    // `:memory:` não tem segunda conexão para o mesmo banco: usa query_only e
    // impede que a própria instrução o desligue.
    if (/^\s*(?:pragma|attach|detach)\b/i.test(sql)) {
      throw new AdapterError("unsupported", "PRAGMA, ATTACH and DETACH are not allowed in read-only mode");
    }
    const db = this.connection();
    db.exec("PRAGMA query_only = ON");
    try {
      return execute(db, sql, limit);
    } finally {
      db.exec("PRAGMA query_only = OFF");
    }
  }

  async *streamQuery(sql: string, options: QueryStreamOptions): AsyncIterable<QueryBatch> {
    if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10_000) {
      throw new Error("stream batch size must be between 1 and 10000");
    }
    const statement = prepareForRows(this.connection(), sql);
    const iterator = statement.iterate() as Iterator<unknown[]>;
    let columns: QueryBatch["columns"] = statement.columns().map((column) => ({
      name: column.name,
      dataType: column.type ?? "unknown",
      nullable: true,
    }));
    let emittedRows = false;
    try {
      while (true) {
        if (options.signal.aborted) throw new Error("analytical source query cancelled");
        const rows: unknown[][] = [];
        let done = false;
        while (rows.length < options.batchSize) {
          const next = iterator.next();
          if (next.done) { done = true; break; }
          rows.push(next.value);
        }
        if (!emittedRows) columns = withInferredTypes(columns, rows);
        if (rows.length > 0 || !emittedRows) {
          yield { columns, rows: rows.map(normalizeRow) };
          emittedRows = true;
        }
        if (done) return;
        // Devolve o event loop entre lotes; o consumidor pode abortar aqui.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      iterator.return?.();
    }
  }

  async explain(sql: string): Promise<ExplainResult> {
    const rows = (this.connection().prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Row[])
      .map((row) => ({ id: Number(row.id), parent: Number(row.parent), detail: String(row.detail) }));
    return { textual: renderPlan(rows), format: "text", raw: rows };
  }

  async validateQuery(sql: string) {
    // `prepare` compila sem executar: pega sintaxe e objetos inexistentes.
    try {
      this.connection().prepare(sql);
      return [];
    } catch (e) {
      return [databaseDiagnostic(sql, e, this.dialect)] as const;
    }
  }

  async updateRow(spec: RowUpdateSpec): Promise<number> {
    const setEntries = Object.entries(spec.set);
    const whereEntries = Object.entries(spec.where);
    if (setEntries.length === 0) throw new Error("updateRow: no columns to update");
    if (whereEntries.length === 0) throw new Error("updateRow: missing primary key predicate");
    const q = (name: string) => quoteIdentifier(sqliteDescriptor, name);
    const sql = `UPDATE ${tableTarget(spec.schema, spec.table)} SET ${setEntries.map(([column]) => `${q(column)} = ?`).join(", ")}`
      + ` WHERE ${whereEntries.map(([column, value]) => (value === null ? `${q(column)} IS NULL` : `${q(column)} = ?`)).join(" AND ")}`;
    const params = [
      ...setEntries.map(([, value]) => bindValue(value)),
      ...whereEntries.filter(([, value]) => value !== null).map(([, value]) => bindValue(value)),
    ];
    return Number(this.connection().prepare(sql).run(...params).changes);
  }

  async insertRow(spec: RowInsertSpec): Promise<number> {
    const entries = Object.entries(spec.values);
    const target = tableTarget(spec.schema, spec.table);
    const statement = entries.length === 0
      ? this.connection().prepare(`INSERT INTO ${target} DEFAULT VALUES`)
      : this.connection().prepare(
          `INSERT INTO ${target} (${entries.map(([column]) => quoteIdentifier(sqliteDescriptor, column)).join(", ")})`
          + ` VALUES (${entries.map(() => "?").join(", ")})`,
        );
    return Number(statement.run(...entries.map(([, value]) => bindValue(value))).changes);
  }

  dialectDescriptor() {
    return sqliteDescriptor;
  }
}

// ─────────────────────────── Helpers

/**
 * Falha de arquivo com texto fixo (sem o caminho), marcada com `code` para o
 * backend poder mostrá-la ao usuário em vez de "Internal error".
 */
class SqliteFileError extends AdapterError {
  readonly code = "ERR_SQLITE_FILE";
  constructor(message: string) {
    super("network", message);
  }
}

/** Normaliza o endpoint (`/path/app.db`, `sqlite:///path/app.db`, `:memory:`). */
export function resolveSqlitePath(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/^sqlite:(?:\/\/)?/i, "");
  if (trimmed === MEMORY) return MEMORY;
  if (trimmed.length === 0) throw new AdapterError("unsupported", "SQLite file path is required");
  if (!isAbsolute(trimmed)) throw new AdapterError("unsupported", "SQLite file path must be absolute");
  return trimmed;
}

function tableTarget(schema: string | null, table: string): string {
  const q = (name: string) => quoteIdentifier(sqliteDescriptor, name);
  return schema ? `${q(schema)}.${q(table)}` : q(table);
}

function objectSql(db: DatabaseSync, schema: string, type: "table" | "view", name: string): string {
  const row = db.prepare(
    `SELECT sql FROM ${quoteIdentifier(sqliteDescriptor, schema)}.sqlite_schema WHERE type = ? AND name = ?`,
  ).get(type, name) as Row | undefined;
  if (!row || row.sql === null) throw new Error(`${type} not found: ${schema}.${name}`);
  return String(row.sql);
}

function primaryKeyColumns(db: DatabaseSync, schema: string, table: string): string[] {
  return (db.prepare("SELECT name FROM pragma_table_xinfo(?, ?) WHERE pk > 0 ORDER BY pk").all(table, schema) as Row[])
    .map((row) => String(row.name));
}

function introspectSchema(db: DatabaseSync, schema: string): Relation[] {
  const objects = db.prepare(
    `SELECT name, type FROM ${quoteIdentifier(sqliteDescriptor, schema)}.sqlite_schema
     WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`,
  ).all() as Row[];
  return objects.map((object) => introspectRelation(db, schema, String(object.name), object.type === "view" ? "view" : "table"));
}

function introspectRelation(db: DatabaseSync, schema: string, name: string, kind: Relation["kind"]): Relation {
  // hidden = 1 são colunas ocultas de tabela virtual; 2/3 são colunas geradas.
  const columnRows = db.prepare("SELECT * FROM pragma_table_xinfo(?, ?) WHERE hidden <> 1 ORDER BY cid").all(name, schema) as Row[];
  const foreignKeys = kind === "table"
    ? db.prepare("SELECT * FROM pragma_foreign_key_list(?, ?) ORDER BY id, seq").all(name, schema) as Row[]
    : [];

  const constraints: Constraint[] = [];
  const pk = columnRows.filter((row) => Number(row.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((row) => String(row.name));
  if (pk.length > 0) constraints.push({ name: `pk_${name}`, kind: "primary", columns: pk });

  const fkTargets = new Map<string, { table: string; column: string }>();
  const fkGroups = new Map<number, Row[]>();
  for (const fk of foreignKeys) {
    const id = Number(fk.id);
    if (!fkGroups.has(id)) fkGroups.set(id, []);
    fkGroups.get(id)!.push(fk);
  }
  for (const [id, rows] of fkGroups) {
    const parent = String(rows[0]!.table);
    // `REFERENCES parent` sem coluna aponta para a PK do pai.
    const parentPk = rows.some((row) => row.to === null) ? primaryKeyColumns(db, schema, parent) : [];
    const targets = rows.map((row, i) => (row.to === null ? parentPk[i] ?? "rowid" : String(row.to)));
    rows.forEach((row, i) => fkTargets.set(String(row.from), { table: parent, column: targets[i]! }));
    constraints.push({
      name: `fk_${name}_${id}`,
      kind: "foreign",
      columns: rows.map((row) => String(row.from)),
      references: { schema, table: parent, column: targets[0]! },
    });
  }

  if (kind === "table") {
    for (const index of db.prepare("SELECT name FROM pragma_index_list(?, ?) WHERE origin = 'u' ORDER BY seq").all(name, schema) as Row[]) {
      const columns = (db.prepare("SELECT name FROM pragma_index_info(?, ?) ORDER BY seqno").all(String(index.name), schema) as Row[])
        .map((row) => String(row.name));
      constraints.push({ name: String(index.name), kind: "unique", columns });
    }
  }

  const columns: Column[] = columnRows.map((row, i) => {
    const target = fkTargets.get(String(row.name));
    return {
      name: String(row.name),
      dataType: String(row.type ?? "") || "any",
      nullable: Number(row.notnull) === 0,
      isPrimaryKey: Number(row.pk) > 0,
      ordinalPosition: i + 1,
      ...(row.dflt_value !== null && row.dflt_value !== undefined ? { defaultValue: String(row.dflt_value) } : {}),
      ...(target ? { foreignKeyTo: { schema, table: target.table, column: target.column } } : {}),
    };
  });

  return { schema, name, kind, columns, constraints };
}

function prepareForRows(db: DatabaseSync, sql: string): StatementSync {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  return statement;
}

function execute(db: DatabaseSync, sql: string, limit: number): QueryResult {
  const t0 = Date.now();
  const statement = prepareForRows(db, sql);
  const declared = statement.columns();
  if (declared.length === 0) {
    const result = statement.run();
    return { columns: [], rows: [], rowsAffected: Number(result.changes), rowsMoreAvailable: false, elapsedMs: Date.now() - t0 };
  }
  const rows: unknown[][] = [];
  let more = false;
  const iterator = statement.iterate() as Iterator<unknown[]>;
  try {
    while (true) {
      const next = iterator.next();
      if (next.done) break;
      if (rows.length >= limit) { more = true; break; }
      rows.push(next.value);
    }
  } finally {
    iterator.return?.();
  }
  const columns = withInferredTypes(
    declared.map((column) => ({ name: column.name, dataType: column.type ?? "unknown", nullable: true })),
    rows,
  );
  return { columns, rows: rows.map(normalizeRow), rowsMoreAvailable: more, elapsedMs: Date.now() - t0 };
}

/**
 * Expressões não têm tipo declarado; usa a classe de armazenamento da primeira
 * linha não nula. Recebe valores crus: com `setReadBigInts`, INTEGER chega como
 * bigint e REAL como number, mesmo quando o REAL é inteiro (`101.0`).
 */
function withInferredTypes(columns: readonly QueryResultColumn[], rows: readonly unknown[][]): QueryResultColumn[] {
  return columns.map((column, i) => {
    if (column.dataType !== "unknown") return column;
    const sample = rows.find((row) => row[i] !== null && row[i] !== undefined)?.[i];
    return { ...column, dataType: storageClass(sample) };
  });
}

function storageClass(value: unknown): string {
  if (typeof value === "bigint") return "integer";
  if (typeof value === "number") return "real";
  if (typeof value === "string") return "text";
  if (value instanceof Uint8Array) return "blob";
  return "unknown";
}

function normalizeRow(row: unknown[]): unknown[] {
  return row.map(normalizeValue);
}

/** Valores que o JSON-RPC serializa sem perda: bigint grande vira texto, BLOB vira hex. */
function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString("hex")}`;
  return value;
}

function bindValue(value: unknown): null | number | bigint | string | Uint8Array {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string" || value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function renderPlan(rows: readonly { id: number; parent: number; detail: string }[]): string {
  const children = new Map<number, typeof rows[number][]>();
  for (const row of rows) {
    if (!children.has(row.parent)) children.set(row.parent, []);
    children.get(row.parent)!.push(row);
  }
  const lines: string[] = [];
  const walk = (parent: number, depth: number) => {
    for (const row of children.get(parent) ?? []) {
      lines.push(`${"  ".repeat(depth)}${depth > 0 ? "└─ " : ""}${row.detail}`);
      walk(row.id, depth + 1);
    }
  };
  walk(0, 0);
  return lines.join("\n");
}
