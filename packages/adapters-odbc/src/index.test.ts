import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import { OdbcAdapter, buildOdbcConnectionString } from "./index.ts";

const config: ConnectionConfig = {
  id: "odbc-test", label: "Mock ODBC", dialect: "odbc", endpoint: "Test DSN", user: "alice",
};

test("builds DSN and DSN-less connection strings without persisting credentials", () => {
  assert.equal(buildOdbcConnectionString("Corporate DB", "alice", "s}ecret"), "DSN={Corporate DB};UID={alice};PWD={s}}ecret}");
  assert.equal(buildOdbcConnectionString("DRIVER={SQLite3};Database=C:\\db.sqlite;", "", undefined), "DRIVER={SQLite3};Database=C:\\db.sqlite");
});

test("ODBC introspects tables, views, columns, and primary keys through the driver", async () => {
  let closeCount = 0;
  const connection = {
    close: async () => { closeCount++; },
    tables: async () => [
      { TABLE_CAT: "catalog", TABLE_SCHEM: "public", TABLE_NAME: "orders", TABLE_TYPE: "TABLE", REMARKS: " Orders " },
      { TABLE_CAT: "catalog", TABLE_SCHEM: "public", TABLE_NAME: "orders", TABLE_TYPE: "TABLE" },
      { TABLE_CAT: "catalog", TABLE_SCHEM: "public", TABLE_NAME: "order_view", TABLE_TYPE: "VIEW" },
      { TABLE_NAME: "" },
    ],
    columns: async (_catalog: unknown, _schema: unknown, table: string) => table === "orders"
      ? [
          { COLUMN_NAME: "name", TYPE_NAME: "VARCHAR", NULLABLE: 1, ORDINAL_POSITION: 2, REMARKS: " Label " },
          { COLUMN_NAME: "id", TYPE_NAME: "INTEGER", NULLABLE: 0, ORDINAL_POSITION: 1 },
        ]
      : [],
    primaryKeys: async (_catalog: unknown, _schema: unknown, table: string) => table === "orders"
      ? [{ COLUMN_NAME: "id" }] : [],
  };
  const driver = { connect: async () => connection } as unknown as ConstructorParameters<typeof OdbcAdapter>[2];
  const adapter = new OdbcAdapter(config, "secret", driver);
  assert.deepEqual(await adapter.listAvailableSchemas(), ["public"]);
  await adapter.introspect();
  assert.deepEqual(adapter.listTables("public").map((table) => [table.name, table.kind]), [
    ["orders", "table"], ["order_view", "view"],
  ]);
  const columns = adapter.listColumns("public", "orders");
  assert.deepEqual(columns.map((column) => column.name), ["id", "name"]);
  assert.equal(columns[0]?.isPrimaryKey, true);
  assert.equal(columns[1]?.description, "Label");
  await adapter.close();
  assert.equal(closeCount, 1);
});

test("ODBC returns bounded query rows and closes its cursor", async () => {
  let closed = false;
  const result = Object.assign([
    { id: 1, amount: 12n, created: new Date("2026-09-16T00:00:00.000Z") },
    { id: 2, amount: 13n, created: new Date("2026-09-17T00:00:00.000Z") },
  ], {
    columns: [
      { name: "id", dataTypeName: "INTEGER", dataType: 4, nullable: false },
      { name: "amount", dataTypeName: "BIGINT", dataType: -5, nullable: false },
      { name: "created", dataTypeName: "TIMESTAMP", dataType: 93, nullable: false },
    ],
    count: -1,
  });
  const connection = {
    close: async () => undefined,
    query: async () => ({ fetch: async () => result, close: async () => { closed = true; }, noData: false }),
  };
  const driver = { connect: async () => connection } as unknown as ConstructorParameters<typeof OdbcAdapter>[2];
  const adapter = new OdbcAdapter(config, undefined, driver);
  const query = await adapter.runQuery("SELECT * FROM orders", 1);
  assert.deepEqual(query.rows, [[1, "12", "2026-09-16T00:00:00.000Z"]]);
  assert.equal(query.rowsMoreAvailable, true);
  assert.equal(query.rowsAffected, undefined);
  assert.equal(closed, true);
  await adapter.close();
});

test("ODBC streams bounded batches into Analyze Locally and closes the cursor", async () => {
  let fetches = 0;
  let closed = false;
  const columns = [{ name: "id", dataTypeName: "INTEGER", dataType: 4, nullable: false }];
  const connection = {
    close: async () => undefined,
    query: async () => ({
      fetch: async () => {
        fetches++;
        return Object.assign(fetches === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }], { columns, count: -1 });
      },
      get noData() { return fetches >= 2; },
      close: async () => { closed = true; },
    }),
  };
  const driver = { connect: async () => connection } as unknown as ConstructorParameters<typeof OdbcAdapter>[2];
  const adapter = new OdbcAdapter(config, undefined, driver);
  const batches = [];
  for await (const batch of adapter.streamQuery("SELECT id FROM customers", { batchSize: 2, signal: new AbortController().signal })) batches.push(batch);
  assert.deepEqual(batches.map((batch) => batch.rows), [[[1], [2]], [[3]]]);
  assert.equal(closed, true);
  await adapter.close();
});

test("ODBC classifies driver errors without exposing passwords", async () => {
  const driver = { connect: async () => { throw new Error("IM002 driver not found;PWD=secret"); } } as unknown as ConstructorParameters<typeof OdbcAdapter>[2];
  const adapter = new OdbcAdapter(config, "secret", driver);
  const status = await adapter.test();
  assert.equal(status.ok, false);
  assert.match(status.message ?? "", /PWD=\*\*\*/u);
  assert.doesNotMatch(status.message ?? "", /secret/u);
  await assert.rejects(adapter.connect(), (error: unknown) =>
    error instanceof Error && "causeTag" in error && error.causeTag === "driver-missing");
});
