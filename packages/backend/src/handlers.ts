import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ConnectionConfig, Relation, Database } from "@omni-sql/ts-types";
import type { Adapter } from "@omni-sql/adapters-core";
import {
  bootstrapDefaultRegistry,
  registerAdapter,
  resolveAdapter,
  InMemoryAdapter,
} from "@omni-sql/adapters-core";
import { pgAdapterFactory } from "@omni-sql/adapters-pg";
import { postgresDescriptor, dialectDescriptor } from "@omni-sql/dialect-descriptors";
import {
  autocompleteTier1,
  type MetadataSource,
  type ScopeRef,
} from "@omni-sql/autocomplete-engine";
import { MetadataCache } from "@omni-sql/metadata-cache";

import type {
  RpcRouter,
  AddConnectionParams,
  AddConnectionResult,
  ListConnectionsResult,
  RunQueryParams,
  RunQueryResult,
  IntrospectParams,
  IntrospectResult,
  ListRelationsParams,
  ListRelationsResult,
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

// Fase 0: tudo via in-memory; Fase 2 troca `postgres` por adaptador real.
bootstrapDefaultRegistry();
registerAdapter("postgres", pgAdapterFactory);

// ─────────────────────────── Helpers

function requireSession(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error(`connection not found: ${id}`);
  return s;
}

function metaSourceOf(session: Session): MetadataSource {
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
      const all = cache.getTablesBySchema(
        session.config.id,
        ref.schema ?? cache.listSchemas(session.config.id)[0]?.name ?? "public",
      );
      return (
        all.find((r) =>
          r.name === ref.table &&
          (ref.schema == null || r.schema === ref.schema)
        ) ?? null
      );
    },
  };
}

// ─────────────────────────── Handlers

export const handlers: RpcRouter = {
  async "connection.add"({ config }: AddConnectionParams): Promise<AddConnectionResult> {
    const adapter = resolveAdapter(config);
    sessions.set(config.id, { config, adapter });
    cache.upsertConnection(config);
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
    }));
    return { configs };
  },

  async "connection.remove"({ connectionId }): Promise<{ ok: boolean }> {
    const s = sessions.get(connectionId);
    if (s) await s.adapter.close().catch(() => undefined);
    sessions.delete(connectionId);
    cache.removeConnection(connectionId);
    return { ok: true };
  },

  async "query.run"({ connectionId, sql, limit }: RunQueryParams): Promise<RunQueryResult> {
    const s = requireSession(connectionId);
    await s.adapter.connect();
    return s.adapter.runQuery(sql, limit ?? 1000);
  },

  async "metadata.introspect"({ connectionId }: IntrospectParams): Promise<IntrospectResult> {
    const s = requireSession(connectionId);
    await s.adapter.connect();
    const db: Database = await s.adapter.introspect();

    // Coleta relações e funções por schema a partir do adaptador; persiste no
    // cache unificado. Em Fase 2 isto vira a real introspecção PG; por
    // enquanto vem do InMemoryAdapter.
    const schemasByName = new Map<string, {
      name: string;
      relations: readonly Relation[];
      functions: readonly { schema: string; name: string; overloads: readonly never[] }[];
    }>();
    for (const schema of s.adapter.listSchemas()) {
      const rels = s.adapter.listTables(schema.name);
      schemasByName.set(schema.name, { name: schema.name, relations: rels, functions: [] });
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
          })),
        });
      }
    }
    return { relations: all };
  },

  async "completion.get"({
    connectionId,
    sql,
    cursor,
  }: CompletionParams): Promise<CompletionResult> {
    const s = requireSession(connectionId);
    const meta = metaSourceOf(s);
    const suggestions = autocompleteTier1(sql, cursor, meta);
    return { suggestions };
  },
};