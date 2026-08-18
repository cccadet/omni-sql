import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ConnectionConfig, Relation, Database, FunctionDef } from "@omni-sql/ts-types";
import type { Adapter } from "@omni-sql/adapters-core";
import { registerAdapter, resolveAdapter } from "@omni-sql/adapters-core";
import { PostgresAdapter } from "@omni-sql/adapters-pg";
import { OracleAdapter } from "@omni-sql/adapters-oracle";
import { MysqlAdapter } from "@omni-sql/adapters-mysql";
import { MssqlAdapter } from "@omni-sql/adapters-mssql";
import { JdbcAdapter } from "@omni-sql/adapters-jdbc";
import { dialectDescriptor, quoteIdentifier } from "@omni-sql/dialect-descriptors";
import {
  autocompleteTier1,
  findStatement,
  tokenize,
  type MetadataSource,
  type ScopeRef,
  type Token,
} from "@omni-sql/autocomplete-engine";
import { MetadataCache } from "@omni-sql/metadata-cache";
import { RpcValidationError } from "./rpc-errors.ts";
import {
  assertEndpointHasNoEmbeddedCredentials,
  assertSafeExplainSql,
  extractLegacyEndpointCredentials,
} from "./security-policy.ts";

import { resolveCteRelations, analyzeQueryEditability } from "./sidecar-client.ts";
import { diagnoseDialectFunctions, diagnosePolyglotSyntaxError, mergeDiagnostics } from "./sql-diagnostics.ts";
import {
  getPassword,
  setPassword,
  deletePassword,
  passwordSlotFor,
} from "./keyring.ts";
import type {
  BackendRpcRouter,
  AddConnectionParams,
  AddConnectionResult,
  ListConnectionsResult,
  ListConnectionGroupsResult,
  CreateConnectionGroupParams,
  CreateConnectionGroupResult,
  RenameConnectionGroupParams,
  RenameConnectionGroupResult,
  DeleteConnectionGroupParams,
  DeleteConnectionGroupResult,
  MoveConnectionParams,
  MoveConnectionResult,
  TestConnectionParams,
  TestConnectionResult,
  ConnectionStatusParams,
  ListSchemasParams,
  ListSchemasResult,
  RunQueryParams,
  RunQueryResult,
  CancelQueryParams,
  CancelQueryResult,
  ExplainQueryParams,
  ExplainQueryResult,
  DiagnoseQueryParams,
  DiagnoseQueryResult,
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
  UpdateCheckParams,
  UpdateCheckResult,
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

const DEFAULT_QUERY_LIMIT = 1_000;
const MAX_QUERY_LIMIT = 10_000;
const RELEASES_URL = "https://api.github.com/repos/cccadet/omni-sql/releases/latest";
const UPDATE_CHECK_TIMEOUT_MS = 2_000;

type StableVersion = [number, number, number];

function parseStableVersion(value: unknown): StableVersion | null {
  if (typeof value !== "string") return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return null;
  const version: StableVersion = [Number(match[1]), Number(match[2]), Number(match[3])];
  return version.every(Number.isSafeInteger) ? version : null;
}

function isNewerVersion(latest: StableVersion, current: StableVersion): boolean {
  for (let i = 0; i < latest.length; i += 1) {
    if (latest[i] !== current[i]) return latest[i]! > current[i]!;
  }
  return false;
}

async function checkForUpdate({ currentVersion }: UpdateCheckParams): Promise<UpdateCheckResult> {
  const current = parseStableVersion(currentVersion);
  if (!current) throw new Error("invalid current application version");

  try {
    const response = await fetch(RELEASES_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub release check failed: HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (payload === null || typeof payload !== "object") throw new Error("GitHub returned invalid release data");
    const release = payload as { tag_name?: unknown; html_url?: unknown };
    if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") {
      throw new Error("GitHub returned incomplete release data");
    }
    const latest = parseStableVersion(release.tag_name);
    let releaseUrl: URL;
    try {
      releaseUrl = new URL(release.html_url);
    } catch {
      throw new Error("GitHub returned invalid release URL");
    }
    if (!latest || releaseUrl.protocol !== "https:") {
      throw new Error("GitHub returned an unsupported release");
    }
    if (!isNewerVersion(latest, current)) {
      return { available: false };
    }
    return { available: true, version: release.tag_name, releaseUrl: release.html_url };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Validate untrusted JSON-RPC input before it reaches an adapter. */
export function normalizeQueryLimit(limit: unknown): number {
  if (limit === undefined) return DEFAULT_QUERY_LIMIT;
  if (typeof limit !== "number" || !Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    throw new RpcValidationError("query.run limit must be a finite positive integer");
  }
  if (limit > MAX_QUERY_LIMIT) {
    throw new RpcValidationError(`query.run limit must be at most ${MAX_QUERY_LIMIT}`);
  }
  return limit;
}

/** Close backend-owned resources during process shutdown. Safe to call more than once. */
let resourcesClosed = false;
export async function closeBackendResources(): Promise<void> {
  if (resourcesClosed) return;
  resourcesClosed = true;
  await Promise.allSettled(
    [...sessions.values()].map(async ({ adapter }) => {
      await adapter.close();
    }),
  );
  sessions.clear();
  cache.close();
}

// ─────────────────────────── Registry bootstrap

// Registro dos adaptadores reais suportados. Dialeto não registrado lança
// erro em resolveAdapter (não há mais fallback in-memory em produção).
registerAdapter("postgres", (config, password) => new PostgresAdapter(config, password));
registerAdapter("oracle", (config, password) => new OracleAdapter(config, password));
registerAdapter("mysql", (config, password) => new MysqlAdapter(config, password));
registerAdapter("mariadb", (config, password) => new MysqlAdapter(config, password));
registerAdapter("sqlserver", (config, password) => new MssqlAdapter(config, password));
registerAdapter("jdbc-generic", (config, password) => new JdbcAdapter(config, password));

// ─────────────────────────── Adapter construction

// ─────────────────────────── Boot: restore persisted connections

// Never log adapter/keyring error text. Release launchers need no NODE_ENV.
function errorMessage(_error: unknown): string {
  return "operation failed";
}

function logValue(value: unknown): string {
  return String(value).replace(
    new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, "g"),
    (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

async function readStoredPassword(
  config: Pick<ConnectionConfig, "id">,
  context: string,
): Promise<string | undefined> {
  try {
    return await getPassword(config);
  } catch (error) {
    console.warn(
      `[omni-sql] keyring read failed while ${logValue(context)}; ` +
      `continuing without stored password: ${errorMessage(error)}`,
    );
    return undefined;
  }
}

async function restoreConnections(): Promise<void> {
  for (const persistedConfig of cache.listConnections()) {
    let cfg = persistedConfig;
    let password: string | undefined;
    try {
      password = await getPassword(cfg);
    } catch (error) {
      console.warn(
        `[omni-sql] skipped restore for connection; keyring read failed: ${errorMessage(error)}`,
      );
      continue;
    }
    const legacy = extractLegacyEndpointCredentials(cfg);
    if (legacy) {
      try {
        if (password === undefined && legacy.password !== undefined) {
          await setPassword(legacy.config, legacy.password);
          password = legacy.password;
        }
        cfg = { ...legacy.config, groupId: cfg.groupId };
        cache.upsertConnection({ ...cfg, passwordSlot: passwordSlotFor(cfg) });
        console.log(`[omni-sql] migrated credential-bearing endpoint for connection ${logValue(cfg.id)}`);
      } catch (error) {
        console.warn(`[omni-sql] skipped legacy endpoint migration; keyring write failed: ${errorMessage(error)}`);
        continue;
      }
    }
    try {
      const configWithSlot = { ...cfg, passwordSlot: passwordSlotFor(cfg) };
      const adapter = resolveAdapter(configWithSlot, password);
      sessions.set(cfg.id, { config: configWithSlot, adapter });
      console.log(`[omni-sql] restored connection dialect=${logValue(cfg.dialect)}`);
    } catch (e) {
      console.warn(`[omni-sql] failed to restore connection: ${errorMessage(e)}`);
    }
  }
}

// Requests can arrive immediately after the HTTP listener starts. Keep the
// promise so connection.list/query handlers cannot race the restore and build
// a second, password-less session.
const connectionsRestored = restoreConnections();

// ─────────────────────────── Helpers

function requireSession(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error(`connection not found: ${id}`);
  return s;
}

function requireNonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RpcValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

interface ScopeRefIdentifierFlags {
  readonly schemaQuoted?: boolean;
  readonly tableQuoted?: boolean;
}

type BackendScopeRef = ScopeRef & ScopeRefIdentifierFlags;

interface BackendCteRelation extends Relation {
  readonly nameQuoted?: boolean;
}

interface CteNameInfo {
  readonly name: string;
  readonly quoted: boolean;
}

function foldUnquotedIdentifier(value: string, dialect: ConnectionConfig["dialect"] | undefined): string {
  switch (dialect) {
    case "postgres":
      return value.toLowerCase();
    case "oracle":
      return value.toUpperCase();
    default:
      return value.toLowerCase();
  }
}

function identifierMatchesCaseInsensitive(actual: string, requested: string): boolean {
  return actual.toLowerCase() === requested.toLowerCase();
}

function cteNameQuoting(
  sql: string,
  cursor: number,
  dialect: ReturnType<typeof dialectDescriptor>,
): readonly CteNameInfo[] {
  const statement = findStatement(sql, cursor, dialect).text;
  const tokens = tokenize(statement, dialect).filter((token) =>
    token.type !== "whitespace" && token.type !== "comment" && token.type !== "eof");
  const names: CteNameInfo[] = [];
  if (tokens[0]?.type !== "keyword" || tokens[0].upper !== "WITH") return names;

  const isName = (token: Token | undefined): token is Token =>
    token?.type === "identifier" || token?.type === "keyword";
  const isQuoted = (token: Token): boolean =>
    (dialect.identifierQuotePairs ?? dialect.identifierQuoteChars.map((quote) => [quote, quote] as const))
      .some(([open]) => statement.startsWith(open, token.start));
  const skipParenthesized = (start: number): number => {
    if (tokens[start]?.value !== "(") return start;
    let depth = 0;
    for (let i = start; i < tokens.length; i += 1) {
      if (tokens[i]!.value === "(") depth += 1;
      if (tokens[i]!.value === ")") {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    return tokens.length;
  };

  let i = 1;
  if (tokens[i]?.type === "keyword" && tokens[i]?.upper === "RECURSIVE") i += 1;
  while (isName(tokens[i])) {
    const name = tokens[i]!;
    names.push({ name: name.value, quoted: isQuoted(name) });
    i += 1;
    if (tokens[i]?.value === "(") i = skipParenthesized(i);
    if (tokens[i]?.type !== "keyword" || tokens[i]?.upper !== "AS") break;
    i += 1;
    if (tokens[i]?.value !== "(") break;
    i = skipParenthesized(i);
    if (tokens[i]?.value !== ",") break;
    i += 1;
  }
  return names;
}

function annotateCteRelations(
  sql: string,
  cursor: number,
  dialect: ReturnType<typeof dialectDescriptor>,
  relations: readonly Relation[],
): BackendCteRelation[] {
  const names = cteNameQuoting(sql, cursor, dialect);
  const declarationCounts = new Map<string, number>();
  const quoteStates = new Map<string, Set<boolean>>();
  for (const name of names) {
    declarationCounts.set(name.name, (declarationCounts.get(name.name) ?? 0) + 1);
    const states = quoteStates.get(name.name) ?? new Set<boolean>();
    states.add(name.quoted);
    quoteStates.set(name.name, states);
  }
  const returnedCounts = new Map<string, number>();
  for (const relation of relations) {
    returnedCounts.set(relation.name, (returnedCounts.get(relation.name) ?? 0) + 1);
  }
  const ambiguousNames = new Set(
    [...declarationCounts.keys()].filter((name) =>
      (quoteStates.get(name)?.size ?? 0) > 1
      && (returnedCounts.get(name) ?? 0) < declarationCounts.get(name)!),
  );
  let nameIndex = 0;
  const annotated: BackendCteRelation[] = [];
  for (const relation of relations) {
    // Repeated raw names with mixed quoting cannot be matched safely after
    // sidecar omits one occurrence; discard relation instead of mis-tagging it.
    if (ambiguousNames.has(relation.name)) continue;
    const nextNameIndex = names.findIndex((name, index) => index >= nameIndex && name.name === relation.name);
    const nameInfo = nextNameIndex < 0 ? undefined : names[nextNameIndex];
    if (nameInfo) nameIndex = nextNameIndex + 1;
    annotated.push(nameInfo?.quoted
      ? { ...relation, nameQuoted: true }
      : { ...relation, name: foldUnquotedIdentifier(relation.name, dialect.dialect) });
  }
  return annotated;
}

// Identificadores não-citados passam por folding do dialeto (Postgres →
// minúsculas, Oracle → MAIÚSCULAS). PG/Oracle exigem nome canônico; dialetos
// genéricos mantêm fallback case-insensitive. Identificadores citados exigem
// igualdade exata. Varre schemas porque `schema` pode ser null/undefined.
function resolveRelationByName(
  connectionId: string,
  table: string,
  schema?: string | null,
  flags: ScopeRefIdentifierFlags = {},
): Relation | null {
  const dialect = sessions.get(connectionId)?.config.dialect;
  const strictFolding = dialect === "postgres" || dialect === "oracle";
  const foldedTable = foldUnquotedIdentifier(table, dialect);
  const foldedSchema = schema == null ? null : foldUnquotedIdentifier(schema, dialect);
  let fallback: Relation | null = null;
  for (const sch of cache.listSchemas(connectionId)) {
    const schemaMatches = schema == null
      || (flags.schemaQuoted ? sch.name === schema : identifierMatchesCaseInsensitive(sch.name, schema));
    if (!schemaMatches) continue;
    for (const r of cache.getTablesBySchema(connectionId, sch.name)) {
      const tableMatches = flags.tableQuoted
        ? r.name === table
        : identifierMatchesCaseInsensitive(r.name, table);
      const relationSchemaMatches = schema == null
        || (flags.schemaQuoted ? r.schema === schema : identifierMatchesCaseInsensitive(r.schema, schema));
      if (!tableMatches || !relationSchemaMatches) continue;

      const foldedSchemaMatch = schema == null || flags.schemaQuoted || sch.name === foldedSchema;
      const foldedTableMatch = flags.tableQuoted || r.name === foldedTable;
      if (foldedSchemaMatch && foldedTableMatch) return r;
      if (!strictFolding && fallback === null) fallback = r;
    }
  }
  return fallback;
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

export function metaSourceOf(
  session: Pick<Session, "config">,
  cteRelations: readonly BackendCteRelation[] = [],
): MetadataSource {
  return {
    dialect: dialectDescriptor(session.config.dialect),
    listSchemas: (): readonly string[] =>
      cache.listSchemas(session.config.id).map((schema) => schema.name),
    listRelations: (): readonly Relation[] => {
      const out: Relation[] = [...cteRelations];
      const strictFolding = session.config.dialect === "postgres" || session.config.dialect === "oracle";
      for (const s of cache.listSchemas(session.config.id)) {
        for (const rel of cache.getTablesBySchema(session.config.id, s.name)) {
          const shadowed = cteRelations.some((cte) => {
            if (cte.nameQuoted) return rel.name === cte.name;
            if (strictFolding) return rel.name === foldUnquotedIdentifier(cte.name, session.config.dialect);
            return identifierMatchesCaseInsensitive(rel.name, cte.name);
          });
          if (!shadowed) out.push(rel);
        }
      }
      return out;
    },
    listFunctions: () => cache.getFunctions(session.config.id),
    resolveRelation: (ref: ScopeRef): Relation | null => {
      const quotedRef = ref as BackendScopeRef;
      const strictFolding = session.config.dialect === "postgres" || session.config.dialect === "oracle";
      // CTEs (tier2 via sidecar/Calcite) sombreiam tabelas reais de mesmo
      // nome — mesma regra de resolução de escopo do SQL padrão.
      if (ref.schema == null) {
        const cte = quotedRef.tableQuoted
          ? cteRelations.find((r) => r.name === ref.table)
          : cteRelations
            .filter((r) => !r.nameQuoted)
            .find((r) => foldUnquotedIdentifier(r.name, session.config.dialect)
              === foldUnquotedIdentifier(ref.table, session.config.dialect))
            ?? (strictFolding ? undefined : cteRelations
              .filter((r) => !r.nameQuoted)
              .find((r) => identifierMatchesCaseInsensitive(r.name, ref.table)));
        if (cte) return cte;
      }
      return resolveRelationByName(session.config.id, ref.table, ref.schema, quotedRef);
    },
  };
}

// ─────────────────────────── Handlers

export const handlers: BackendRpcRouter = {
  async "connection.add"({ config, password }: AddConnectionParams): Promise<AddConnectionResult> {
    await connectionsRestored;
    assertEndpointHasNoEmbeddedCredentials(config);
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
    const effectivePassword = await readStoredPassword(configWithSlot, "adding connection");

    if (password !== undefined && password.length > 0 && effectivePassword !== password) {
      throw new Error(`senha não pôde ser recuperada do keyring para ${config.id}`);
    }

    const previous = sessions.get(config.id);
    if (previous) await previous.adapter.close().catch(() => undefined);

    const adapter = resolveAdapter(configWithSlot, effectivePassword);
    sessions.set(config.id, { config: configWithSlot, adapter });
    cache.upsertConnection(configWithSlot);
    return { connectionId: config.id, ok: true };
  },

  async "connection.list"(): Promise<ListConnectionsResult> {
    await connectionsRestored;
    const configs = cache.listConnections().map((c) => ({
      id: c.id,
      label: c.label,
      dialect: c.dialect,
      endpoint: c.endpoint,
      user: c.user,
      options: c.options,
      schemas: c.schemas,
      groupId: c.groupId,
      lastSyncedAt: cache.lastSyncedAt(c.id, "connection"),
    }));
    return { configs };
  },

  async "connectionGroup.list"(): Promise<ListConnectionGroupsResult> {
    await connectionsRestored;
    return { groups: cache.listConnectionGroups() };
  },

  async "connectionGroup.create"({ name }: CreateConnectionGroupParams): Promise<CreateConnectionGroupResult> {
    await connectionsRestored;
    const group = cache.createConnectionGroup(requireNonEmptyText(name, "connectionGroup.create name"));
    return { group };
  },

  async "connectionGroup.rename"({ groupId, name }: RenameConnectionGroupParams): Promise<RenameConnectionGroupResult> {
    await connectionsRestored;
    const group = cache.renameConnectionGroup(
      requireNonEmptyText(groupId, "connectionGroup.rename groupId"),
      requireNonEmptyText(name, "connectionGroup.rename name"),
    );
    return { group };
  },

  async "connectionGroup.delete"({ groupId }: DeleteConnectionGroupParams): Promise<DeleteConnectionGroupResult> {
    await connectionsRestored;
    cache.deleteConnectionGroup(requireNonEmptyText(groupId, "connectionGroup.delete groupId"));
    return { ok: true };
  },

  async "connection.move"({ connectionId, groupId }: MoveConnectionParams): Promise<MoveConnectionResult> {
    await connectionsRestored;
    cache.moveConnection(
      requireNonEmptyText(connectionId, "connection.move connectionId"),
      groupId === null ? null : requireNonEmptyText(groupId, "connection.move groupId"),
    );
    return { ok: true };
  },

  async "connection.remove"({ connectionId }): Promise<{ ok: boolean }> {
    await connectionsRestored;
    const s = sessions.get(connectionId);
    if (s) await s.adapter.close().catch(() => undefined);
    sessions.delete(connectionId);
    cache.removeConnection(connectionId);
    await deletePassword({ id: connectionId }).catch(() => undefined);
    return { ok: true };
  },

  async "connection.test"({ config, password }: TestConnectionParams): Promise<TestConnectionResult> {
    await connectionsRestored;
    const effectivePassword =
      password !== undefined && password.length > 0
        ? password
        : await readStoredPassword(config, "testing connection");
    const adapter = resolveAdapter(config, effectivePassword);
    try {
      const result = await adapter.test();
      await adapter.close().catch(() => undefined);
      return result.ok ? result : { ...result, message: "Connection test failed" };
    } catch (e) {
      await adapter.close().catch(() => undefined);
      return { ok: false, latencyMs: 0, message: "Connection test failed" };
    }
  },

  async "connection.status"({ connectionId }: ConnectionStatusParams): Promise<TestConnectionResult> {
    await connectionsRestored;
    const s = requireSession(connectionId);
    try {
      const result = await s.adapter.test();
      return result.ok ? result : { ...result, message: "Connection status unavailable" };
    } catch (e) {
      return { ok: false, latencyMs: 0, message: "Connection status unavailable" };
    }
  },

  async "connection.listSchemas"({ config, password }: ListSchemasParams): Promise<ListSchemasResult> {
    await connectionsRestored;
    const effectivePassword =
      password !== undefined && password.length > 0
        ? password
        : await readStoredPassword(config, "listing schemas");
    console.log(
      `[omni-sql] listSchemas start: dialect=${logValue(config.dialect)} ` +
      `hasPassword=${effectivePassword !== undefined}`,
    );
    const adapter = resolveAdapter(config, effectivePassword);
    const tConnect = Date.now();
    try {
      await adapter.connect();
      console.log(`[omni-sql] listSchemas: connected in ${Date.now() - tConnect}ms`);
      const tList = Date.now();
      const schemas = await adapter.listAvailableSchemas();
      console.log(
        `[omni-sql] listSchemas: adapter returned ${schemas.length} schemas ` +
        `in ${Date.now() - tList}ms`,
      );
      return { schemas };
    } finally {
      await adapter.close().catch((e) => console.warn(`[omni-sql] listSchemas: close failed: ${errorMessage(e)}`));
    }
  },

  async "query.run"({ connectionId, sql, limit }: RunQueryParams): Promise<RunQueryResult> {
    await connectionsRestored;
    const s = requireSession(connectionId);
    await s.adapter.connect();
    return s.adapter.runQuery(sql, normalizeQueryLimit(limit));
  },

  async "query.cancel"({ connectionId }: CancelQueryParams): Promise<CancelQueryResult> {
    await connectionsRestored;
    const s = requireSession(connectionId);
    if (!s.adapter.cancelRunning) return { cancelled: false };
    await s.adapter.cancelRunning();
    return { cancelled: true };
  },

  async "query.explain"({ connectionId, sql }: ExplainQueryParams): Promise<ExplainQueryResult> {
    await connectionsRestored;
    const s = requireSession(connectionId);
    assertSafeExplainSql(sql, s.config.dialect);
    await s.adapter.connect();
    return s.adapter.explain(sql);
  },

  async "query.diagnose"({ connectionId, sql }: DiagnoseQueryParams): Promise<DiagnoseQueryResult> {
    const s = requireSession(connectionId);
    const local = diagnoseDialectFunctions(sql, s.config.dialect);
    if (!sql.trim() || !s.adapter.validateQuery) return { diagnostics: local };
    try {
      const database = await s.adapter.validateQuery(sql);
      const polyglot = diagnosePolyglotSyntaxError(sql, s.config.dialect, database);
      const merged = mergeDiagnostics(local, database);
      return { diagnostics: [...merged, ...polyglot].sort((a, b) => a.start - b.start) };
    } catch {
      return { diagnostics: local };
    }
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
      // Cache is the source of truth for editability; a miss here means
      // introspect either failed or never ran. Log enough to disambiguate.
      const cachedSchemas = cache.listSchemas(connectionId);
      console.warn(
        `[omni-sql] analyzeEditability: relation not in cache ` +
        `cachedSchemas=${cachedSchemas.length}`,
      );
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
    if (!relation) throw new RpcValidationError("tabela não encontrada");

    const pkColumns = relation.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    if (pkColumns.length === 0) throw new RpcValidationError("tabela sem chave primária conhecida");
    const pkSet = new Set(pkColumns);
    const whereKeys = Object.keys(where);
    if (whereKeys.length !== pkColumns.length || !whereKeys.every((k) => pkSet.has(k))) {
      throw new RpcValidationError("where deve cobrir exatamente as colunas de chave primária da tabela");
    }

    const validColumns = new Set(relation.columns.map((c) => c.name));
    for (const col of Object.keys(set)) {
      if (!validColumns.has(col)) throw new RpcValidationError("coluna desconhecida");
    }
    if (Object.keys(set).length === 0) throw new RpcValidationError("nada para atualizar");

    await s.adapter.connect();
    const rowsAffected = await s.adapter.updateRow({
      schema: relation.schema,
      table: relation.name,
      set,
      where,
    });
    if (rowsAffected !== 1) {
      throw new RpcValidationError(
        rowsAffected === 0
          ? "nenhuma linha corresponde à chave primária informada (dado desatualizado?)"
          : `atualização afetou ${rowsAffected} linhas — abortada por segurança`,
      );
    }
    return { rowsAffected };
  },

  async "metadata.introspect"({ connectionId }: IntrospectParams): Promise<IntrospectResult> {
    const s = requireSession(connectionId);
    console.log(
      `[omni-sql] introspect start: dialect=${logValue(s.config.dialect)}`,
    );
    const tConnect = Date.now();
    await s.adapter.connect();
    console.log(`[omni-sql] introspect: connected in ${Date.now() - tConnect}ms, querying metadata…`);
    const tIntro = Date.now();
    const db: Database = await s.adapter.introspect();
    console.log(`[omni-sql] introspect: adapter.introspect() returned in ${Date.now() - tIntro}ms`);

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
    const tIngest = Date.now();
    try {
      cache.ingestIntrospection(
        connectionId,
        [...schemasByName.values()].map((s2) => ({
          name: s2.name,
          relations: s2.relations,
          functions: s2.functions,
        })),
      );
      console.log(
        `[omni-sql] introspect: cache ingest ok in ${Date.now() - tIngest}ms ` +
        `(${schemasByName.size} schemas, ` +
        `${[...schemasByName.values()].reduce((n, x) => n + x.relations.length, 0)} relations, ` +
        `${[...schemasByName.values()].reduce((n, x) => n + x.functions.length, 0)} functions)`,
      );
    } catch (e) {
      console.error(`[omni-sql] introspect: cache ingest FAILED after ${Date.now() - tIngest}ms: ${errorMessage(e)}`);
      throw e;
    }
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
      if (!relation) throw new RpcValidationError("tabela não encontrada");
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
    const descriptor = dialectDescriptor(s.config.dialect);
    const cteRelations = annotateCteRelations(
      sql,
      cursor,
      descriptor,
      await resolveCteRelations(sql, cursor, descriptor),
    );
    const meta = metaSourceOf(s, cteRelations);
    const suggestions = autocompleteTier1(sql, cursor, meta);
    return { suggestions };
  },

  "update.check": checkForUpdate,
};
