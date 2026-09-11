import odbc from "odbc";
import type { ConnectionConfig, ExplainResult, FunctionDef, IndexInfo, QueryResult, Relation } from "@omni-sql/ts-types";
import { odbcDescriptor } from "@omni-sql/dialect-descriptors";
import { AdapterError, CachedAdapter, type Adapter, type RowInsertSpec, type RowUpdateSpec, type TestResult } from "@omni-sql/adapters-core";

type OdbcConnection = odbc.Connection;
type OdbcResult = odbc.Result<Record<string, unknown>>;
type OdbcConnector = Pick<typeof odbc, "connect">;

interface TableRef { catalog: string | null; schema: string | null; displaySchema: string; name: string; kind: "table" | "view"; }

export class OdbcAdapter extends CachedAdapter implements Adapter {
  readonly dialect = "odbc" as const;
  private connection: OdbcConnection | null = null;
  private connecting?: Promise<OdbcConnection>;
  private readonly connectionString: string;
  private readonly timeout: number;
  private readonly driver: OdbcConnector;

  constructor(config: ConnectionConfig, password?: string, driver: OdbcConnector = odbc) {
    super(config);
    if (!config.endpoint.trim()) throw new AdapterError("credentials", "ODBC requer um DSN ou connection string");
    this.connectionString = buildOdbcConnectionString(config.endpoint, config.user, password);
    this.timeout = positiveInteger(config.options?.timeout, 30);
    this.driver = driver;
  }

  async connect(): Promise<void> { await this.getConnection(); }
  async close(): Promise<void> {
    if (this.connecting) await this.connecting.catch(() => undefined);
    const connection = this.connection;
    this.connection = null;
    if (connection) await connection.close();
  }
  async test(): Promise<TestResult> {
    const started = Date.now();
    try { await this.connect(); return { ok: true, latencyMs: Date.now() - started }; }
    catch (error) { return { ok: false, latencyMs: Date.now() - started, message: safeOdbcMessage(error) }; }
  }

  async listAvailableSchemas(): Promise<readonly string[]> {
    const refs = await this.tableRefs();
    return [...new Set(refs.map((item) => item.displaySchema))].sort(compareStrings);
  }
  protected databaseName(): string { return "odbc"; }
  protected async introspectSchemas(): Promise<readonly (readonly [unknown, string, readonly Relation[]])[]> {
    const connection = await this.getConnection();
    const refs = (await this.tableRefs()).filter((ref) => !this.schemaFilter?.length || this.schemaFilter.includes(ref.displaySchema));
    const grouped = new Map<string, Relation[]>();
    for (const ref of refs) {
      const [columnRows, primaryKeyRows] = await Promise.all([
        connection.columns<Record<string, unknown>>(ref.catalog, ref.schema, ref.name, null),
        connection.primaryKeys<Record<string, unknown>>(ref.catalog, ref.schema, ref.name).catch(() => emptyResult()),
      ]);
      const primaryKeys = new Set(primaryKeyRows.map((row) => textField(row, "COLUMN_NAME")));
      const columns = columnRows.map((row, index) => ({
        name: textField(row, "COLUMN_NAME") || `column_${index + 1}`,
        dataType: textField(row, "TYPE_NAME") || textField(row, "DATA_TYPE") || "UNKNOWN",
        nullable: numberField(row, "NULLABLE", 1) !== 0,
        isPrimaryKey: primaryKeys.has(textField(row, "COLUMN_NAME")),
        ordinalPosition: numberField(row, "ORDINAL_POSITION", index + 1),
      })).sort((left, right) => left.ordinalPosition - right.ordinalPosition);
      const relation: Relation = { schema: ref.displaySchema, name: ref.name, kind: ref.kind, columns, constraints: [] };
      grouped.set(ref.displaySchema, [...(grouped.get(ref.displaySchema) ?? []), relation]);
    }
    return [...grouped.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([schema, relations]) => [schema, schema, relations] as const);
  }
  protected async listFunctionsForSchema(_schema: string): Promise<readonly FunctionDef[]> { return []; }

  async runQuery(sql: string, limit: number): Promise<QueryResult> {
    const started = Date.now();
    try {
      const connection = await this.getConnection();
      const cursor = await connection.query(sql, { cursor: true, fetchSize: limit + 1, timeout: this.timeout });
      try {
        const result = await cursor.fetch<Record<string, unknown>>();
        const rows = result.slice(0, limit).map((row) => result.columns.map((column) => jsonSafe(row[column.name])));
        return {
          columns: result.columns.map((column) => ({ name: column.name, dataType: column.dataTypeName || String(column.dataType), nullable: column.nullable })),
          rows,
          rowsAffected: result.count >= 0 ? result.count : undefined,
          rowsMoreAvailable: result.length > limit || !cursor.noData,
          elapsedMs: Date.now() - started,
        };
      } finally { await cursor.close().catch(() => undefined); }
    } catch (error) { throw classifyOdbcError(error); }
  }

  async explain(_sql: string): Promise<ExplainResult> { throw new AdapterError("unsupported", "EXPLAIN não é portável via ODBC"); }
  async listIndexes(_schema: string, _table: string): Promise<readonly IndexInfo[]> { return []; }
  async getDefinition(_kind: "view" | "function", _schema: string, _name: string): Promise<string> { throw new AdapterError("unsupported", "definição de objetos não é portável via ODBC"); }
  async updateRow(_spec: RowUpdateSpec): Promise<number> { throw new AdapterError("unsupported", "edição de célula ainda não é suportada via ODBC"); }
  async insertRow(_spec: RowInsertSpec): Promise<number> { throw new AdapterError("unsupported", "inserção de linha ainda não é suportada via ODBC"); }
  dialectDescriptor() { return odbcDescriptor; }

  private async getConnection(): Promise<OdbcConnection> {
    if (this.connection) return this.connection;
    if (!this.connecting) {
      this.connecting = this.driver.connect({ connectionString: this.connectionString, connectionTimeout: this.timeout, loginTimeout: this.timeout })
        .then((connection) => (this.connection = connection))
        .catch((error: unknown) => { throw classifyOdbcError(error); })
        .finally(() => { this.connecting = undefined; });
    }
    return this.connecting;
  }
  private async tableRefs(): Promise<readonly TableRef[]> {
    const rows = await (await this.getConnection()).tables<Record<string, unknown>>(null, null, null, "TABLE,VIEW");
    const seen = new Set<string>();
    const refs: TableRef[] = [];
    for (const row of rows) {
      const name = textField(row, "TABLE_NAME");
      if (!name) continue;
      const catalog = nullableTextField(row, "TABLE_CAT");
      const schema = nullableTextField(row, "TABLE_SCHEM");
      const displaySchema = schema ?? catalog ?? "default";
      const key = `${catalog ?? ""}\0${schema ?? ""}\0${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ catalog, schema, displaySchema, name, kind: textField(row, "TABLE_TYPE").toUpperCase().includes("VIEW") ? "view" : "table" });
    }
    return refs;
  }
}

export function buildOdbcConnectionString(endpoint: string, user: string, password?: string): string {
  const base = endpoint.trim().includes("=") ? endpoint.trim() : `DSN=${odbcValue(endpoint.trim())}`;
  const suffix = [user ? `UID=${odbcValue(user)}` : "", password ? `PWD=${odbcValue(password)}` : ""].filter(Boolean).join(";");
  return `${base.replace(/;+$/u, "")}${suffix ? `;${suffix}` : ""}`;
}
function odbcValue(value: string): string { return `{${value.replaceAll("}", "}}")}}`; }
function field(row: Record<string, unknown>, name: string): unknown { const key = Object.keys(row).find((candidate) => candidate.toUpperCase() === name); return key ? row[key] : undefined; }
function textField(row: Record<string, unknown>, name: string): string { const value = field(row, name); return value === null || value === undefined ? "" : String(value); }
function nullableTextField(row: Record<string, unknown>, name: string): string | null { return textField(row, name).trim() || null; }
function numberField(row: Record<string, unknown>, name: string, fallback: number): number { const value = Number(field(row, name)); return Number.isFinite(value) ? value : fallback; }
function positiveInteger(value: unknown, fallback: number): number { return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback; }
function compareStrings(left: string, right: string): number { return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }); }
function emptyResult(): OdbcResult { const result = [] as unknown as OdbcResult; result.count = 0; result.columns = []; result.statement = ""; result.parameters = []; result.return = 0; return result; }
function jsonSafe(value: unknown): unknown { if (typeof value === "bigint") return value.toString(); if (value instanceof Date) return value.toISOString(); return value; }
function safeOdbcMessage(error: unknown): string { const message = error instanceof Error ? error.message : String(error); return message.replace(/(?:PWD|PASSWORD)\s*=\s*(?:\{(?:[^}]|\}\})*\}|[^;]*)/giu, "PWD=***"); }
function classifyOdbcError(error: unknown): AdapterError {
  const message = safeOdbcMessage(error);
  const states = (error as { odbcErrors?: readonly { state?: string }[] } | null)?.odbcErrors?.map((item) => item.state ?? "") ?? [];
  const state = states.join(" ");
  const tag = /IM002|driver.*not found|data source name not found/iu.test(`${state} ${message}`) ? "driver-missing"
    : /28000|password|login|authentication|credentials/iu.test(`${state} ${message}`) ? "credentials"
    : /HYT00|HYT01|timeout|timed out/iu.test(`${state} ${message}`) ? "timeout"
    : /08\d{3}|network|server|connection/iu.test(`${state} ${message}`) ? "network" : "unsupported";
  return new AdapterError(tag, message, { cause: error });
}
