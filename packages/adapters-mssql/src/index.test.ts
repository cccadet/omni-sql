import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnectionPool, Request } from "mssql";
import { MssqlAdapter } from "./index.ts";
import {
  getDefinitionViaPool,
  introspectSchemas,
  listFunctionsPerSchema,
  listIndexesViaPool,
  listSchemaNames,
  runQueryViaPool,
  updateRowViaPool,
} from "./introspection.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";

// Sem docker/SQL Server local: smoke só valida construção + recusa de dial.
// Em CI/uso local, setar `MSSQL_TEST_CONNECTION_STRING` (formato `host:port/db`)
// para acionar testes reais.

const MSSQL_CONN = process.env.MSSQL_TEST_CONNECTION_STRING;
const MSSQL_PASSWORD = process.env.MSSQL_TEST_PASSWORD;

const cfg = (endpoint = MSSQL_CONN ?? "127.0.0.1:1/dummy"): ConnectionConfig => ({
  id: "mssql-test",
  label: "SQL Server test",
  dialect: "sqlserver",
  endpoint,
  user: "sa",
});

test("MssqlAdapter: constrói sem disparar conexão", () => {
  const a = new MssqlAdapter(cfg());
  assert.equal(a.id, "mssql-test");
  assert.equal(a.dialect, "sqlserver");
  assert.equal(a.dialectDescriptor().dialect, "sqlserver");
  assert.ok(a.dialectDescriptor().keywords.has("TOP"));
  assert.deepEqual(a.listSchemas(), []);
  assert.deepEqual(a.listTables("dbo"), []);
});

test("MssqlAdapter: factory via construtor produz instância Adapter", () => {
  const a = new MssqlAdapter(cfg());
  assert.equal(a.dialect, "sqlserver");
});

test("test() retorna ok:false quando não consegue conectar", async () => {
  const a = new MssqlAdapter(cfg("127.0.0.1:1/dummy"), "nobody");
  const t = await a.test();
  assert.equal(t.ok, false);
  assert.ok(t.message);
  await a.close();
});

test("cancelRunning cancela Request ativo e não limpa Request mais novo", async () => {
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  let finishFirst!: () => void;
  let rejectSecond!: (error: Error) => void;
  let cancelCalls = 0;
  let requestNumber = 0;

  const firstRequest = {
    arrayRowMode: false,
    input: () => firstRequest,
    query: async () => {
      firstStarted();
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      return { recordset: [], rowsAffected: [] };
    },
    cancel: () => { cancelCalls += 1; },
  } as unknown as Request;
  const secondRequest = {
    arrayRowMode: false,
    input: () => secondRequest,
    query: async () => {
      secondStarted();
      await new Promise<never>((_resolve, reject) => { rejectSecond = reject; });
    },
    cancel: () => {
      cancelCalls += 1;
      rejectSecond(new Error("query cancelled"));
    },
  } as unknown as Request;
  const pool = {
    request: () => requestNumber++ === 0 ? firstRequest : secondRequest,
  } as unknown as ConnectionPool;
  const a = new MssqlAdapter(cfg());
  (a as unknown as { poolPromise: Promise<ConnectionPool> | null }).poolPromise = Promise.resolve(pool);

  const firstRun = a.runQuery("SELECT 1", 10);
  await new Promise<void>((resolve) => { firstStarted = resolve; });
  const secondRun = a.runQuery("SELECT 2", 10);
  await new Promise<void>((resolve) => { secondStarted = resolve; });

  finishFirst();
  await firstRun;
  await a.cancelRunning();
  await assert.rejects(secondRun, /query cancelled/);
  await a.cancelRunning();

  assert.equal(cancelCalls, 1);
});

test("runQueryViaPool caps simple SELECT server-side and preserves ORDER BY", async () => {
  let queryText = "";
  let boundLimit: number | undefined;
  const request = {
    arrayRowMode: false,
    input: (name: string, value: number) => {
      assert.equal(name, "omni_limit");
      boundLimit = value;
      return request;
    },
    query: async (text: string) => {
      queryText = text;
      const recordset = [[1], [2]] as unknown[][] & {
        columns?: Record<string, { index: number; type: unknown }>;
      };
      recordset.columns = { value: { index: 0, type: Number } };
      return { recordset };
    },
  } as unknown as Request;
  const pool = { request: () => request } as unknown as ConnectionPool;

  const result = await runQueryViaPool(pool, "SELECT DISTINCT value\nFROM dbo.items\nORDER BY value", 1);

  assert.equal(queryText, "SELECT DISTINCT TOP (@omni_limit) value\nFROM dbo.items\nORDER BY value");
  assert.equal(boundLimit, 2);
  assert.deepEqual(result.rows, [[1]]);
  assert.equal(result.rowsMoreAvailable, true);
});

test("runQueryViaPool bypasses unsafe SQL without changing binds", async () => {
  const queryTexts: string[] = [];
  const boundNames: string[] = [];
  const request = {
    arrayRowMode: false,
    input: (name: string) => {
      boundNames.push(name);
      return request;
    },
    query: async (text: string) => {
      queryTexts.push(text);
      return { recordset: [] };
    },
  } as unknown as Request;
  const pool = { request: () => request } as unknown as ConnectionPool;

  await runQueryViaPool(pool, "SELECT value FROM dbo.items UNION SELECT value FROM dbo.archive", 1);

  assert.deepEqual(queryTexts, ["SELECT value FROM dbo.items UNION SELECT value FROM dbo.archive"]);
  assert.deepEqual(boundNames, []);
});

test("runQueryViaPool caps SELECT despite comments and quoted SQL keywords, but fails closed for ambiguous batches", async () => {
  async function run(sql: string, limit = 1): Promise<{ queryText: string; boundNames: string[] }> {
    let queryText = "";
    const boundNames: string[] = [];
    const request = {
      arrayRowMode: false,
      input: (name: string) => {
        boundNames.push(name);
        return request;
      },
      query: async (text: string) => {
        queryText = text;
        const recordset = [] as unknown as { columns: Record<string, unknown> };
        recordset.columns = {};
        return { recordset };
      },
    } as unknown as Request;
    const pool = { request: () => request } as unknown as ConnectionPool;
    await runQueryViaPool(pool, sql, limit);
    return { queryText, boundNames };
  }

  const decorated = "/* outer /* nested */ comment */ -- SELECT in a comment\nSELECT 'SELECT ''TOP''' AS \"value\" FROM [items]]archive]";
  assert.deepEqual(await run(decorated), {
    queryText: "/* outer /* nested */ comment */ -- SELECT in a comment\nSELECT TOP (@omni_limit) 'SELECT ''TOP''' AS \"value\" FROM [items]]archive]",
    boundNames: ["omni_limit"],
  });

  for (const sql of [
    "/* unclosed SELECT",
    "SELECT 'unclosed",
    "SELECT \"unclosed",
    "SELECT [unclosed",
    "SELECT (value",
    "SELECT value;",
    "SELECT value UNION SELECT archived_value",
  ]) {
    assert.deepEqual(await run(sql), { queryText: sql, boundNames: [] }, sql);
  }
  assert.deepEqual(await run("SELECT value", -1), { queryText: "SELECT value", boundNames: [] });
});

test("introspection helpers preserve schema metadata, function signatures, index order, and bound updates", async () => {
  const requests: Array<{ inputs: Array<[string, unknown]>; sql: string }> = [];
  const responses = [
    { recordset: [{ schema_name: "app" }] },
    {
      recordset: [
        { index_name: "pk_orders", is_unique: true, is_primary: true, column_name: "id", ordinal: 1 },
        { index_name: "idx_orders_customer", is_unique: false, is_primary: false, column_name: "customer_id", ordinal: 2 },
        { index_name: "idx_orders_customer", is_unique: false, is_primary: false, column_name: "created_at", ordinal: 1 },
      ],
    },
    { recordset: [{ definition: "CREATE VIEW [app].[orders] AS SELECT 1" }] },
    {
      recordset: [
        { table_schema: "app", table_name: "orders", table_type: "BASE TABLE" },
        { table_schema: "app", table_name: "order_view", table_type: "VIEW" },
        { table_schema: "ignored", table_name: "audit", table_type: "BASE TABLE" },
      ],
    },
    {
      recordset: [
        {
          table_schema: "app",
          table_name: "orders",
          column_name: "id",
          data_type: "int",
          is_nullable: "NO",
          column_default: null,
          ordinal_position: 1,
          is_pk: 1,
          fk_schema: null,
          fk_table: null,
          fk_column: null,
        },
        {
          table_schema: "app",
          table_name: "orders",
          column_name: "customer_id",
          data_type: "int",
          is_nullable: "YES",
          column_default: "0",
          ordinal_position: 2,
          is_pk: 0,
          fk_schema: "app",
          fk_table: "customers",
          fk_column: "id",
        },
      ],
    },
    { recordset: [{ schema: "app", name: "order_total", ret_type: "decimal" }] },
    {
      recordset: [
        { specific_name: "order_total", parameter_name: "customer", data_type: "int", parameter_mode: "IN", ordinal_position: 1 },
        { specific_name: "order_total", parameter_name: "total", data_type: "decimal", parameter_mode: "OUT", ordinal_position: 2 },
      ],
    },
    { recordset: undefined, rowsAffected: [2, 3] },
    { rowsAffected: [1] },
  ];
  const pool = {
    request: () => {
      const request = {
        inputs: [] as Array<[string, unknown]>,
        arrayRowMode: false,
        input(name: string, value: unknown) {
          this.inputs.push([name, value]);
          return this;
        },
        async query(sql: string) {
          requests.push({ inputs: this.inputs, sql });
          const response = responses.shift();
          assert.ok(response, "unexpected SQL query");
          return response;
        },
      };
      return request;
    },
  } as unknown as ConnectionPool;

  assert.deepEqual(await listSchemaNames(pool), ["app"]);
  assert.deepEqual(await listIndexesViaPool(pool, "app", "orders"), [
    { name: "pk_orders", unique: true, primary: true, columns: ["id"] },
    { name: "idx_orders_customer", unique: false, primary: false, columns: ["created_at", "customer_id"] },
  ]);
  assert.equal(
    await getDefinitionViaPool(pool, "view", "app", "orders"),
    "CREATE VIEW [app].[orders] AS SELECT 1",
  );
  assert.deepEqual(await introspectSchemas(pool, ["app"]), [[
    0,
    "app",
    [
      {
        schema: "app",
        name: "orders",
        kind: "table",
        columns: [
          { name: "id", dataType: "int", nullable: false, isPrimaryKey: true, ordinalPosition: 1 },
          {
            name: "customer_id",
            dataType: "int",
            nullable: true,
            isPrimaryKey: false,
            ordinalPosition: 2,
            defaultValue: "0",
            foreignKeyTo: { schema: "app", table: "customers", column: "id" },
          },
        ],
        constraints: [
          { name: "pk", kind: "primary", columns: ["id"] },
          {
            name: "fk_customer_id",
            kind: "foreign",
            columns: ["customer_id"],
            references: { schema: "app", table: "customers", column: "id" },
          },
        ],
      },
      { schema: "app", name: "order_view", kind: "view", columns: [], constraints: [] },
    ],
  ]]);
  assert.deepEqual(await listFunctionsPerSchema(pool, "app"), [{
    schema: "app",
    name: "order_total",
    overloads: [{
      parameters: [
        { name: "customer", dataType: "int", mode: "in", ordinalPosition: 0 },
        { name: "total", dataType: "decimal", mode: "out", ordinalPosition: 1 },
      ],
      returnType: "decimal",
    }],
  }]);
  const nonRowResult = await runQueryViaPool(pool, "UPDATE orders SET state = 'done'", 5);
  assert.deepEqual({ ...nonRowResult, elapsedMs: 0 }, {
    columns: [],
    rows: [],
    rowsAffected: 5,
    rowsMoreAvailable: false,
    elapsedMs: 0,
  });
  assert.ok(nonRowResult.elapsedMs >= 0);
  const rowsAffectedResult = await updateRowViaPool(pool, {
    schema: "app",
    table: "orders",
    set: { state: "done" },
    where: { id: 7 },
  });
  assert.equal(rowsAffectedResult, 1);
  assert.deepEqual(requests.at(-1), {
    inputs: [["s0", "done"], ["w0", 7]],
    sql: "UPDATE [app].[orders] SET [state] = @s0 WHERE [id] = @w0",
  });
});

if (MSSQL_CONN) {
  test("introspect real + runQuery SELECT 1", async () => {
    const a = new MssqlAdapter(cfg(MSSQL_CONN), MSSQL_PASSWORD);
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
  test("introspect real: SKIPPED (set MSSQL_TEST_CONNECTION_STRING para rodar)", { skip: true }, () => {
    assert.ok(true);
  });
}
