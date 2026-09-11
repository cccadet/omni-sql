import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import { OdbcAdapter } from "./index.ts";

test("SQLite ODBC executes bounded queries and introspects columns and primary keys", {
  skip: process.env.OMNI_SQL_RUN_ODBC_INTEGRATION !== "1",
}, async () => {
  const config: ConnectionConfig = {
    id: "odbc-integration",
    label: "SQLite ODBC integration",
    dialect: "odbc",
    endpoint: `DRIVER={SQLite3};Database=${process.env.OMNI_SQL_ODBC_SQLITE_PATH ?? "/tmp/omni-odbc.sqlite"}`,
    user: "",
  };
  const adapter = new OdbcAdapter(config);
  try {
    assert.equal((await adapter.test()).ok, true);
    await adapter.runQuery("DROP TABLE IF EXISTS customers", 10);
    await adapter.runQuery("CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL)", 10);
    await adapter.runQuery("INSERT INTO customers (id, name) VALUES (1, 'Ada'), (2, 'Linus'), (3, 'Grace')", 10);
    const result = await adapter.runQuery("SELECT id, name FROM customers ORDER BY id", 2);
    assert.deepEqual(result.rows, [[1, "Ada"], [2, "Linus"]]);
    assert.equal(result.rowsMoreAvailable, true);
    await adapter.introspect();
    const schemas = adapter.listSchemas();
    assert.ok(schemas.length > 0);
    const schema = schemas.find((item) => adapter.listTables(item.name).some((table) => table.name === "customers"));
    assert.ok(schema);
    const columns = adapter.listColumns(schema.name, "customers");
    assert.deepEqual(columns.map((column) => column.name), ["id", "name"]);
    assert.equal(columns.find((column) => column.name === "id")?.isPrimaryKey, true);
  } finally { await adapter.close(); }
});
