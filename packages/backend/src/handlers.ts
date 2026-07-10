import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ConnectionConfig, Relation, Database, FunctionDef } from "@omni-sql/ts-types";
import type { Adapter } from "@omni-sql/adapters-core";
import {
  bootstrapDefaultRegistry,
  registerAdapter,
  resolveAdapter,
} from "@omni-sql/adapters-core";
import { PostgresAdapter } from "@omni-sql/adapters-pg";
import { OracleAdapter } from "@omni-sql/adapters-oracle";
import { MysqlAdapter } from "@omni-sql/adapters-mysql";
import { MssqlAdapter } from "@omni-sql/adapters-mssql";
import { dialectDescriptor, quoteIdentifier } from "@omni-sql/dialect-descriptors";
import {
  autocompleteTier1,
  type MetadataSource,
  type ScopeRef,
} from "@omni-sql/autocomplete-engine";
import { MetadataCache } from "@omni-sql/metadata-cache";

import { resolveCteRelations, analyzeQueryEditability } from "./sidecar-client.ts";
import {
  getPassword,
  setPassword,
  deletePassword,
  passwordSlotFor,
} from "./keyring.ts";
import type {
  RpcRouter,
  AddConnectionParams,
  AddConnectionResult,
  ListConnectionsResult,
  TestConnectionParams,
  TestConnectionResult,
  ListSchemasParams,
  ListSchemasResult,
  RunQueryParams,
  RunQueryResult,
  AnalyzeEditabilityParams,
  AnalyzeEditabilityResult,
  UpdateRowParams,
  UpdateRowResult,
  IntrospectParams,
  IntrospectResult,
  ListRelationsParams,
  ListRelationsResult,
  ListFunctionsParams,
  ListFunctionsResult,
  ListIndexesParams,
  ListIndexesResult,
  GetDefinitionParams,
  GetDefinitionResult,
  CompletionParams,
  CompletionResult,
} from "./protocol.ts";

// ─────────────────────────── SQLite cache path

const DB_PATH = process.env.OMNI_SQL_METADATA_DB
  ?? path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "omni-sql",
    "metadata.db",
  );
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
console.log(`[omni-sql] metadata cache at ${DB_PATH}`);

const cache = MetadataCache.open(DB_PATH);

// ─────────────────────────── State

interface Session {
  config: ConnectionConfig;
  adapter: Adapter;
}

const sessions = new Map<string, Session>();

// ─────────────────────────── Registry bootstrap

// Fase 0: tudo via in-memory; Fase 2 troca `postgres` por adaptador real,
// Fase 4 adiciona `oracle` (demais dialetos seguem em-memory por ora).
bootstrapDefaultRegistry();
registerAdapter("postgres", (config, password) => new PostgresAdapter(config, password));
registerAdapter("oracle", (config, password) => new OracleAdapter(config, password));
registerAdapter("mysql", (config, password) => new MysqlAdapter(config, password));
registerAdapter("mariadb", (config, password) => new MysqlAdapter(config, password));
registerAdapter("sqlserver", (config, password) => new MssqlAdapter(config, password));

// ─────────────────────────── Adapter construction

// ─────────────────────────── Boot: restore persisted connections

async function restoreConnections(): Promise<void> {
  for (const cfg of cache.listConnections()) {
    const password = await getPassword(cfg).catch((e) => {
      console.warn(`[omni-sql] keyring failed for ${cfg.id}: ${(e as Error).message}`);
      return undefined;
    });
    try {
      const configWithSlot = { ...cfg, passwordSlot: passwordSlotFor(cfg) };
      const adapter = resolveAdapter(configWithSlot, password);
      sessions.set(cfg.id, { config: configWithSlot, adapter });
      console.log(`[omni-sql] restored connection ${cfg.id} (${cfg.dialect})`);
    } catch (e) {
      console.warn(`[omni-sql] failed to restore ${cfg.id}: ${(e as Error).message}`);
    }
  }
}

void restoreConnections();

// ─────────────────────────── Helpers

function requireSession(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error(`connection not found: ${id}`);
  return s;
}

// Comparação case-insensitive: dialetos diferem no folding de
// identificadores não-citados (Postgres → minúsculas via
// information_schema, Oracle → MAIÚSCULAS via ALL_TAB_COLUMNS), mas o
// usuário (ou o parser Calcite, que não conhece o catálogo) referencia como
// bem entender. Varre todos os schemas em vez de indexar direto porque
// `schema` pode vir `null`/`undefined` (tabela não qualificada).
function resolveRelationByName(
  connectionId: string,
  table: string,
  schema?: string | null,
): Relation | null {
  const t = table.toLowerCase();
  const s = schema?.toLowerCase();
  for (const sch of cache.listSchemas(connectionId)) {
    if (s != null && sch.name.toLowerCase() !== s) continue;
    for (const r of cache.getTablesBySchema(connectionId, sch.name)) {
      if (r.name.toLowerCase() === t && (s == null || r.schema.toLowerCase() === s)) {
        return r;
      }
    }
  }
  return null;
}

// DDL construída a partir dos metadados já cacheados (colunas + PK/FK) — não
// é uma cópia fiel do DDL real (sem índices, checks, storage etc.), mas
// dispensa uma ida ao banco só para visualização rápida da estrutura.
function buildTableDdl(dialect: ConnectionConfig["dialect"], relation: Relation): string {
  const descriptor = dialectDescriptor(dialect);
  const q = (id: string) => quoteIdentifier(descriptor, id);
  const tableRef = `${q(relation.schema)}.${q(relation.name)}`;

  const columnLines = relation.columns
    .slice()
    .sort((a, b) => a.ordinalPosition - b.ordinalPosition)
    .map((c) => {
      const parts = [q(c.name), c.dataType];
      if (!c.nullable) parts.push("NOT NULL");
      if (c.defaultValue !== undefined) parts.push(`DEFAULT ${c.defaultValue}`);
      return `  ${parts.join(" ")}`;
    });

  const constraintLines: string[] = [];
  const pk = relation.constraints.find((c) => c.kind === "primary");
  if (pk) {
    constraintLines.push(`  CONSTRAINT ${q(pk.name)} PRIMARY KEY (${pk.columns.map(q).join(", ")})`);
  }
  for (const fk of relation.constraints.filter((c) => c.kind === "foreign")) {
    const ref = fk.references!;
    constraintLines.push(
      `  CONSTRAINT ${q(fk.name)} FOREIGN KEY (${fk.columns.map(q).join(", ")}) REFERENCES ${q(ref.schema)}.${q(ref.table)} (${q(ref.column)})`,
    );
  }

  return `CREATE TABLE ${tableRef} (\n${[...columnLines, ...constraintLines].join(",\n")}\n);`;
}

function metaSourceOf(session: Session, cteRelations: readonly Relation[] = []): MetadataSource {
  return {
    dialect: dialectDescriptor(session.config.dialect),
    listRelations: (): readonly Relation[] => {
      const out: Relation[] = [];
      for (const s of cache.listSchemas(session.config.id)) {
        out.push(...cache.getTablesBySchema(session.config.id, s.name));
      }
      return out;
    },
    listFunctions: () => cache.getFunctions(session.config.id),
    resolveRelation: (ref: ScopeRef): Relation | null => {
      // CTEs (tier2 via sidecar/Calcite) sombreiam tabelas reais de mesmo
      // nome — mesma regra de resolução de escopo do SQL padrão.
      if (ref.schema == null) {
        const cte = cteRelations.find((r) => r.name.toLowerCase() === ref.table.toLowerCase());
        if (cte) return cte;
      }
      return resolveRelationByName(session.config.id, ref.table, ref.schema);
    },
  };
}

// ─────────────────────────── Handlers

export const handlers: RpcRouter = {
  async "connection.add"({ config, password }: AddConnectionParams): Promise<AddConnectionResult> {
    const configWithSlot: ConnectionConfig = {
      ...config,
      passwordSlot: passwordSlotFor(config),
    };

    if (password !== undefined && password.length > 0) {
      await setPassword(configWithSlot, password);
    }

    // Editar uma conexão existente reenvia senha vazia (o diálogo nunca a
    // preenche de volta) — sem isto, a sessão recém-criada ficaria sem
    // credencial até o próximo restart do backend.
    const effectivePassword =
      password !== undefined && password.length > 0
        ? password
        : await getPassword(configWithSlot).catch(() => undefined);

    const previous = sessions.get(config.id);
    if (previous) await previous.adapter.close().catch(() => undefined);

    const adapter = resolveAdapter(configWithSlot, effectivePassword);
    sessions.set(config.id, { config: configWithSlot, adapter });
    cache.upsertConnection(configWithSlot);
    return { connectionId: config.id, ok: true };
  },

  async "connection.list"(): Promise<ListConnectionsResult> {
    const configs = cache.listConnections().map((c) => ({
      id: c.id,
      label: c.label,
      dialect: c.dialect,
      endpoint: c.endpoint,
      user: c.user,
      options: c.options,
      schemas: c.schemas,
      lastSyncedAt: cache.lastSyncedAt(c.id, "connection"),
    }));
    return { configs };
  },

  async "connection.remove"({ connectionId }): Promise<{ ok: boolean }> {
    const s = sessions.get(connectionId);
    if (s) await s.adapter.close().catch(() => undefined);
    sessions.delete(connectionId);
    cache.removeConnection(connectionId);
    await deletePassword({ id: connectionId }).catch(() => undefined);
    return { ok: true };
  },

  async "connection.test"({ config, password }: TestConnectionParams): Promise<TestConnectionResult> {
    const effectivePassword =
      password !== undefined && password.length > 0
        ? password
        : await getPassword(config).catch(() => undefined);
    const adapter = resolveAdapter(config, effectivePassword);
    try {
      const result = await adapter.test();
      await adapter.close().catch(() => undefined);
      return result;
    } catch (e) {
      await adapter.close().catch(() => undefined);
      return { ok: false, latencyMs: 0, message: (e as Error).message };
    }
  },

  async "connection.listSchemas"({ config, password }: ListSchemasParams): Promise<ListSchemasResult> {
    const effectivePassword =
      password !== undefined && password.length > 0
        ? password
        : await getPassword(config).catch(() => undefined);
    const adapter = resolveAdapter(config, effectivePassword);
    try {
      await adapter.connect();
      const schemas = await adapter.listAvailableSchemas();
      return { schemas };
    } finally {
      await adapter.close().catch(() => undefined);
    }
  },

  async "query.run"({ connectionId, sql, limit }: RunQueryParams): Promise<RunQueryResult> {
    const s = requireSession(connectionId);
    await s.adapter.connect();
    return s.adapter.runQuery(sql, limit ?? 1000);
  },

  async "query.analyzeEditability"({
    connectionId,
    sql,
  }: AnalyzeEditabilityParams): Promise<AnalyzeEditabilityResult> {
    const raw = await analyzeQueryEditability(sql);
    const notEditable = (reason: string): AnalyzeEditabilityResult => ({
      editable: false,
      reason,
      table: null,
      pkColumns: [],
      selectStar: raw.selectStar,
      columns: raw.columns,
    });
    if (!raw.editable || !raw.table) return notEditable(raw.reason ?? "não editável");

    // O sidecar (Calcite) só enxerga sintaxe — a tabela pode nem existir, ou
    // `schema` pode ter vindo `null` (não qualificada na query). Resolvemos
    // contra o metadata-cache real para pegar schema/nome concretos e a PK.
    const relation = resolveRelationByName(connectionId, raw.table.name, raw.table.schema);
    if (!relation) {
      return notEditable("Tabela não encontrada nos metadados (rode a introspecção da conexão).");
    }
    const pkColumns = relation.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    if (pkColumns.length === 0) {
      return notEditable("A tabela não tem chave primária conhecida — edição bloqueada por segurança.");
    }

    return {
      editable: true,
      reason: null,
      table: { schema: relation.schema, name: relation.name },
      pkColumns,
      selectStar: raw.selectStar,
      columns: raw.columns,
    };
  },

  async "row.update"({ connectionId, table, set, where }: UpdateRowParams): Promise<UpdateRowResult> {
    const s = requireSession(connectionId);
    // Nunca confiamos em `table`/`pkColumns` vindos do cliente para decidir
    // o que é seguro escrever — revalidamos tudo contra o metadata-cache
    // aqui, mesmo que o cliente já tenha visto essa mesma informação vinda
    // de "query.analyzeEditability" (que pode estar desatualizada, ou o
    // cliente pode ter sido adulterado).
    const relation = resolveRelationByName(connectionId, table.name, table.schema);
    if (!relation) throw new Error(`tabela não encontrada: ${table.schema}.${table.name}`);

    const pkColumns = relation.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    if (pkColumns.length === 0) throw new Error("tabela sem chave primária conhecida");
    const pkSet = new Set(pkColumns);
    const whereKeys = Object.keys(where);
    if (whereKeys.length !== pkColumns.length || !whereKeys.every((k) => pkSet.has(k))) {
      throw new Error("where deve cobrir exatamente as colunas de chave primária da tabela");
    }

    const validColumns = new Set(relation.columns.map((c) => c.name));
    for (const col of Object.keys(set)) {
      if (!validColumns.has(col)) throw new Error(`coluna desconhecida em '${relation.name}': ${col}`);
    }
    if (Object.keys(set).length === 0) throw new Error("nada para atualizar");

    await s.adapter.connect();
    const rowsAffected = await s.adapter.updateRow({
      schema: relation.schema,
      table: relation.name,
      set,
      where,
    });
    if (rowsAffected !== 1) {
      throw new Error(
        rowsAffected === 0
          ? "nenhuma linha corresponde à chave primária informada (dado desatualizado?)"
          : `atualização afetou ${rowsAffected} linhas — abortada por segurança`,
      );
    }
    return { rowsAffected };
  },

  async "metadata.introspect"({ connectionId }: IntrospectParams): Promise<IntrospectResult> {
    const s = requireSession(connectionId);
    await s.adapter.connect();
    const db: Database = await s.adapter.introspect();

    // Coleta relações e funções por schema a partir do adaptador; persiste no
    // cache unificado.
    const schemasByName = new Map<string, {
      name: string;
      relations: readonly Relation[];
      functions: readonly FunctionDef[];
    }>();
    for (const schema of s.adapter.listSchemas()) {
      const rels = s.adapter.listTables(schema.name);
      const fns = s.adapter.listFunctions(schema.name);
      schemasByName.set(schema.name, { name: schema.name, relations: rels, functions: fns });
    }
    cache.ingestIntrospection(
      connectionId,
      [...schemasByName.values()].map((s2) => ({
        name: s2.name,
        relations: s2.relations,
        functions: s2.functions,
      })),
    );
    return db;
  },

  async "metadata.listRelations"({
    connectionId,
  }: ListRelationsParams): Promise<ListRelationsResult> {
    const s = requireSession(connectionId);
    const all: ListRelationsResult["relations"][number][] = [];
    for (const schemaName of cache.listSchemas(s.config.id).map((x) => x.name)) {
      const rels = cache.getTablesBySchema(s.config.id, schemaName);
      for (const r of rels) {
        all.push({
          schema: r.schema,
          name: r.name,
          kind: r.kind,
          columns: r.columns.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            nullable: c.nullable,
            isPrimaryKey: c.isPrimaryKey,
            ...(c.foreignKeyTo ? { foreignKeyTo: c.foreignKeyTo } : {}),
          })),
        });
      }
    }
    return { relations: all };
  },

  async "metadata.listFunctions"({
    connectionId,
    schema,
  }: ListFunctionsParams): Promise<ListFunctionsResult> {
    const s = requireSession(connectionId);
    return { functions: cache.getFunctions(s.config.id, schema) };
  },

  async "metadata.listIndexes"({
    connectionId,
    schema,
    table,
  }: ListIndexesParams): Promise<ListIndexesResult> {
    const s = requireSession(connectionId);
    await s.adapter.connect();
    const indexes = await s.adapter.listIndexes(schema, table);
    return { indexes };
  },

  async "metadata.getDefinition"({
    connectionId,
    kind,
    schema,
    name,
  }: GetDefinitionParams): Promise<GetDefinitionResult> {
    const s = requireSession(connectionId);
    if (kind === "table") {
      const relation = resolveRelationByName(connectionId, name, schema);
      if (!relation) throw new Error(`tabela não encontrada: ${schema}.${name}`);
      return { sql: buildTableDdl(s.config.dialect, relation) };
    }
    await s.adapter.connect();
    const sql = await s.adapter.getDefinition(kind, schema, name);
    return { sql };
  },

  async "completion.get"({
    connectionId,
    sql,
    cursor,
  }: CompletionParams): Promise<CompletionResult> {
    const s = requireSession(connectionId);
    // Tier2: resolve colunas de CTEs via sidecar JVM/Calcite antes de rodar
    // o tier1 (lexer puro, síncrono) — best-effort, timeout curto; se o
    // sidecar não responder a tempo, cteRelations fica vazio e o
    // autocomplete segue 100% tier1, como sempre foi.
    const cteRelations = await resolveCteRelations(sql);
    const meta = metaSourceOf(s, cteRelations);
    const suggestions = autocompleteTier1(sql, cursor, meta);
    return { suggestions };
  },
};
