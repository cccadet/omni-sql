import type { ConnectionConfig } from "@omni-sql/ts-types";
import type { Adapter } from "@omni-sql/adapters-core";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresAdapter } from "@omni-sql/adapters-pg";
import { MysqlAdapter } from "@omni-sql/adapters-mysql";

// MCP read-only access relies on the database, not only on the lexical check:
// these statements look like reads but write through functions.
const enabled = process.env.OMNI_SQL_RUN_SECURITY_INTEGRATION === "1";
const pgEndpoint = process.env.PG_TEST_CONNECTION_STRING;

function pgConfig(): ConnectionConfig {
  const uri = new URL(pgEndpoint!);
  return { id: "security-mcp-pg", label: "MCP read-only", dialect: "postgres", endpoint: `${uri.host}${uri.pathname}`, user: decodeURIComponent(uri.username) };
}

async function assertDatabaseBlocksHiddenWrites(adapter: Adapter, table: string, hiddenWrites: ReadonlyArray<readonly [string, RegExp]>, setup: readonly string[], teardown: readonly string[]) {
  try {
    await adapter.connect();
    for (const sql of setup) await adapter.runQuery(sql, 10);
    for (const [sql, error] of hiddenWrites) {
      await assert.rejects(adapter.runReadOnlyQuery!(sql, 10), error, sql);
    }
    assert.equal(Number((await adapter.runQuery(`SELECT count(*) FROM ${table}`, 10)).rows[0]?.[0]), 2);
    const read = await adapter.runReadOnlyQuery!(`SELECT id FROM ${table} ORDER BY id`, 1);
    assert.deepEqual(read.rows.map((row) => Number(row[0])), [1]);
    assert.equal(read.rowsMoreAvailable, true);
    // The connection is returned to the pool outside any transaction.
    await adapter.runQuery(`INSERT INTO ${table} VALUES (3)`, 10);
    assert.equal(Number((await adapter.runQuery(`SELECT count(*) FROM ${table}`, 10)).rows[0]?.[0]), 3);
  } finally {
    for (const sql of teardown) await adapter.runQuery(sql, 10).catch(() => undefined);
    await adapter.close();
  }
}

test("PostgreSQL read-only MCP execution rejects writes hidden behind functions and extra statements", { skip: !enabled || !pgEndpoint, timeout: 60_000 }, async () => {
  const name = `mcp_ro_${process.pid}`;
  const adapter = new PostgresAdapter(pgConfig(), decodeURIComponent(new URL(pgEndpoint!).password));
  await assertDatabaseBlocksHiddenWrites(adapter, name, [
    [`SELECT ${name}_purge()`, /read-only transaction/],
    [`SELECT nextval('${name}_seq')`, /read-only transaction/],
    // The extended protocol refuses a second statement, so COMMIT cannot end the read-only transaction.
    [`SELECT 1; COMMIT; DELETE FROM ${name}`, /multiple commands/],
  ], [
    `CREATE TABLE ${name} (id integer)`,
    `INSERT INTO ${name} VALUES (1), (2)`,
    `CREATE SEQUENCE ${name}_seq`,
    `CREATE FUNCTION ${name}_purge() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN DELETE FROM ${name}; RETURN 0; END $$`,
  ], [
    `DROP FUNCTION ${name}_purge()`,
    `DROP SEQUENCE ${name}_seq`,
    `DROP TABLE ${name}`,
  ]);
});

for (const [dialect, port] of [["mysql", 3306], ["mariadb", 3307]] as const) {
  test(`${dialect}: read-only MCP execution rejects writes hidden behind functions`, { skip: !enabled, timeout: 60_000 }, async () => {
    const name = `mcp_ro_${dialect}_${process.pid}`;
    const config: ConnectionConfig = { id: `security-mcp-${dialect}`, label: "MCP read-only", dialect, endpoint: `127.0.0.1:${port}/omni_test`, user: "root" };
    // With binary logging on, MySQL requires a privileged user and a DETERMINISTIC declaration.
    await assertDatabaseBlocksHiddenWrites(new MysqlAdapter(config, "root"), `\`${name}\``, [
      [`SELECT \`${name}_purge\`()`, /READ ONLY transaction/i],
    ], [
      `CREATE TABLE \`${name}\` (id int) ENGINE=InnoDB`,
      `INSERT INTO \`${name}\` VALUES (1), (2)`,
      `CREATE FUNCTION \`${name}_purge\`() RETURNS int DETERMINISTIC MODIFIES SQL DATA BEGIN DELETE FROM \`${name}\`; RETURN 0; END`,
    ], [
      `DROP FUNCTION \`${name}_purge\``,
      `DROP TABLE \`${name}\``,
    ]);
  });
}
