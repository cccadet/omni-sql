import { test } from "node:test";
import assert from "node:assert/strict";
import pg, { type Pool, type PoolClient, type Query as PgQuery } from "pg";
import { PostgresAdapter } from "./index.ts";
import {
  applyServerRowCap,
  getDefinitionViaPool,
  introspectSchemas,
  listFunctionsPerSchema,
  listIndexesViaPool,
  listSchemaNames,
  runQueryViaPool,
  updateRowViaPool,
} from "./introspection.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";

// Sem docker/Postgres local: smoke só valida construção + dial refusal.
// Em CI/uso local, setar `PG_TEST_CONNECTION_STRING` para acionar testes reais.

const PG_CONN = process.env.PG_TEST_CONNECTION_STRING;

const cfg = (endpoint = PG_CONN ?? "postgres://nobody@127.0.0.1:1/dummy"): ConnectionConfig => ({
  id: "pg-test",
  label: "PG test",
  dialect: "postgres",
  endpoint,
  user: "nobody",
});

test("PostgresAdapter: constrói sem disparar conexão", () => {
  const a = new PostgresAdapter(cfg());
  assert.equal(a.id, "pg-test");
  assert.equal(a.dialect, "postgres");
  assert.equal(a.dialectDescriptor().dialect, "postgres");
  assert.ok(a.dialectDescriptor().keywords.has("RETURNING"));
  assert.deepEqual(a.listSchemas(), []);
  assert.deepEqual(a.listTables("public"), []);
});

test("PostgresAdapter: factory via construtor produz instância Adapter", () => {
  const a = new PostgresAdapter(cfg());
  assert.equal(a.dialect, "postgres");
});

test("applyServerRowCap limita apenas leitura sem LIMIT/FETCH existente", () => {
  assert.equal(applyServerRowCap("SELECT v FROM items", 10), "SELECT v FROM items LIMIT 11");
  assert.equal(applyServerRowCap("WITH x AS (SELECT 1) SELECT * FROM x;", 2), "WITH x AS (SELECT 1) SELECT * FROM x LIMIT 3;");
  assert.equal(applyServerRowCap("SELECT v FROM items LIMIT 5", 10), "SELECT v FROM items LIMIT 5");
  assert.equal(applyServerRowCap("UPDATE items SET v = 1", 10), "UPDATE items SET v = 1");
  assert.equal(applyServerRowCap("SELECT 'LIMIT 5' AS v -- LIMIT 9\n", 10), "SELECT 'LIMIT 5' AS v LIMIT 11 -- LIMIT 9\n");
});

test("runQueryViaPool envia cap limit+1 ao cursor e preserva rowsMoreAvailable", async () => {
  const calls: string[] = [];
  const queryClient = {
    query(query: PgQuery) {
      const text = (query as unknown as { text: string }).text;
      calls.push(text);
      queueMicrotask(() => {
        if (text.startsWith("FETCH 2")) {
          query.emit("end", {
            rows: [{ v: 1 }, { v: 2 }],
            fields: [{ name: "v", dataTypeID: 23 }],
            rowCount: 2,
          } as never);
        } else if (text.startsWith("FETCH 1")) {
          query.emit("end", { rows: [{ v: 3 }], fields: [], rowCount: 1 } as never);
        } else {
          query.emit("end", { rows: [], fields: [], rowCount: null } as never);
        }
      });
      return query;
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const fakePool = { connect: async () => queryClient } as unknown as Pool;

  const result = await runQueryViaPool(fakePool, "SELECT v FROM items ORDER BY v", 2);

  assert.match(calls[0] ?? "", /SELECT v FROM items ORDER BY v LIMIT 3$/);
  assert.deepEqual(result.rows, [[1], [2]]);
  assert.equal(result.rowsMoreAvailable, true);
});

test("runQueryViaPool não reescreve UPDATE no fallback sem cursor", async () => {
  const calls: string[] = [];
  const queryClient = {
    query(query: PgQuery) {
      const text = (query as unknown as { text: string }).text;
      calls.push(text);
      queueMicrotask(() => {
        if (text.startsWith("DECLARE")) query.emit("error", { code: "42601" } as never);
        else query.emit("end", { rows: [], fields: [], rowCount: 1 } as never);
      });
      return query;
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const fakePool = { connect: async () => queryClient } as unknown as Pool;

  const result = await runQueryViaPool(fakePool, "UPDATE items SET v = 1", 10);

  assert.equal(calls[0]?.includes("LIMIT"), false);
  assert.equal(calls[1], "UPDATE items SET v = 1");
  assert.equal(result.rowsAffected, 1);
});

test("test() retorna ok:false quando não consegue conectar", async () => {
  const a = new PostgresAdapter(cfg("postgres://nobody@127.0.0.1:1/dummy"));
  const t = await a.test();
  assert.equal(t.ok, false);
  assert.ok(t.message);
  await a.close();
});

test("cancelRunning cancela query ativa e não deixa estado após cleanup", async () => {
  let releaseQuery!: () => void;
  const queryFinished = new Promise<void>((resolve) => { releaseQuery = resolve; });
  let queryStarted!: () => void;
  const queryStartedPromise = new Promise<void>((resolve) => { queryStarted = resolve; });
  let queryCalls = 0;
  let released = false;
  let cancelCalls = 0;
  let cancelled: { client: PoolClient; query: PgQuery } | undefined;

  const queryClient = {
    query(query: PgQuery) {
      queryCalls += 1;
      if (queryCalls === 1) {
        queryStarted();
        void queryFinished.then(() => query.emit("end", { rows: [], fields: [], rowCount: null } as never));
      } else {
        queueMicrotask(() => query.emit("end", { rows: [], fields: [], rowCount: null } as never));
      }
      return query;
    },
    release: () => { released = true; },
  } as unknown as PoolClient;
  const fakePool = {
    options: { host: "127.0.0.1", port: 5432, database: "test", user: "test" },
    connect: async () => queryClient,
    end: async () => undefined,
  } as unknown as Pool;

  const originalCancel = (pg.Client.prototype as unknown as {
    cancel(client: PoolClient, query: PgQuery): void;
  }).cancel;
  (pg.Client.prototype as unknown as {
    cancel(client: PoolClient, query: PgQuery): void;
  }).cancel = function (client, query) {
    cancelCalls += 1;
    cancelled = { client, query };
  };

  const a = new PostgresAdapter(cfg());
  (a as unknown as { pool: Pool }).pool = fakePool;
  try {
    const run = a.runQuery("SELECT 1", 10);
    await queryStartedPromise;
    assert.equal(released, false);
    await a.cancelRunning();
    assert.ok(cancelled);

    releaseQuery();
    await run;
    await a.cancelRunning();
    assert.equal(cancelCalls, 1);
    assert.equal(cancelled?.client, queryClient);
    assert.equal(released, true);
  } finally {
    (pg.Client.prototype as unknown as {
      cancel(client: PoolClient, query: PgQuery): void;
    }).cancel = originalCancel;
    await a.close();
  }
});

test("PostgreSQL metadata helpers preserve filtered relations, overloads, definitions, and bound updates", async () => {
  const calls: Array<{ sql: string; values: readonly unknown[] | undefined }> = [];
  const responses = [
    { rows: [{ schema_name: "public" }] },
    {
      rows: [
        { index_name: "pk_orders", is_unique: true, is_primary: true, column_name: "id", ordinal: 1 },
        { index_name: "idx_orders_customer", is_unique: false, is_primary: false, column_name: "customer_id", ordinal: 2 },
        { index_name: "idx_orders_customer", is_unique: false, is_primary: false, column_name: "created_at", ordinal: 1 },
      ],
    },
    { rows: [{ definition: "SELECT * FROM orders" }] },
    { rows: [{ def: "CREATE FUNCTION public.order_total() RETURNS integer AS $$ SELECT 1 $$ LANGUAGE sql" }] },
    {
      rows: [
        { table_schema: "public", table_name: "orders", table_type: "BASE TABLE" },
        { table_schema: "ignored", table_name: "audit", table_type: "BASE TABLE" },
      ],
    },
    {
      rows: [
        {
          table_schema: "public",
          table_name: "orders",
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
          column_default: null,
          ordinal_position: 1,
          is_pk: true,
          fk_schema: null,
          fk_table: null,
          fk_column: null,
        },
        {
          table_schema: "public",
          table_name: "orders",
          column_name: "customer_id",
          data_type: "integer",
          is_nullable: "YES",
          column_default: "0",
          ordinal_position: 2,
          is_pk: false,
          fk_schema: "public",
          fk_table: "customers",
          fk_column: "id",
        },
      ],
    },
    {
      rows: [{
        schema: "public",
        name: "order_total",
        arg_names: ["customer", "total"],
        arg_types: ["integer", "numeric"],
        arg_modes: ["i", "b"],
        ret_type: "numeric",
      }],
    },
    { rowCount: 1 },
  ];
  const query = async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    const response = responses.shift();
    assert.ok(response, "unexpected SQL query");
    return response;
  };
  const pool = {
    query,
    connect: async () => ({ query, release: () => undefined }),
  } as unknown as Pool;
  const client = pool as unknown as PoolClient;

  assert.deepEqual(await listSchemaNames(client), ["public"]);
  assert.deepEqual(await listIndexesViaPool(pool, "public", "orders"), [
    { name: "pk_orders", unique: true, primary: true, columns: ["id"] },
    { name: "idx_orders_customer", unique: false, primary: false, columns: ["created_at", "customer_id"] },
  ]);
  assert.equal(
    await getDefinitionViaPool(pool, "view", "public", "orders"),
    "CREATE OR REPLACE VIEW \"public\".\"orders\" AS\nSELECT * FROM orders",
  );
  assert.match(await getDefinitionViaPool(pool, "function", "public", "order_total"), /^CREATE FUNCTION/u);
  assert.deepEqual(await introspectSchemas(client, ["public"]), [[
    0,
    "public",
    [{
      schema: "public",
      name: "orders",
      kind: "table",
      columns: [
        { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinalPosition: 1 },
        {
          name: "customer_id",
          dataType: "integer",
          nullable: true,
          isPrimaryKey: false,
          ordinalPosition: 2,
          defaultValue: "0",
          foreignKeyTo: { schema: "public", table: "customers", column: "id" },
        },
      ],
      constraints: [
        { name: "pk", kind: "primary", columns: ["id"] },
        {
          name: "fk_customer_id",
          kind: "foreign",
          columns: ["customer_id"],
          references: { schema: "public", table: "customers", column: "id" },
        },
      ],
    }],
  ]]);
  assert.deepEqual(await listFunctionsPerSchema(client, "public"), [{
    schema: "public",
    name: "order_total",
    overloads: [{
      parameters: [
        { name: "customer", dataType: "integer", mode: "in", ordinalPosition: 0 },
        { name: "total", dataType: "numeric", mode: "inout", ordinalPosition: 1 },
      ],
      returnType: "numeric",
    }],
  }]);
  assert.equal(await updateRowViaPool(pool, {
    schema: "public",
    table: "orders",
    set: { state: "done" },
    where: { id: 7 },
  }), 1);
  assert.deepEqual(calls.at(-1), {
    sql: "UPDATE \"public\".\"orders\" SET \"state\" = $1 WHERE \"id\" = $2",
    values: ["done", 7],
  });
  assert.equal(applyServerRowCap("SELECT $$LIMIT$$ AS value", 1), "SELECT $$LIMIT$$ AS value LIMIT 2");
  assert.equal(applyServerRowCap("SELECT 1; SELECT 2", 1), "SELECT 1; SELECT 2");
});

if (PG_CONN) {
  test("introspect real + runQuery SELECT 1 + completion metadata", async () => {
    const a = new PostgresAdapter(cfg(PG_CONN));
    try {
      await a.connect();
      const db = await a.introspect();
      assert.ok(db.schemas.length >= 1, "esperava ao menos 1 schema");

      const r = await a.runQuery("SELECT 1 AS v", 100);
      assert.equal(r.columns.length, 1);
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0]?.[0], 1);
    } finally {
      await a.close();
    }
  });
} else {
  test("introspect real: SKIPPED (set PG_TEST_CONNECTION_STRING para rodar)", { skip: true }, () => {
    assert.ok(true);
  });
}
