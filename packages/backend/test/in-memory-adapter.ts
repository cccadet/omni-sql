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
import {
  dialectDescriptor,
  type DialectDescriptor,
} from "@omni-sql/dialect-descriptors";
import type { Adapter, TestResult } from "@omni-sql/adapters-core";

/**
 * Adaptador in-memory para smoke tests E2E: sem dependência externa,
 * sem banco real. Suporta SELECT 1, SELECT * FROM users e introspecção
 * sintética — suficiente para exercitar o pipeline JSON-RPC.
 */
export interface InMemorySchema {
  schema: string;
  tables: Array<{
    name: string;
    kind: "table" | "view";
    columns: Array<{
      name: string;
      dataType: string;
      nullable: boolean;
      isPrimaryKey: boolean;
      ordinal: number;
    }>;
  }>;
}

const SAMPLE_SCHEMA: InMemorySchema = {
  schema: "public",
  tables: [
    {
      name: "users",
      kind: "table",
      columns: [
        { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinal: 0 },
        { name: "name", dataType: "text", nullable: false, isPrimaryKey: false, ordinal: 1 },
        { name: "email", dataType: "text", nullable: true, isPrimaryKey: false, ordinal: 2 },
      ],
    },
    {
      name: "orders",
      kind: "table",
      columns: [
        { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinal: 0 },
        { name: "user_id", dataType: "integer", nullable: false, isPrimaryKey: false, ordinal: 1 },
        { name: "total", dataType: "numeric", nullable: false, isPrimaryKey: false, ordinal: 2 },
      ],
    },
  ],
};

export class InMemoryAdapter implements Adapter {
  readonly id: string;
  readonly dialect: ConnectionConfig["dialect"];
  private connected = false;
  private readonly schemas: InMemorySchema[];
  private readonly testResult: TestResult;

  constructor(
    config: ConnectionConfig,
    schemas: InMemorySchema[] = [SAMPLE_SCHEMA],
  ) {
    this.id = config.id;
    this.dialect = config.dialect;
    this.schemas = schemas;
    this.testResult = config.endpoint === "memory://unavailable"
      ? { ok: false, latencyMs: 0, message: "database unavailable" }
      : { ok: true, latencyMs: 0 };
  }

  async connect(): Promise<void> {
    this.connected = true;
  }
  async close(): Promise<void> {
    this.connected = false;
  }
  async test(): Promise<TestResult> {
    this.connected = true;
    return this.testResult;
  }

  async introspect(): Promise<Database> {
    this.assertConnected();
    return {
      connectionId: this.id,
      name: "in-memory",
      schemas: this.schemas.map((s) => ({ database: "in-memory", name: s.schema })),
    };
  }

  async listAvailableSchemas(): Promise<readonly string[]> {
    return this.schemas.map((s) => s.schema);
  }

  listSchemas(): readonly Schema[] {
    return this.schemas.map((s) => ({ database: "in-memory", name: s.schema }));
  }
  listTables(schema: string): readonly Relation[] {
    const s = this.lookup(schema);
    if (!s) return [];
    return s.tables.map((t) => ({
      schema: s.schema,
      name: t.name,
      kind: t.kind,
      columns: t.columns.map((c) => ({
        name: c.name,
        dataType: c.dataType,
        nullable: c.nullable,
        isPrimaryKey: c.isPrimaryKey,
        ordinalPosition: c.ordinal,
      })),
      constraints: [],
    }));
  }
  listColumns(schema: string, table: string): Relation["columns"] {
    const rel = this.listTables(schema).find((t) => t.name === table);
    return rel ? rel.columns : [];
  }
  listFunctions(_schema: string): readonly FunctionDef[] {
    return [];
  }

  lastRunLimit: number | undefined;

  async runQuery(sql: string, limit: number): Promise<QueryResult> {
    this.assertConnected();
    this.lastRunLimit = limit;
    const trimmed = sql.trim();
    if (/^select\s+\d+\s*;?\s*$/i.test(trimmed)) {
      const value = Number(trimmed.replace(/^select\s+/i, "").replace(/[;\s]+$/, ""));
      return {
        columns: [{ name: "?column?", dataType: "integer", nullable: false }],
        rows: [[value]],
        rowsMoreAvailable: false,
        elapsedMs: 0,
      };
    }
    if (/^select\s+\*\s+from\s+users\s*;?\s*$/i.test(trimmed)) {
      return {
        columns: SAMPLE_SCHEMA.tables[0]!.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          nullable: c.nullable,
        })),
        rows: [
          [1, "Ada", "ada@local"],
          [2, "Linus", null],
        ],
        rowsMoreAvailable: false,
        elapsedMs: 0,
      };
    }
    throw new Error(`InMemoryAdapter: query não suportada: ${sql.slice(0, 64)}`);
  }

  async explain(sql: string): Promise<ExplainResult> {
    return { textual: `(in-memory) ${sql}`, format: "text", raw: null };
  }

  async listIndexes(_schema: string, _table: string): Promise<readonly IndexInfo[]> {
    return [];
  }

  async getDefinition(kind: "view" | "function", schema: string, name: string): Promise<string> {
    throw new Error(`InMemoryAdapter: definição de ${kind} não suportada (dados sintéticos): ${schema}.${name}`);
  }

  async updateRow(): Promise<number> {
    throw new Error("InMemoryAdapter: edição de linhas não suportada (dados sintéticos, sem storage real).");
  }

  dialectDescriptor(): DialectDescriptor {
    return dialectDescriptor(this.dialect === "postgres" ? "postgres" : "jdbc-generic");
  }

  private lookup(schema: string): InMemorySchema | undefined {
    return this.schemas.find((s) => s.schema === schema);
  }
  private assertConnected(): void {
    if (!this.connected) throw new Error("InMemoryAdapter: connect() não chamado.");
  }
}
