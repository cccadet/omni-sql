import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ConnectionConfig, Relation, Database } from "@omni-sql/ts-types";
import type { Adapter } from "@omni-sql/adapters-core";
import {
  bootstrapDefaultRegistry,
  registerAdapter,
  resolveAdapter,
} from "@omni-sql/adapters-core";
import { PostgresAdapter, pgAdapterFactory } from "@omni-sql/adapters-pg";
import { dialectDescriptor } from "@omni-sql/dialect-descriptors";
import {
  autocompleteTier1,
  type MetadataSource,
  type ScopeRef,
} from "@omni-sql/autocomplete-engine";
import { MetadataCache } from "@omni-sql/metadata-cache";

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

// ─────────────────────────── Adapter construction

function createAdapter(config: ConnectionConfig, password?: string): Adapter {
  if (config.dialect === "postgres") {
    return new PostgresAdapter(config, password);
  }
  return resolveAdapter(config);
}

async function buildSession(
  config: ConnectionConfig,
  password?: string,
): Promise<Session> {
  const adapter = createAdapter(config, password);
  return { config, adapter };
}

// ─────────────────────────── Boot: restore persisted connections

async function restoreConnections(): Promise<void> {
  for (const cfg of cache.listConnections()) {
    const password = await getPassword(cfg).catch((e) => {
      console.warn(`[omni-sql] keyring failed for ${cfg.id}: ${(e as Error).message}`);
      return undefined;
    });
    try {
      const session = await buildSession(
        { ...cfg, passwordSlot: passwordSlotFor(cfg) },
        password,
      );
      sessions.set(cfg.id, session);
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
  async "connection.add"({ config, password }: AddConnectionParams): Promise<AddConnectionResult> {
    const configWithSlot: ConnectionConfig = {
      ...config,
      passwordSlot: passwordSlotFor(config),
    };

    if (password !== undefined && password.length > 0) {
      await setPassword(configWithSlot, password);
    }

    const session = await buildSession(configWithSlot, password);
    sessions.set(config.id, session);
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
    const adapter = createAdapter(config, password);
    try {
      const result = await adapter.test();
      await adapter.close().catch(() => undefined);
      return result;
    } catch (e) {
      await adapter.close().catch(() => undefined);
      return { ok: false, latencyMs: 0, message: (e as Error).message };
    }
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
    // cache unificado.
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
