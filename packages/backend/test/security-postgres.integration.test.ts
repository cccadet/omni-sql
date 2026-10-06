import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PostgresAdapter } from "@omni-sql/adapters-pg";

const endpoint = process.env.PG_TEST_CONNECTION_STRING;
test("PostgreSQL planning and diagnostics cannot mutate; metadata keys stay distinct", { skip: !endpoint }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "omni-security-pg-"));
  process.env.OMNI_SQL_METADATA_DB = join(directory, "metadata.db");
  process.env.OMNI_SQL_DEV_KEYRING_FILE = join(directory, "keyring.json");
  process.env.OMNI_SQL_AUTH_TOKEN = "security-pg-test";
  process.env.OMNI_SQL_MCP_AUTH_TOKEN = "security-pg-mcp";
  const { startServer } = await import("../src/index.ts");
  const { closeBackendResources } = await import("../src/handlers.ts");
  const admin = new PostgresAdapter({ id: "security-admin", label: "Admin", dialect: "postgres", endpoint: endpoint!, user: "omni" }, "omni");
  await admin.connect();
  const pool = { query: async (sql: string) => {
    let result;
    for (const statement of sql.split(";").filter(part => part.trim())) result = await admin.runQuery(statement, 1000);
    return result!;
  }, end: () => admin.close() };
  const schema = `security_${process.pid}`, dotted = `${schema}.b`;
  const server = startServer(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const rpc = async (method: string, params: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/rpc`, { method: "POST", headers: { authorization: "Bearer security-pg-test", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    return await response.json() as { result?: unknown; error?: unknown };
  };
  try {
    await pool.query(`CREATE SCHEMA "${schema}"; CREATE SCHEMA "${dotted}"; CREATE TABLE "${schema}"."b.c" (id int PRIMARY KEY); CREATE TABLE "${dotted}".c (id int, v int); INSERT INTO "${dotted}".c VALUES (1,0),(1,0)`);
    const uri = new URL(endpoint!);
    uri.username = "";
    uri.password = "";
    const config = { id: "security-pg", label: "Security test", dialect: "postgres", endpoint: `${uri.host}${uri.pathname}`, user: "omni" };
    assert.equal((await rpc("connection.add", { config, password: "omni" })).error, undefined);
    assert.equal((await rpc("metadata.introspect", { connectionId: config.id })).error, undefined);
    for (const sql of [String.raw`SELECT E'\'a'; DELETE FROM "${dotted}".c; --'`, `SELECT 1; COMMIT; DELETE FROM "${dotted}".c`]) {
      await rpc("mcp.ui.next", { listenerId: "security-ui" });
      const pending = fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST", headers: { authorization: "Bearer security-pg-mcp", "content-type": "application/json" }, body: JSON.stringify({ tool: "explainSql", args: { sql } }) });
      const queued = await rpc("mcp.ui.next", { listenerId: "security-ui", waitMs: 2_000 });
      const request = queued.result as { id: string; tool: string; args: { sql: string } };
      assert.equal(request.tool, "explainSql");
      assert.equal(request.args.sql, sql);
      const explained = await rpc("query.explain", { connectionId: config.id, sql: request.args.sql });
      assert.ok(explained.error);
      await rpc("mcp.ui.respond", { id: request.id, listenerId: "security-ui", ok: false, error: { code: "rejected", message: "Unsafe SQL rejected" } });
      assert.ok((await (await pending).json() as { error?: unknown }).error);
      await rpc("query.diagnose", { connectionId: config.id, sql });
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${dotted}".c`)).rows[0]?.[0], 2);
    }
    assert.equal((await rpc("query.explain", { connectionId: config.id, sql: "WITH x AS (SELECT 1) SELECT * FROM x" })).error, undefined);
    const adapter = new PostgresAdapter({ ...config, dialect: "postgres" }, "omni");
    try {
      await adapter.connect();
      await adapter.introspect();
      const relation = adapter.listTables(dotted).find(r => r.name === "c");
      assert.ok(relation);
      assert.equal(relation.columns.filter(c => c.name === "id").length, 1);
      assert.equal(relation.columns.some(c => c.isPrimaryKey), false);
      assert.equal(await adapter.updateRow({ schema: dotted, table: "c", set: { v: 9 }, where: { id: 1 } }), 2);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${dotted}".c WHERE v=0`)).rows[0]?.[0], 2);
    } finally { await adapter.close(); }
  } finally {
    await rpc("connection.remove", { connectionId: "security-pg" });
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeBackendResources();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE; DROP SCHEMA IF EXISTS "${dotted}" CASCADE`);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
