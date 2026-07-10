/**
 * Cache de metadados unificado (Fase 1).
 *
 * Persistência: SQLite via `node:sqlite` (built-in no Node 22+, sem deps
 * nativas). Path default em `<userData>/omni-sql/metadata.db` (o backend
 * resolve o path do OS host).
 *
 * Princípios:
 *   • Throws erros de IO/sqlLogo — quem chama decide que classe lançar.
 *   • Escritas transacionais: ou toda a introspecção de uma conexão entra,
 *     ou nada (aneanhum cache antigo é corrompido pelo meio do caminho).
 *   • last_synced_at por entidade — prepara refresh incremental sem custo
 *     retrofit (Fase 9 ou pedida do usuário "atualizar schema").
 *   • Lookups (getColumnsByTable/etc) vão sempre ao índice em memória —
 *     nunca bate SQLite a cada keystroke de autocomplete. Reload só em boot
 *     ou `refresh()`.
 *
 * Estrutura (parcialmente desnormalizada por pragmatismo do autocomplete):
 *   connections(id PK, label, dialect, endpoint, user, options_json,
 *               password_slot, last_synced_at)
 *   schemas  (id PK, connection_id FK, name, last_synced_at,
 *             UNIQUE(connection_id, name))
 *   relations(id PK, schema_id FK, name, kind, columns_json,
 *              constraints_json, last_synced_at, UNIQUE(schema_id, name))
 *   functions(id PK, schema_id FK, name, overloads_json, last_synced_at,
 *              UNIQUE(schema_id, name))
 */
import { DatabaseSync } from "node:sqlite";
import type {
  Column,
  ConnectionConfig,
  Constraint,
  FunctionDef,
  FunctionOverload,
  Relation,
  Schema,
} from "@omni-sql/ts-types";

// ─────────────────────────── DDL

const DDL = `
CREATE TABLE IF NOT EXISTS connections (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  dialect         TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  user            TEXT NOT NULL,
  options_json    TEXT,
  password_slot   TEXT,
  last_synced_at  INTEGER,
  schemas_json    TEXT
);

CREATE TABLE IF NOT EXISTS schemas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id   TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  last_synced_at  INTEGER,
  UNIQUE(connection_id, name)
);

CREATE TABLE IF NOT EXISTS relations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_id       INTEGER NOT NULL REFERENCES schemas(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK(kind IN ('table','view')),
  columns_json     TEXT NOT NULL,
  constraints_json TEXT NOT NULL,
  last_synced_at  INTEGER,
  UNIQUE(schema_id, name)
);

CREATE TABLE IF NOT EXISTS functions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_id       INTEGER NOT NULL REFERENCES schemas(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  overloads_json  TEXT NOT NULL,
  last_synced_at  INTEGER,
  UNIQUE(schema_id, name)
);

CREATE INDEX IF NOT EXISTS idx_relations_schema ON relations(schema_id);
CREATE INDEX IF NOT EXISTS idx_functions_schema  ON functions(schema_id);
`;

// ─────────────────────────── In-memory index

interface MemConnection {
  config: Omit<ConnectionConfig, "passwordSlot">;
  passwordSlot?: string;
  lastSyncedAt?: number;
  /** Map<schemaName, Map<relationName, Row>> */
  schemas: Map<string, MemSchema>;
}

interface MemSchema {
  relations: Map<string, Relation>;
  functions: Map<string, FunctionDef>;
  lastSyncedAt?: number;
}

// ─────────────────────────── Cache facade

export class MetadataCache {
  private readonly db: DatabaseSync;
  /** Map<connectionId, MemConnection> */
  private readonly conns = new Map<string, MemConnection>();

  static open(path: string): MetadataCache {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(DDL);
    // `CREATE TABLE IF NOT EXISTS` não adiciona colunas a bancos já
    // existentes no disco do usuário — migração defensiva para quem tinha
    // metadata.db criado antes do campo `schemas` existir.
    try {
      db.exec("ALTER TABLE connections ADD COLUMN schemas_json TEXT;");
    } catch {
      // coluna já existe.
    }
    return new MetadataCache(db);
  }

  private constructor(db: DatabaseSync) {
    this.db = db;
    this.reindex();
  }

  close(): void {
    this.db.close();
  }

  // ─────────────────────────── Bootstrap reload

  private reindex(): void {
    const connStmt = this.db.prepare(
      "SELECT id, label, dialect, endpoint, user, options_json, password_slot, last_synced_at, schemas_json FROM connections",
    );
    for (const c of connStmt.all() as Array<{
      id: string; label: string; dialect: string; endpoint: string;
      user: string; options_json: string | null; password_slot: string | null;
      last_synced_at: number | null; schemas_json: string | null;
    }>) {
      const mem: MemConnection = {
        config: {
          id: c.id, label: c.label, dialect: c.dialect as ConnectionConfig["dialect"],
          endpoint: c.endpoint, user: c.user,
          options: c.options_json ? JSON.parse(c.options_json) : undefined,
          schemas: c.schemas_json ? JSON.parse(c.schemas_json) : undefined,
        },
        passwordSlot: c.password_slot ?? undefined,
        lastSyncedAt: c.last_synced_at ?? undefined,
        schemas: new Map(),
      };
      this.conns.set(c.id, mem);
      this.reloadSchemas(mem);
    }
  }

  private reloadSchemas(conn: MemConnection): void {
    const schemaStmt = this.db.prepare(
      "SELECT id, name, last_synced_at FROM schemas WHERE connection_id = ?",
    );
    const relStmt = this.db.prepare(
      `SELECT name, kind, columns_json, constraints_json, last_synced_at
       FROM relations WHERE schema_id = ?`,
    );
    const fnStmt = this.db.prepare(
      `SELECT name, overloads_json, last_synced_at FROM functions WHERE schema_id = ?`,
    );
    const schemas = schemaStmt.all(conn.config.id) as Array<{
      id: number; name: string; last_synced_at: number | null;
    }>;
    for (const s of schemas) {
      const memSchema: MemSchema = {
        relations: new Map(),
        functions: new Map(),
        lastSyncedAt: s.last_synced_at ?? undefined,
      };
      conn.schemas.set(s.name, memSchema);
      for (const r of relStmt.all(s.id) as Array<{
        name: string; kind: string;
        columns_json: string; constraints_json: string;
        last_synced_at: number | null;
      }>) {
        const cols = JSON.parse(r.columns_json) as Column[];
        const cons = JSON.parse(r.constraints_json) as Constraint[];
        memSchema.relations.set(r.name, {
          schema: s.name,
          name: r.name,
          kind: r.kind as "table" | "view",
          columns: cols,
          constraints: cons,
          lastSyncedAt: r.last_synced_at ?? undefined,
        });
      }
      for (const f of fnStmt.all(s.id) as Array<{
        name: string; overloads_json: string; last_synced_at: number | null;
      }>) {
        const overloads = JSON.parse(f.overloads_json) as FunctionOverload[];
        memSchema.functions.set(f.name, {
          schema: s.name,
          name: f.name,
          overloads,
          lastSyncedAt: f.last_synced_at ?? undefined,
        });
      }
    }
  }

  // ─────────────────────────── Connection ops

  upsertConnection(config: ConnectionConfig): void {
    const sql = `
      INSERT INTO connections (id, label, dialect, endpoint, user, options_json, password_slot, schemas_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        dialect = excluded.dialect,
        endpoint = excluded.endpoint,
        user    = excluded.user,
        options_json = excluded.options_json,
        password_slot = COALESCE(excluded.password_slot, connections.password_slot),
        schemas_json = excluded.schemas_json
    `;
    this.db
      .prepare(sql)
      .run(
        config.id,
        config.label,
        config.dialect,
        config.endpoint,
        config.user,
        config.options ? JSON.stringify(config.options) : null,
        config.passwordSlot ?? null,
        config.schemas && config.schemas.length > 0 ? JSON.stringify(config.schemas) : null,
      );
    // Atualiza o espelho em memória. Numa edição (`existing` já presente)
    // o objeto `config` antigo precisa ser substituído pelo novo — antes só
    // era criado na primeira inserção, então mudanças (schemas, label,
    // endpoint...) escritas com sucesso no SQLite só apareciam de fato
    // depois de reiniciar o processo (reindex() relendo do banco do zero).
    const existing = this.conns.get(config.id);
    const mem: MemConnection = {
      config: { ...config, passwordSlot: undefined as never } as Omit<ConnectionConfig, "passwordSlot">,
      passwordSlot: config.passwordSlot ?? existing?.passwordSlot,
      lastSyncedAt: existing?.lastSyncedAt,
      schemas: existing?.schemas ?? new Map(),
    };
    this.conns.set(config.id, mem);
    this.reloadSchemas(mem);
  }

  removeConnection(connectionId: string): void {
    // Cascade remove rows; reindex drops mem block.
    this.db.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);
    this.conns.delete(connectionId);
  }

  listConnections(): Array<Omit<ConnectionConfig, "passwordSlot">> {
    return [...this.conns.values()].map((m) => m.config);
  }

  getConnection(id: string): Omit<ConnectionConfig, "passwordSlot"> | undefined {
    return this.conns.get(id)?.config;
  }

  getPasswordSlot(id: string): string | undefined {
    return this.conns.get(id)?.passwordSlot;
  }

  // ─────────────────────────── Introspection ingest

  /**
   * Replaces all metadata for `connectionId` atomically.
   * `schemas`: relations + functions já resolvidos do adaptador.
   */
  ingestIntrospection(
    connectionId: string,
    schemas: ReadonlyArray<{
      name: string;
      relations: readonly Relation[];
      functions: readonly FunctionDef[];
    }>,
    syncedAt: number = Date.now(),
  ): void {
    this.db.exec("BEGIN");
    try {
      // Limpa schemas antigos desta conexão (cascade deleta relations/functions).
      this.db.prepare("DELETE FROM schemas WHERE connection_id = ?").run(connectionId);
      const schemaStmt = this.db.prepare(
        `INSERT INTO schemas (connection_id, name, last_synced_at) VALUES (?, ?, ?)`,
      );
      const relStmt = this.db.prepare(
        `INSERT INTO relations
         (schema_id, name, kind, columns_json, constraints_json, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const fnStmt = this.db.prepare(
        `INSERT INTO functions
         (schema_id, name, overloads_json, last_synced_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const s of schemas) {
        schemaStmt.run(connectionId, s.name, syncedAt);
        const schemaRow = this.db.prepare(
          "SELECT id FROM schemas WHERE connection_id = ? AND name = ?",
        ).get(connectionId, s.name) as { id: number };
        for (const r of s.relations) {
          relStmt.run(
            schemaRow.id,
            r.name,
            r.kind,
            JSON.stringify(r.columns),
            JSON.stringify(r.constraints),
            syncedAt,
          );
        }
        for (const f of s.functions) {
          fnStmt.run(
            schemaRow.id,
            f.name,
            JSON.stringify(f.overloads),
            syncedAt,
          );
        }
      }
      this.db
        .prepare("UPDATE connections SET last_synced_at = ? WHERE id = ?")
        .run(syncedAt, connectionId);
      this.db.exec("COMMIT");
      // Reindex só esta conexão
      const mem = this.conns.get(connectionId);
      if (!mem) {
        // Sem config ainda — não-reindexável agora; upsertConnection resolve.
        return;
      }
      mem.lastSyncedAt = syncedAt;
      this.reloadSchemas(mem);
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  lastSyncedAt(
    connectionId: string,
    kind: "connection" | "schema" | "relation" | "function",
    name?: string,
  ): number | undefined {
    const conn = this.conns.get(connectionId);
    if (!conn) return undefined;
    if (kind === "connection") return conn.lastSyncedAt;
    if (kind === "schema") return conn.schemas.get(name ?? "")?.lastSyncedAt;
    if (kind === "relation") {
      const [schema, ...rest] = (name ?? "").split(".");
      if (!schema || rest.length === 0) return undefined;
      const rel = conn.schemas.get(schema)?.relations.get(rest.join("."));
      return rel?.lastSyncedAt;
    }
    if (kind === "function") {
      const [schema, ...rest] = (name ?? "").split(".");
      if (!schema || rest.length === 0) return undefined;
      const fn = conn.schemas.get(schema)?.functions.get(rest.join("."));
      return fn?.lastSyncedAt;
    }
    return undefined;
  }

  // ─────────────────────────── Lookups (in-memory; <2ms target)

  listSchemas(connectionId: string): Schema[] {
    const conn = this.conns.get(connectionId);
    if (!conn) return [];
    return [...conn.schemas.keys()].map((name) => ({
      database: connectionId,
      name,
    }));
  }

  getTablesBySchema(connectionId: string, schema: string): Relation[] {
    const conn = this.conns.get(connectionId);
    if (!conn) return [];
    const s = conn.schemas.get(schema);
    if (!s) return [];
    return [...s.relations.values()];
  }

  getColumnsByTable(
    connectionId: string,
    schema: string,
    table: string,
  ): Column[] {
    const conn = this.conns.get(connectionId);
    if (!conn) return [];
    const r = conn.schemas.get(schema)?.relations.get(table);
    return r ? [...r.columns] : [];
  }

  /**
   * Tabelas que apontam FK para `(schema, table)` — relevante para
   * ordenação por relevância do autocomplete (Fase 9).
   */
  getForeignKeysTo(
    connectionId: string,
    schema: string,
    table: string,
  ): Relation[] {
    const conn = this.conns.get(connectionId);
    if (!conn) return [];
    const out: Relation[] = [];
    for (const s of conn.schemas.values()) {
      for (const r of s.relations.values()) {
        for (const c of r.constraints) {
          if (
            c.kind === "foreign" &&
            c.references?.schema === schema &&
            c.references?.table === table
          ) {
            out.push(r);
            break;
          }
        }
      }
    }
    return out;
  }

  getFunctions(
    connectionId: string,
    schema?: string,
  ): FunctionDef[] {
    const conn = this.conns.get(connectionId);
    if (!conn) return [];
    const target = schema ? [schema] : [...conn.schemas.keys()];
    const out: FunctionDef[] = [];
    for (const name of target) {
      const s = conn.schemas.get(name);
      if (s) out.push(...s.functions.values());
    }
    return out;
  }
}