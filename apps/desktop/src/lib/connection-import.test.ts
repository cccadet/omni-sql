import { assert, test } from "vitest";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import { buildConnectionExport, ConnectionImportError, parseDbeaverDataSources, parseOmniSqlExport, relinkDucklakeCatalogs } from "./connection-import";

// Shape written by DBeaver 23.x/24.x in workspace6/General/.dbeaver/data-sources.json.
const dataSources = JSON.stringify({
  folders: { Prod: {}, "Prod/Reporting": { parent: "Prod" } },
  connections: {
    "postgres-jdbc-1": {
      provider: "postgresql", driver: "postgres-jdbc", name: "Orders", folder: "Prod/Reporting", "save-password": true,
      configuration: {
        host: "pg.internal", port: "5433", database: "orders", url: "jdbc:postgresql://pg.internal:5433/orders",
        type: "prod", "auth-model": "native", handlers: { postgre_ssl: { type: "CONFIG", enabled: true } },
      },
    },
    "mysql8-1": {
      provider: "mysql", driver: "mysql8", name: "Shop", configuration: { configurationType: "URL", url: "jdbc:mysql://shop.local/shop?useSSL=false", type: "dev", user: "app" },
    },
    "mariadb-1": { provider: "mysql", driver: "mariaDB", name: "Legacy", configuration: { host: "maria", port: "3307", database: "legacy" } },
    "mssql-1": {
      provider: "sqlserver", driver: "microsoft", name: "Finance",
      configuration: { configurationType: "URL", url: "jdbc:sqlserver://sql01\\BI:1444;databaseName=finance;encrypt=true", type: "test" },
    },
    "oracle-1": { provider: "oracle", driver: "oracle_thin", name: "ERP", configuration: { configurationType: "URL", url: "jdbc:oracle:thin:@//erp:1522/ERPPDB" } },
    "sqlite-1": { provider: "generic", driver: "sqlite_jdbc", name: "Notes", configuration: { database: "C:/notes.db" } },
    "oracle-tns": { provider: "oracle", driver: "oracle_thin", name: "TNS only", configuration: { configurationType: "TNS" } },
  },
});

test("maps supported DBeaver connections to omni-sql configs without credentials", () => {
  const byId = Object.fromEntries(parseDbeaverDataSources(dataSources, []).map((candidate) => [candidate.sourceId, candidate]));
  assert.deepEqual(byId["postgres-jdbc-1"], {
    sourceId: "postgres-jdbc-1", label: "Orders", driver: "postgres-jdbc", folder: "Prod / Reporting", status: "ready",
    config: { label: "Orders", dialect: "postgres", endpoint: "pg.internal:5433/orders", user: "", options: { ssl: "require", environment: "production" } },
  });
  assert.deepEqual(byId["mysql8-1"]?.config, { label: "Shop", dialect: "mysql", endpoint: "shop.local:3306/shop", user: "app", options: { environment: "development" } });
  assert.deepEqual(byId["mariadb-1"]?.config, { label: "Legacy", dialect: "mariadb", endpoint: "maria:3307/legacy", user: "" });
  assert.deepEqual(byId["mssql-1"]?.config, { label: "Finance", dialect: "sqlserver", endpoint: "sql01\\BI:1444/finance", user: "", options: { environment: "staging" } });
  assert.equal(byId["oracle-1"]?.config?.endpoint, "erp:1522/ERPPDB");
  assert.deepEqual([byId["sqlite-1"]?.status, byId["sqlite-1"]?.unsupportedReason, byId["sqlite-1"]?.config], ["unsupported", "driver", undefined]);
  assert.deepEqual([byId["oracle-tns"]?.status, byId["oracle-tns"]?.unsupportedReason], ["unsupported", "address"]);
});

test("flags connections that already exist, including repeats within the file", () => {
  const source = JSON.stringify({ connections: {
    a: { provider: "postgresql", name: "A", configuration: { host: "PG", port: "5432", database: "db", user: "u" } },
    b: { provider: "postgresql", name: "B", configuration: { host: "other", port: "5432", database: "db", user: "u" } },
    c: { provider: "postgresql", name: "B again", configuration: { host: "other", database: "db", user: "u" } },
  } });
  const statuses = parseDbeaverDataSources(source, [{ dialect: "postgres", endpoint: "pg:5432/db", user: "U" }]).map((candidate) => candidate.status);
  assert.deepEqual(statuses, ["duplicate", "ready", "duplicate"]);
});

test("rejects files that are not DBeaver data sources", () => {
  for (const source of ["not json", "[]", JSON.stringify({ folders: {} })]) {
    assert.throws(() => parseDbeaverDataSources(source, []), ConnectionImportError);
  }
});

const local: ConnectionConfig[] = [
  { id: "pg-1", label: "Orders", dialect: "postgres", endpoint: "pg:5432/orders", user: "app", groupId: "g1", options: { ssl: "require", environment: "production", mcpAccess: "write" }, schemas: ["public", "sales"] },
  { id: "lake", label: "Lake", dialect: "s3", endpoint: "s3://lake", user: "AKIAEXAMPLE", groupId: null,
    options: { region: "us-east-1", buckets: '["s3://lake"]', ducklakeMappings: '[{"prefix":"s3://lake/main","kind":"postgres","connectionId":"pg-1"}]' } },
  { id: "local-duckdb", label: "Local DuckDB", dialect: "duckdb", endpoint: "local.duckdb", user: "" },
];

test("an omni-sql export restores connections, folders and options but no credentials", () => {
  const exported = buildConnectionExport(local, [{ id: "g1", name: "Prod" }], new Date("2026-10-25T10:00:00Z"));
  const document = JSON.parse(exported) as { format: string; version: number; exportedAt: string; connections: Record<string, unknown>[] };
  assert.deepEqual([document.format, document.version, document.exportedAt], ["omni-sql.connections", 1, "2026-10-25T10:00:00.000Z"]);
  assert.deepEqual(document.connections.map((connection) => connection.ref), ["pg-1", "lake"]);
  assert.notInclude(exported, "AKIAEXAMPLE");
  assert.notInclude(exported, "passwordSlot");

  const candidates = parseOmniSqlExport(exported, []);
  assert.deepEqual(candidates[0], {
    sourceId: "pg-1", label: "Orders", driver: "postgres", folder: "Prod", status: "ready",
    config: { label: "Orders", dialect: "postgres", endpoint: "pg:5432/orders", user: "app", options: { ssl: "require", environment: "production", mcpAccess: "write" }, schemas: ["public", "sales"] },
  });
  assert.deepEqual([candidates[1]?.status, candidates[1]?.config?.user, candidates[1]?.folder], ["ready", "", undefined]);
  // Restoring a backup on the same machine finds the connections already there.
  assert.deepEqual(parseOmniSqlExport(exported, local).map((candidate) => candidate.status), ["duplicate", "duplicate"]);
});

test("omni-sql import rejects other files, newer versions and malformed entries", () => {
  assert.throws(() => parseOmniSqlExport(JSON.stringify({ connections: {} }), []), /invalid connection import file/);
  assert.throws(() => parseOmniSqlExport(JSON.stringify({ format: "omni-sql.connections", version: 2, connections: [] }), []), /newer omni-sql version/);
  const candidates = parseOmniSqlExport(JSON.stringify({ format: "omni-sql.connections", version: 1, connections: [
    { ref: "a", label: "No endpoint", dialect: "postgres", user: "u" },
    { ref: "b", label: "Nested option", dialect: "mysql", endpoint: "h:3306/db", user: "u", options: { ssl: { mode: "x" } } },
    { ref: "c", label: "Future", dialect: "clickhouse", endpoint: "h:9000", user: "u" },
  ] }), []);
  assert.deepEqual(candidates.map((candidate) => [candidate.status, candidate.unsupportedReason]), [["unsupported", "invalid"], ["unsupported", "invalid"], ["unsupported", "driver"]]);
});

test("re-links DuckLake catalogs to connections imported in the same batch", () => {
  const lake = parseOmniSqlExport(buildConnectionExport(local, []), [])[1]!.config!;
  const relinked = relinkDucklakeCatalogs(lake, new Map([["pg-1", "conn-new"]]));
  assert.deepEqual(JSON.parse(String(relinked.options?.ducklakeMappings)), [{ prefix: "s3://lake/main", kind: "postgres", connectionId: "conn-new" }]);
  assert.equal(relinkDucklakeCatalogs(lake, new Map()).options?.ducklakeMappings, lake.options?.ducklakeMappings);
});
