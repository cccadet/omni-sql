import { test } from "node:test";
import assert from "node:assert/strict";
import { OracleAdapter } from "./index.ts";
import {
  getDefinitionViaConnection,
  introspectSchemas,
  listFunctionsPerSchema,
  listIndexesViaConnection,
  listSchemaNames,
  prepareOracleQuery,
  runQueryViaConnection,
  updateRowViaConnection,
} from "./introspection.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import type { Connection, Pool } from "oracledb";

// Sem instância Oracle local: smoke só valida construção + recusa de dial.
// Em CI/uso local, setar `ORACLE_TEST_CONNECTION_STRING` (+ `ORACLE_TEST_USER`
// / `ORACLE_TEST_PASSWORD`) para acionar testes reais.

const ORACLE_CONN = process.env.ORACLE_TEST_CONNECTION_STRING;
const ORACLE_USER = process.env.ORACLE_TEST_USER ?? "nobody";
const ORACLE_PASSWORD = process.env.ORACLE_TEST_PASSWORD;

const cfg = (endpoint = ORACLE_CONN ?? "127.0.0.1:1/dummy"): ConnectionConfig => ({
  id: "oracle-test",
  label: "Oracle test",
  dialect: "oracle",
  endpoint,
  user: ORACLE_USER,
});

test("OracleAdapter: constrói sem disparar conexão", () => {
  const a = new OracleAdapter(cfg());
  assert.equal(a.id, "oracle-test");
  assert.equal(a.dialect, "oracle");
  assert.equal(a.dialectDescriptor().dialect, "oracle");
  assert.deepEqual(a.listSchemas(), []);
  assert.deepEqual(a.listTables("BIDW"), []);
});

test("OracleAdapter: factory via construtor produz instância Adapter", () => {
  const a = new OracleAdapter(cfg());
  assert.equal(a.dialect, "oracle");
});

test("introspectSchemas ignora FK incompleta e preserva FK válida", async () => {
  const conn = {
    execute: async (sql: string) => {
      if (sql.includes("FROM all_tables")) {
        return { rows: [{ table_schema: "APP", table_name: "CHILD", table_type: "TABLE" }] };
      }
      if (sql.includes("FROM all_tab_columns")) {
        return {
          rows: [
            { table_schema: "APP", table_name: "CHILD", column_name: "BROKEN_ID", data_type: "NUMBER", is_nullable: "Y", column_default: null, ordinal_position: 1 },
            { table_schema: "APP", table_name: "CHILD", column_name: "PARENT_ID", data_type: "NUMBER", is_nullable: "N", column_default: null, ordinal_position: 2 },
          ],
        };
      }
      return {
        rows: [
          { owner: "APP", table_name: "CHILD", constraint_name: "FK_BROKEN", constraint_type: "R", column_name: "BROKEN_ID", r_owner: null, r_table_name: null, r_column_name: null },
          { owner: "APP", table_name: "CHILD", constraint_name: "FK_PARENT", constraint_type: "R", column_name: "PARENT_ID", r_owner: "APP", r_table_name: "PARENT", r_column_name: "ID" },
        ],
      };
    },
  } as unknown as Connection;

  const result = await introspectSchemas(conn);
  const relation = result[0]![2][0]!;
  assert.equal(relation.name, "CHILD");
  assert.deepEqual(relation.columns.map((c) => c.name), ["BROKEN_ID", "PARENT_ID"]);
  assert.equal(relation.columns[0]!.foreignKeyTo, undefined);
  assert.deepEqual(relation.columns[1]!.foreignKeyTo, { schema: "APP", table: "PARENT", column: "ID" });
  assert.deepEqual(relation.constraints.map((c) => c.name), ["FK_PARENT"]);
});

test("introspectSchemas preserva casing exato do catálogo Oracle", async () => {
  const conn = {
    execute: async (sql: string) => {
      if (sql.includes("FROM all_tables")) {
        return {
          rows: [
            { table_schema: "APP", table_name: "USERS", table_type: "TABLE" },
            { table_schema: "APP", table_name: "quoted_users", table_type: "TABLE" },
            { table_schema: "APP", table_name: "MixedCaseUsers", table_type: "TABLE" },
          ],
        };
      }
      if (sql.includes("FROM all_tab_columns")) {
        return {
          rows: [
            { table_schema: "APP", table_name: "USERS", column_name: "ID", data_type: "NUMBER", is_nullable: "N", column_default: null, ordinal_position: 1 },
            { table_schema: "APP", table_name: "quoted_users", column_name: "id", data_type: "NUMBER", is_nullable: "N", column_default: null, ordinal_position: 1 },
            { table_schema: "APP", table_name: "MixedCaseUsers", column_name: "MixedId", data_type: "NUMBER", is_nullable: "N", column_default: null, ordinal_position: 1 },
          ],
        };
      }
      return {
        rows: [
          { owner: "APP", table_name: "USERS", constraint_name: "PK_USERS", constraint_type: "P", column_name: "ID", r_owner: null, r_table_name: null, r_column_name: null },
          { owner: "APP", table_name: "quoted_users", constraint_name: "pk_quoted_users", constraint_type: "P", column_name: "id", r_owner: null, r_table_name: null, r_column_name: null },
          { owner: "APP", table_name: "quoted_users", constraint_name: "fk_quoted_users", constraint_type: "R", column_name: "id", r_owner: "APP", r_table_name: "USERS", r_column_name: "ID" },
          { owner: "APP", table_name: "MixedCaseUsers", constraint_name: "MixedPk", constraint_type: "P", column_name: "MixedId", r_owner: null, r_table_name: null, r_column_name: null },
        ],
      };
    },
  } as unknown as Connection;

  const result = await introspectSchemas(conn);
  const relations = result[0]![2];
  assert.deepEqual(relations.map((r) => r.name), ["USERS", "quoted_users", "MixedCaseUsers"]);

  const users = relations[0]!;
  assert.deepEqual(users.columns.map((c) => c.name), ["ID"]);
  assert.deepEqual(users.constraints, [{ name: "PK_USERS", kind: "primary", columns: ["ID"] }]);

  const quotedUsers = relations[1]!;
  assert.deepEqual(quotedUsers.columns.map((c) => c.name), ["id"]);
  assert.deepEqual(quotedUsers.columns[0]!.foreignKeyTo, { schema: "APP", table: "USERS", column: "ID" });
  assert.deepEqual(quotedUsers.constraints, [
    { name: "pk_quoted_users", kind: "primary", columns: ["id"] },
    {
      name: "fk_quoted_users",
      kind: "foreign",
      columns: ["id"],
      references: { schema: "APP", table: "USERS", column: "ID" },
    },
  ]);

  const mixedCaseUsers = relations[2]!;
  assert.deepEqual(mixedCaseUsers.columns.map((c) => c.name), ["MixedId"]);
  assert.deepEqual(mixedCaseUsers.constraints, [{ name: "MixedPk", kind: "primary", columns: ["MixedId"] }]);
});

test("runQuery aplica cap Oracle server-side com bind e mantém cap client-side", async () => {
  let executedSql = "";
  let executedBinds: unknown;
  const getRowsCalls: number[] = [];
  const conn = {
    execute: async (sql: string, binds: unknown) => {
      executedSql = sql;
      executedBinds = binds;
      return {
        metaData: [{ name: "V", dbTypeName: "NUMBER" }],
        resultSet: {
          getRows: async (count: number) => {
            getRowsCalls.push(count);
            return Array.from({ length: 101 }, (_, i) => [i]);
          },
          close: async () => undefined,
        },
      };
    },
  } as unknown as Connection;

  const result = await runQueryViaConnection(conn, "SELECT ';' AS v FROM DUAL ORDER BY v;", 100);

  assert.match(executedSql, /^SELECT \* FROM \(\nSELECT ';' AS v FROM DUAL ORDER BY v\n\)\nWHERE ROWNUM <= :omni_sql_limit$/);
  assert.deepEqual(executedBinds, { omni_sql_limit: 101 });
  assert.deepEqual(getRowsCalls, [101]);
  assert.equal(result.rows.length, 100);
  assert.equal(result.rows[99]?.[0], 99);
  assert.equal(result.rowsMoreAvailable, true);
});

test("prepareOracleQuery não envolve DML, CTE mutante ou SELECT FOR UPDATE", () => {
  const statements = [
    "UPDATE users SET name = 'x'",
    "WITH changed AS (SELECT 1 FROM DUAL) UPDATE users SET name = 'x'",
    "SELECT id FROM users FOR UPDATE",
  ];
  for (const sql of statements) {
    assert.deepEqual(prepareOracleQuery(sql, 100), {
      sql,
      binds: {},
      serverSideLimitApplied: false,
    });
  }
});

test("runQuery mantém execução direta e commit para instrução sem result set", async () => {
  let executedSql = "";
  let executedBinds: unknown;
  let commitCalls = 0;
  const conn = {
    execute: async (sql: string, binds: unknown) => {
      executedSql = sql;
      executedBinds = binds;
      return { rowsAffected: 3 };
    },
    commit: async () => { commitCalls += 1; },
  } as unknown as Connection;

  const result = await runQueryViaConnection(conn, "UPDATE users SET name = 'x';", 100);

  assert.equal(executedSql, "UPDATE users SET name = 'x';");
  assert.deepEqual(executedBinds, []);
  assert.equal(commitCalls, 1);
  assert.deepEqual(result.rows, []);
  assert.equal(result.rowsAffected, 3);
  assert.equal(result.rowsMoreAvailable, false);
});

test("test() retorna ok:false quando não consegue conectar", async () => {
  const a = new OracleAdapter(cfg("127.0.0.1:1/dummy"), "nobody");
  const t = await a.test();
  assert.equal(t.ok, false);
  assert.ok(t.message);
  await a.close();
});

test("cancelRunning interrompe execute Oracle em andamento", async () => {
  let executeStarted!: () => void;
  let rejectExecute!: (error: Error) => void;
  let breakCalls = 0;
  let closeCalls = 0;
  const conn = {
    execute: async () => {
      executeStarted();
      await new Promise<never>((_resolve, reject) => { rejectExecute = reject; });
    },
    break: async () => {
      breakCalls += 1;
      rejectExecute(new Error("query cancelled"));
    },
    rollback: async () => undefined,
    close: async () => { closeCalls += 1; },
  } as unknown as Connection;
  const pool = {
    getConnection: async () => conn,
    close: async () => undefined,
  } as unknown as Pool;
  const a = new OracleAdapter(cfg());
  (a as unknown as { poolPromise: Promise<Pool> | null }).poolPromise = Promise.resolve(pool);

  const run = a.runQuery("SELECT 1", 10);
  await new Promise<void>((resolve) => { executeStarted = resolve; });
  await a.cancelRunning();
  await assert.rejects(run, /query cancelled/);
  await a.cancelRunning();

  assert.equal(breakCalls, 1);
  assert.equal(closeCalls, 1);
});

test("cancelRunning ignora falha de break e deixa runQuery limpar conexão", async () => {
  let executeStarted!: () => void;
  let rejectExecute!: (error: Error) => void;
  let closeCalls = 0;
  const conn = {
    execute: async () => {
      executeStarted();
      await new Promise<never>((_resolve, reject) => { rejectExecute = reject; });
    },
    break: async () => {
      throw new Error("break unavailable");
    },
    rollback: async () => undefined,
    close: async () => { closeCalls += 1; },
  } as unknown as Connection;
  const pool = {
    getConnection: async () => conn,
    close: async () => undefined,
  } as unknown as Pool;
  const a = new OracleAdapter(cfg());
  (a as unknown as { poolPromise: Promise<Pool> | null }).poolPromise = Promise.resolve(pool);

  const run = a.runQuery("SELECT 1", 10);
  await new Promise<void>((resolve) => { executeStarted = resolve; });
  await a.cancelRunning();
  rejectExecute(new Error("query stopped"));

  await assert.rejects(run, /query stopped/);
  assert.equal(closeCalls, 1);
});

test("Oracle metadata helpers preserve routine overloads, definitions, index order, and bound updates", async () => {
  const calls: Array<{ sql: string; binds: unknown }> = [];
  const responses = [
    { rows: [{ schema_name: "APP" }] },
    {
      rows: [
        { index_name: "PK_ORDERS", uniqueness: "UNIQUE", column_name: "ID", ordinal: 1 },
        { index_name: "IDX_CUSTOMER", uniqueness: "NONUNIQUE", column_name: "CUSTOMER_ID", ordinal: 2 },
        { index_name: "IDX_CUSTOMER", uniqueness: "NONUNIQUE", column_name: "CREATED_AT", ordinal: 1 },
      ],
    },
    { rows: [{ index_name: "PK_ORDERS" }] },
    { rows: [{ text: "SELECT * FROM ORDERS" }] },
    { rows: [{ text: "CREATE FUNCTION ORDER_TOTAL " }, { text: "RETURN NUMBER" }] },
    {
      rows: [
        { schema: "APP", name: "ORDER_TOTAL", overload: null, argument_name: null, data_type: "NUMBER", in_out: "OUT", position: 0 },
        { schema: "APP", name: "ORDER_TOTAL", overload: null, argument_name: "CUSTOMER_ID", data_type: "NUMBER", in_out: "IN", position: 1 },
        { schema: "APP", name: "ORDER_TOTAL", overload: 1, argument_name: null, data_type: "NUMBER", in_out: "OUT", position: 0 },
        { schema: "APP", name: "ORDER_TOTAL", overload: 1, argument_name: "TOTAL", data_type: "NUMBER", in_out: "IN/OUT", position: 1 },
      ],
    },
    { rowsAffected: 1 },
  ];
  const conn = {
    async execute(sql: string, binds: unknown) {
      calls.push({ sql, binds });
      const response = responses.shift();
      assert.ok(response, "unexpected SQL query");
      return response;
    },
    async commit() {},
  } as unknown as Connection;

  assert.deepEqual(await listSchemaNames(conn), ["APP"]);
  assert.deepEqual(await listIndexesViaConnection(conn, "app", "orders"), [
    { name: "PK_ORDERS", unique: true, primary: true, columns: ["ID"] },
    { name: "IDX_CUSTOMER", unique: false, primary: false, columns: ["CREATED_AT", "CUSTOMER_ID"] },
  ]);
  assert.equal(
    await getDefinitionViaConnection(conn, "view", "app", "orders"),
    "CREATE OR REPLACE VIEW \"app\".\"orders\" AS\nSELECT * FROM ORDERS",
  );
  assert.equal(await getDefinitionViaConnection(conn, "function", "app", "order_total"), "CREATE FUNCTION ORDER_TOTAL RETURN NUMBER");
  assert.deepEqual(await listFunctionsPerSchema(conn, "APP"), [{
    schema: "APP",
    name: "ORDER_TOTAL",
    overloads: [
      {
        parameters: [{ name: "CUSTOMER_ID", dataType: "NUMBER", mode: "in", ordinalPosition: 0 }],
        returnType: "NUMBER",
      },
      {
        parameters: [{ name: "TOTAL", dataType: "NUMBER", mode: "inout", ordinalPosition: 0 }],
        returnType: "NUMBER",
      },
    ],
  }]);
  assert.equal(await updateRowViaConnection(conn, {
    schema: "APP",
    table: "ORDERS",
    set: { STATE: "done" },
    where: { ID: 7 },
  }), 1);
  assert.deepEqual(calls.at(-1), {
    sql: "UPDATE \"APP\".\"ORDERS\" SET \"STATE\" = :s0 WHERE \"ID\" = :w0",
    binds: { s0: "done", w0: 7 },
  });
});

test("cancelRunning não limpa query nova quando conexão é reutilizada", async () => {
  let executeStartedA!: () => void;
  let executeStartedB!: () => void;
  let rejectExecuteA!: (error: Error) => void;
  let rejectExecuteB!: (error: Error) => void;
  let releaseBreakA!: () => void;
  let breakCalls = 0;
  let closeCalls = 0;
  const conn = {
    execute: async () => {
      if (!rejectExecuteA) {
        executeStartedA();
        await new Promise<never>((_resolve, reject) => { rejectExecuteA = reject; });
        return undefined;
      }
      executeStartedB();
      await new Promise<never>((_resolve, reject) => { rejectExecuteB = reject; });
    },
    break: async () => {
      breakCalls += 1;
      if (breakCalls === 1) {
        await new Promise<void>((resolve) => { releaseBreakA = resolve; });
        return;
      }
      rejectExecuteB(new Error("query B cancelled"));
    },
    rollback: async () => undefined,
    close: async () => { closeCalls += 1; },
  } as unknown as Connection;
  const pool = {
    getConnection: async () => conn,
    close: async () => undefined,
  } as unknown as Pool;
  const a = new OracleAdapter(cfg());
  (a as unknown as { poolPromise: Promise<Pool> | null }).poolPromise = Promise.resolve(pool);

  const runA = a.runQuery("SELECT 1", 10);
  await new Promise<void>((resolve) => { executeStartedA = resolve; });
  const cancelA = a.cancelRunning();

  rejectExecuteA(new Error("query A stopped"));
  await assert.rejects(runA, /query A stopped/);

  const runB = a.runQuery("SELECT 1", 10);
  await new Promise<void>((resolve) => { executeStartedB = resolve; });
  releaseBreakA();
  await cancelA;
  await a.cancelRunning();
  await assert.rejects(runB, /query B cancelled/);

  assert.equal(breakCalls, 2);
  assert.equal(closeCalls, 2);
});

if (ORACLE_CONN) {
  test("introspect real + runQuery SELECT 1 FROM DUAL", async () => {
    const a = new OracleAdapter(cfg(ORACLE_CONN), ORACLE_PASSWORD);
    try {
      await a.connect();
      const db = await a.introspect();
      assert.ok(db.schemas.length >= 1, "esperava ao menos 1 schema");

      const r = await a.runQuery("SELECT 1 AS v FROM DUAL", 100);
      assert.equal(r.columns.length, 1);
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0]?.[0], 1);
    } finally {
      await a.close();
    }
  });
} else {
  test("introspect real: SKIPPED (set ORACLE_TEST_CONNECTION_STRING para rodar)", { skip: true }, () => {
    assert.ok(true);
  });
}
