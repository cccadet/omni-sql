import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import { SqliteAdapter, resolveSqlitePath } from "./index.ts";

const dir = mkdtempSync(join(tmpdir(), "omni-sqlite-"));
const file = join(dir, "app.db");
const attached = join(dir, "archive.db");

function adapterFor(endpoint: string, options?: ConnectionConfig["options"], schemas?: string[]): SqliteAdapter {
  return new SqliteAdapter({ id: "sqlite-test", label: "SQLite", dialect: "sqlite", endpoint, user: "", ...(options ? { options } : {}), ...(schemas ? { schemas } : {}) });
}

before(() => {
  const seed = new DatabaseSync(file);
  seed.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT DEFAULT 'anon');
    CREATE TABLE orders (
      id INTEGER NOT NULL, line INTEGER NOT NULL,
      customer_id INTEGER REFERENCES customers,
      total REAL, payload BLOB,
      PRIMARY KEY (id, line)
    );
    CREATE INDEX orders_customer ON orders (customer_id);
    CREATE VIEW big_orders AS SELECT id, total FROM orders WHERE total > 100;
    INSERT INTO customers (id, email) VALUES (1, 'a@x'), (2, 'b@x'), (3, 'c@x');
    INSERT INTO orders VALUES (1, 1, 1, 50.5, x'cafe'), (1, 2, 1, 150, NULL), (2, 1, 2, 75, NULL);
  `);
  seed.exec(`ATTACH '${attached}' AS archive; CREATE TABLE archive.old_orders (id INTEGER PRIMARY KEY); DETACH archive;`);
  seed.close();
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("endpoint must be an existing absolute file or :memory:", async () => {
  assert.equal(resolveSqlitePath(` sqlite://${file} `), file);
  assert.equal(resolveSqlitePath(":memory:"), ":memory:");
  assert.throws(() => resolveSqlitePath("relative/app.db"), /absolute/);
  assert.throws(() => resolveSqlitePath(""), /required/);

  const missing = adapterFor(join(dir, "typo.db"));
  const result = await missing.test();
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /not found/);
  // Connecting must not create the mistyped file.
  await assert.rejects(missing.connect(), /not found/);
  await assert.rejects(adapterFor(dir).connect(), /not a file/);
});

test("introspects tables, views, keys, defaults and attached databases", async () => {
  const adapter = adapterFor(file);
  try {
    assert.equal((await adapter.test()).ok, true);
    adapter["connection"]().exec(`ATTACH '${attached}' AS archive`);
    assert.deepEqual(await adapter.listAvailableSchemas(), ["main", "archive"]);

    const db = await adapter.introspect();
    assert.equal(db.name, "app.db");
    assert.deepEqual(adapter.listSchemas().map((schema) => schema.name), ["main", "archive"]);
    assert.deepEqual(adapter.listTables("main").map((relation) => [relation.name, relation.kind]), [
      ["big_orders", "view"], ["customers", "table"], ["orders", "table"],
    ]);
    assert.deepEqual(adapter.listTables("archive").map((relation) => relation.name), ["old_orders"]);

    const customers = adapter.listTables("main").find((relation) => relation.name === "customers")!;
    assert.deepEqual(customers.columns.map((column) => [column.name, column.dataType, column.nullable, column.isPrimaryKey, column.defaultValue]), [
      ["id", "INTEGER", true, true, undefined],
      ["email", "TEXT", false, false, undefined],
      ["name", "TEXT", true, false, "'anon'"],
    ]);
    assert.deepEqual(customers.constraints.find((constraint) => constraint.kind === "unique")?.columns, ["email"]);

    const orders = adapter.listColumns("main", "orders");
    // `REFERENCES customers` without a column resolves to the parent's primary key.
    assert.deepEqual(orders.find((column) => column.name === "customer_id")?.foreignKeyTo, { schema: "main", table: "customers", column: "id" });
    const ordersRelation = adapter.listTables("main").find((relation) => relation.name === "orders")!;
    assert.deepEqual(ordersRelation.constraints.find((constraint) => constraint.kind === "primary")?.columns, ["id", "line"]);

    assert.ok(adapter.listFunctions("main").some((fn) => fn.name === "substr"));
    assert.deepEqual(adapter.listFunctions("archive"), []);

    const filtered = adapterFor(file, undefined, ["main"]);
    await filtered.introspect();
    assert.deepEqual(filtered.listSchemas().map((schema) => schema.name), ["main"]);
    await filtered.close();
  } finally {
    await adapter.close();
  }
});

test("runs queries with limits, exact big integers, BLOBs and affected rows", async () => {
  const adapter = adapterFor(file);
  try {
    const page = await adapter.runQuery("SELECT id, line, total, payload, total * 2 AS doubled FROM orders ORDER BY id, line", 2);
    assert.equal(page.rowsMoreAvailable, true);
    assert.deepEqual(page.rows, [[1, 1, 50.5, "0xcafe", 101], [1, 2, 150, null, 300]]);
    assert.deepEqual(page.columns.map((column) => [column.name, column.dataType]), [
      ["id", "INTEGER"], ["line", "INTEGER"], ["total", "REAL"], ["payload", "BLOB"], ["doubled", "real"],
    ]);

    const big = await adapter.runQuery("SELECT 9007199254740993 AS big, 42 AS small", 10);
    assert.deepEqual(big.rows, [["9007199254740993", 42]]);
    assert.deepEqual(big.columns.map((column) => column.dataType), ["integer", "integer"]);

    const update = await adapter.runQuery("UPDATE customers SET name = 'vip' WHERE id IN (1, 2)", 10);
    assert.equal(update.rowsAffected, 2);
    assert.deepEqual(update.columns, []);

    const empty = await adapter.runQuery("SELECT * FROM customers WHERE id < 0", 10);
    assert.deepEqual(empty.columns.map((column) => column.name), ["id", "email", "name"]);
    assert.deepEqual(empty.rows, []);
  } finally {
    await adapter.close();
  }
});

test("read-only execution cannot write, even after PRAGMA query_only = OFF", async () => {
  const adapter = adapterFor(file);
  try {
    assert.deepEqual((await adapter.runReadOnlyQuery("SELECT count(*) FROM customers", 10)).rows, [[3]]);
    await assert.rejects(adapter.runReadOnlyQuery("DELETE FROM customers", 10), /readonly/i);
    await adapter.runReadOnlyQuery("PRAGMA query_only = OFF", 10);
    await assert.rejects(adapter.runReadOnlyQuery("DELETE FROM customers", 10), /readonly/i);
    assert.deepEqual((await adapter.runQuery("SELECT count(*) FROM customers", 10)).rows, [[3]]);
  } finally {
    await adapter.close();
  }

  const opened = adapterFor(file, { readOnly: true });
  try {
    await assert.rejects(opened.runQuery("DELETE FROM customers", 10), /readonly/i);
  } finally {
    await opened.close();
  }

  const memory = adapterFor(":memory:");
  try {
    await memory.runQuery("CREATE TABLE t (x)", 10);
    await assert.rejects(memory.runReadOnlyQuery("INSERT INTO t VALUES (1)", 10), /readonly|query_only/i);
    await assert.rejects(memory.runReadOnlyQuery("PRAGMA query_only = OFF", 10), /not allowed/);
    // query_only is restored after the read-only call.
    assert.equal((await memory.runQuery("INSERT INTO t VALUES (1)", 10)).rowsAffected, 1);
  } finally {
    await memory.close();
  }
});

test("validates without executing and explains the plan as a tree", async () => {
  const adapter = adapterFor(file);
  try {
    assert.deepEqual(await adapter.validateQuery("DELETE FROM customers"), []);
    assert.deepEqual((await adapter.runQuery("SELECT count(*) FROM customers", 10)).rows, [[3]]);
    const [diagnostic] = await adapter.validateQuery("SELECT * FROM missing_table");
    assert.match(diagnostic?.message ?? "", /no such table/);
    assert.equal(diagnostic?.targetDialect, "sqlite");

    const plan = await adapter.explain("SELECT * FROM orders JOIN customers ON customers.id = orders.customer_id");
    assert.equal(plan.format, "text");
    assert.match(plan.textual, /customers/);
    assert.ok(Array.isArray(plan.raw));
  } finally {
    await adapter.close();
  }
});

test("lists indexes, including the rowid primary key, and object definitions", async () => {
  const adapter = adapterFor(file);
  try {
    assert.deepEqual(await adapter.listIndexes("main", "customers"), [
      { name: "PRIMARY KEY", unique: true, primary: true, columns: ["id"] },
      { name: "sqlite_autoindex_customers_1", unique: true, primary: false, columns: ["email"] },
    ]);
    const orderIndexes = await adapter.listIndexes("main", "orders");
    assert.deepEqual(orderIndexes.map((index) => [index.name, index.primary, index.columns]), [
      ["orders_customer", false, ["customer_id"]],
      ["sqlite_autoindex_orders_1", true, ["id", "line"]],
    ]);

    assert.match(await adapter.getDefinition("view", "main", "big_orders"), /^CREATE VIEW big_orders/);
    await assert.rejects(adapter.getDefinition("function", "main", "substr"), /no SQL definition/);
    const ddl = await adapter.getTableDefinition("main", "orders");
    assert.match(ddl, /CREATE TABLE orders[\s\S]*;\n\nCREATE INDEX orders_customer ON orders \(customer_id\);$/);
    await assert.rejects(adapter.getDefinition("view", "main", "nope"), /not found/);
  } finally {
    await adapter.close();
  }
});

test("updates and inserts rows with parameters and quoted identifiers", async () => {
  const memory = adapterFor(":memory:");
  try {
    await memory.runQuery(`CREATE TABLE "odd ""name""" (id INTEGER PRIMARY KEY, label TEXT DEFAULT 'x', flag INTEGER, meta TEXT)`, 10);
    assert.equal(await memory.insertRow({ schema: null, table: 'odd "name"', values: {} }), 1);
    assert.equal(await memory.insertRow({ schema: "main", table: 'odd "name"', values: { id: 5, label: "it's", flag: true, meta: { a: 1 } } }), 1);
    assert.equal(await memory.updateRow({ schema: "main", table: 'odd "name"', set: { label: null, flag: false }, where: { id: 5 } }), 1);
    assert.equal(await memory.updateRow({ schema: null, table: 'odd "name"', set: { flag: 1 }, where: { label: null } }), 1);
    assert.deepEqual((await memory.runQuery(`SELECT id, label, flag, meta FROM "odd ""name""" ORDER BY id`, 10)).rows, [
      [1, "x", null, null],
      [5, null, 1, '{"a":1}'],
    ]);
    await assert.rejects(memory.updateRow({ schema: null, table: 'odd "name"', set: {}, where: { id: 1 } }), /no columns/);
    await assert.rejects(memory.updateRow({ schema: null, table: 'odd "name"', set: { flag: 1 }, where: {} }), /primary key/);
  } finally {
    await memory.close();
  }
});

test("streams bounded batches and stops when aborted", async () => {
  const memory = adapterFor(":memory:");
  try {
    await memory.runQuery("CREATE TABLE n AS WITH RECURSIVE s(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM s WHERE x < 25) SELECT x FROM s", 10);
    const sizes: number[] = [];
    for await (const batch of memory.streamQuery("SELECT x FROM n", { batchSize: 10, signal: new AbortController().signal })) {
      sizes.push(batch.rows.length);
      assert.deepEqual(batch.columns.map((column) => column.name), ["x"]);
    }
    assert.deepEqual(sizes, [10, 10, 5]);

    const empty: number[] = [];
    for await (const batch of memory.streamQuery("SELECT x FROM n WHERE x < 0", { batchSize: 10, signal: new AbortController().signal })) empty.push(batch.rows.length);
    assert.deepEqual(empty, [0]);

    const controller = new AbortController();
    await assert.rejects(async () => {
      for await (const _batch of memory.streamQuery("SELECT x FROM n", { batchSize: 10, signal: controller.signal })) controller.abort();
    }, /cancelled/);
    await assert.rejects(async () => {
      for await (const _batch of memory.streamQuery("SELECT 1", { batchSize: 0, signal: controller.signal })) { /* unreachable */ }
    }, /batch size/);
  } finally {
    await memory.close();
  }
});
