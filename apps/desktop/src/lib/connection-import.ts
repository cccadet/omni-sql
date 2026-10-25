import type { ConnectionConfig, DialectId } from "@omni-sql/ts-types";

/**
 * Connection import/export. Two sources are understood: omni-sql's own export
 * (another computer or an earlier backup) and DBeaver's `data-sources.json`
 * (workspace6/General/.dbeaver). Passwords never travel in either direction:
 * they stay in the keyring, and DBeaver keeps them encrypted in a separate
 * credentials file that is never read. Imported connections ask for them on
 * first use, like any connection saved without one.
 */

export type ImportSource = "omni-sql" | "dbeaver";

export type ImportCandidateStatus = "ready" | "duplicate" | "unsupported";

export interface ImportCandidate {
  readonly sourceId: string;
  readonly label: string;
  readonly folder?: string;
  /** DBeaver driver id or omni-sql dialect, shown when the connection cannot be imported. */
  readonly driver: string;
  readonly status: ImportCandidateStatus;
  /** Present unless status is "unsupported". */
  readonly config?: Omit<ConnectionConfig, "id">;
  readonly unsupportedReason?: "driver" | "address" | "invalid";
}

export class ConnectionImportError extends Error {
  constructor(readonly code: "invalid-file" | "newer-version") {
    super(code === "invalid-file" ? "invalid connection import file" : "connection export from a newer omni-sql version");
  }
}

export const CONNECTION_EXPORT_FORMAT = "omni-sql.connections";
const CONNECTION_EXPORT_VERSION = 1;

/** Dialects that can be recreated from an export; the built-in local DuckDB is per machine. */
const IMPORTABLE_DIALECTS = new Set<DialectId>(["postgres", "mysql", "mariadb", "sqlserver", "oracle", "jdbc-generic", "odbc", "mongodb", "s3"]);

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

export function endpointKey(config: Pick<ConnectionConfig, "dialect" | "endpoint" | "user">): string {
  // Exports drop the S3 access key id, so an S3 connection is identified by its bucket alone.
  const user = config.dialect === "s3" ? "" : config.user.toLowerCase();
  return [config.dialect, config.endpoint.toLowerCase(), user].join("|");
}

function markDuplicates(candidates: ImportCandidate[], existing: readonly Pick<ConnectionConfig, "dialect" | "endpoint" | "user">[]): ImportCandidate[] {
  const known = new Set(existing.map(endpointKey));
  return candidates.map((candidate) => {
    if (!candidate.config) return candidate;
    const key = endpointKey(candidate.config);
    const duplicate = known.has(key);
    known.add(key);
    return duplicate ? { ...candidate, status: "duplicate" } : candidate;
  });
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    throw new ConnectionImportError("invalid-file");
  }
}

// ---------------------------------------------------------------- omni-sql

type ExportableConnection = Pick<ConnectionConfig, "id" | "label" | "dialect" | "endpoint" | "user" | "options" | "schemas" | "groupId">;

export function exportableConnection(connection: Pick<ConnectionConfig, "dialect">): boolean {
  return IMPORTABLE_DIALECTS.has(connection.dialect);
}

export function buildConnectionExport(
  connections: readonly ExportableConnection[],
  groups: readonly { id: string; name: string }[],
  now = new Date(),
): string {
  const folderNames = new Map(groups.map((group) => [group.id, group.name]));
  return `${JSON.stringify({
    format: CONNECTION_EXPORT_FORMAT,
    version: CONNECTION_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    connections: connections.filter(exportableConnection).map((connection) => {
      const folder = connection.groupId ? folderNames.get(connection.groupId) : undefined;
      return {
        // `ref` lets DuckLake catalogs that point at another exported connection be re-linked on import.
        ref: connection.id,
        label: connection.label,
        dialect: connection.dialect,
        endpoint: connection.endpoint,
        // The S3 access key id is half of a credential pair; it is re-entered with its secret.
        user: connection.dialect === "s3" ? "" : connection.user,
        ...(folder ? { folder } : {}),
        ...(connection.options && Object.keys(connection.options).length > 0 ? { options: connection.options } : {}),
        ...(connection.schemas && connection.schemas.length > 0 ? { schemas: connection.schemas } : {}),
      };
    }),
  }, null, 2)}\n`;
}

function primitiveOptions(value: unknown): Record<string, string | number | boolean> | null {
  if (value === undefined) return {};
  if (!isObject(value)) return null;
  const entries = Object.entries(value);
  return entries.every(([, option]) => ["string", "number", "boolean"].includes(typeof option))
    ? Object.fromEntries(entries) as Record<string, string | number | boolean>
    : null;
}

export function parseOmniSqlExport(source: string, existing: readonly Pick<ConnectionConfig, "dialect" | "endpoint" | "user">[]): ImportCandidate[] {
  const parsed = parseJson(source);
  if (!isObject(parsed) || parsed.format !== CONNECTION_EXPORT_FORMAT || !Array.isArray(parsed.connections)) {
    throw new ConnectionImportError("invalid-file");
  }
  if (typeof parsed.version !== "number" || parsed.version > CONNECTION_EXPORT_VERSION) throw new ConnectionImportError("newer-version");

  const candidates = parsed.connections.map((raw, index): ImportCandidate => {
    const entry = isObject(raw) ? raw : {};
    const sourceId = text(entry.ref) || `entry-${index}`;
    const label = text(entry.label) || sourceId;
    const dialect = text(entry.dialect);
    const folder = text(entry.folder);
    const base = { sourceId, label, driver: dialect, ...(folder ? { folder } : {}) };
    if (!IMPORTABLE_DIALECTS.has(dialect as DialectId)) return { ...base, status: "unsupported", unsupportedReason: "driver" };
    const options = primitiveOptions(entry.options);
    const schemas = entry.schemas === undefined ? [] : entry.schemas;
    if (typeof entry.endpoint !== "string" || !entry.endpoint.trim() || typeof (entry.user ?? "") !== "string" || !options
      || !Array.isArray(schemas) || !schemas.every((schema) => typeof schema === "string")) {
      return { ...base, status: "unsupported", unsupportedReason: "invalid" };
    }
    return {
      ...base,
      status: "ready",
      config: {
        label,
        dialect: dialect as DialectId,
        endpoint: entry.endpoint.trim(),
        user: typeof entry.user === "string" ? entry.user : "",
        ...(Object.keys(options).length > 0 ? { options } : {}),
        ...(schemas.length > 0 ? { schemas: schemas as string[] } : {}),
      },
    };
  });
  return markDuplicates(candidates, existing);
}

/** Points DuckLake catalogs at the new ids of connections imported in the same batch. */
export function relinkDucklakeCatalogs(config: Omit<ConnectionConfig, "id">, newIds: ReadonlyMap<string, string>): Omit<ConnectionConfig, "id"> {
  const encoded = config.options?.ducklakeMappings;
  if (typeof encoded !== "string") return config;
  let mappings: unknown;
  try { mappings = JSON.parse(encoded); } catch { return config; }
  if (!Array.isArray(mappings)) return config;
  const relinked = mappings.map((mapping: unknown) => isObject(mapping) && typeof mapping.connectionId === "string" && newIds.has(mapping.connectionId)
    ? { ...mapping, connectionId: newIds.get(mapping.connectionId) }
    : mapping);
  return { ...config, options: { ...config.options, ducklakeMappings: JSON.stringify(relinked) } };
}

// ----------------------------------------------------------------- DBeaver

type DbeaverDialect = "postgres" | "mysql" | "mariadb" | "sqlserver" | "oracle";

const DEFAULT_PORTS: Record<DbeaverDialect, string> = {
  postgres: "5432",
  mysql: "3306",
  mariadb: "3306",
  sqlserver: "1433",
  oracle: "1521",
};

const ENVIRONMENTS: Record<string, string> = { dev: "development", test: "staging", prod: "production" };

function dialectOf(provider: string, driver: string, url: string): DbeaverDialect | null {
  const p = provider.toLowerCase();
  const d = driver.toLowerCase();
  const u = url.toLowerCase();
  if (d.includes("maria") || u.startsWith("jdbc:mariadb:")) return "mariadb";
  if (p === "mysql" || u.startsWith("jdbc:mysql:")) return "mysql";
  if (p === "postgresql" || u.startsWith("jdbc:postgresql:")) return "postgres";
  if (p === "sqlserver" || p === "mssql" || d.startsWith("mssql") || u.startsWith("jdbc:sqlserver:")) return "sqlserver";
  if (p === "oracle" || u.startsWith("jdbc:oracle:")) return "oracle";
  return null;
}

/** Recovers host/port/database from the JDBC URL for "URL" connections. */
function parseJdbcUrl(dialect: DbeaverDialect, url: string): { host: string; port: string; database: string } | null {
  if (dialect === "sqlserver") {
    const match = /^jdbc:sqlserver:\/\/([^:;/]*)(?::(\d+))?([^;]*)((?:;.*)?)$/i.exec(url);
    if (!match) return null;
    const database = /;\s*(?:databaseName|database)\s*=\s*([^;]+)/i.exec(match[4] ?? "")?.[1] ?? "";
    return { host: (match[1] ?? "") + (match[3]?.startsWith("\\") ? match[3] : ""), port: match[2] ?? "", database: database.trim() };
  }
  if (dialect === "oracle") {
    const match = /^jdbc:oracle:thin:@(?:\/\/)?([^:/]+)(?::(\d+))?[:/]([^?\s]+)$/i.exec(url);
    return match ? { host: match[1] ?? "", port: match[2] ?? "", database: match[3] ?? "" } : null;
  }
  const match = /^jdbc:[a-z]+:\/\/([^:/?]+)(?::(\d+))?(?:\/([^?;]*))?/i.exec(url);
  return match ? { host: match[1] ?? "", port: match[2] ?? "", database: decodeURIComponent(match[3] ?? "") } : null;
}

function sslEnabled(configuration: Json): boolean {
  const handlers = configuration.handlers;
  if (!isObject(handlers)) return false;
  return Object.entries(handlers).some(([name, handler]) => /ssl/i.test(name) && isObject(handler) && handler.enabled === true);
}

function folderPath(folder: string, folders: Json): string {
  // Folders may be nested ("Parent/Child" or a `parent` chain); omni-sql folders are flat.
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = folder;
  while (current && !seen.has(current)) {
    seen.add(current);
    parts.unshift(current.split("/").pop() ?? current);
    const entry: unknown = folders[current];
    const parent = isObject(entry) ? text(entry.parent) : "";
    current = parent || (current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : undefined);
  }
  return parts.join(" / ");
}

export function parseDbeaverDataSources(source: string, existing: readonly Pick<ConnectionConfig, "dialect" | "endpoint" | "user">[]): ImportCandidate[] {
  const parsed = parseJson(source);
  if (!isObject(parsed) || !isObject(parsed.connections)) throw new ConnectionImportError("invalid-file");
  const folders = isObject(parsed.folders) ? parsed.folders : {};

  const candidates = Object.entries(parsed.connections).flatMap(([sourceId, raw]): ImportCandidate[] => {
    if (!isObject(raw)) return [];
    const configuration = isObject(raw.configuration) ? raw.configuration : {};
    const provider = text(raw.provider);
    const driver = text(raw.driver) || provider;
    const label = text(raw.name) || sourceId;
    const folderName = text(raw.folder);
    const base = { sourceId, label, driver, ...(folderName ? { folder: folderPath(folderName, folders) } : {}) };
    const url = text(configuration.url);
    const dialect = dialectOf(provider, driver, url);
    if (!dialect) return [{ ...base, status: "unsupported", unsupportedReason: "driver" }];

    let host = text(configuration.host);
    let port = text(configuration.port);
    let database = text(configuration.database);
    if (!host && url) {
      const fromUrl = parseJdbcUrl(dialect, url);
      if (fromUrl) ({ host, port, database } = fromUrl);
    }
    if (dialect === "sqlserver" && host && text(configuration.server) && !host.includes("\\")) host = `${host}\\${text(configuration.server)}`;
    if (!host) return [{ ...base, status: "unsupported", unsupportedReason: "address" }];

    const environment = ENVIRONMENTS[text(configuration.type).toLowerCase()];
    const options = { ...(sslEnabled(configuration) ? { ssl: "require" } : {}), ...(environment ? { environment } : {}) };
    return [{
      ...base,
      status: "ready",
      config: {
        label,
        dialect,
        endpoint: `${host}:${port || DEFAULT_PORTS[dialect]}/${database}`,
        user: text(configuration.user),
        ...(Object.keys(options).length > 0 ? { options } : {}),
      },
    }];
  });
  return markDuplicates(candidates, existing);
}

export function parseConnectionImport(source: ImportSource, contents: string, existing: readonly Pick<ConnectionConfig, "dialect" | "endpoint" | "user">[]): ImportCandidate[] {
  return source === "omni-sql" ? parseOmniSqlExport(contents, existing) : parseDbeaverDataSources(contents, existing);
}
