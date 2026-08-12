import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldPacket, Pool, PoolConnection, QueryOptions } from "mysql2/promise";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import {
  cancelQueryViaPool,
  getDefinitionViaPool,
  introspectSchemas,
  listFunctionsPerSchema,
  listIndexesViaPool,
  listSchemaNames,
  prepareMysqlQuery,
  runQueryViaPool,
  updateRowViaPool,
} from "./introspection.ts";
import { MysqlAdapter } from "./index.ts";

// Sem docker/MySQL local: smoke só valida construção + recusa de dial.
// Em CI/uso local, setar `MYSQL_TEST_CONNECTION_STRING` para acionar testes reais.

const MYSQL_CONN = process.env.MYSQL_TEST_CONNECTION_STRING;

const cfg = (endpoint = MYSQL_CONN ?? "127.0.0.1:1/dummy"): ConnectionConfig => ({
  id: "mysql-test",
  label: "MySQL test",
  dialect: "mysql",
  endpoint,
  user: "nobody",
});

test("MysqlAdapter: constrói sem disparar conexão", () => {
  const a = new MysqlAdapter(cfg());
  assert.equal(a.id, "mysql-test");
  assert.equal(a.dialect, "mysql");
  assert.equal(a.dialectDescriptor().dialect, "mysql");
  assert.ok(a.dialectDescriptor().keywords.has("STRAIGHT_JOIN"));
  assert.deepEqual(a.listSchemas(), []);
  assert.deepEqual(a.listTables("app"), []);
});

test("MysqlAdapter: factory via construtor produz instância Adapter", () => {
  const a = new MysqlAdapter(cfg());
  assert.equal(a.dialect, "mysql");
});

test("MysqlAdapter: dialecto mariadb usa descritor mariadb", () => {
  const a = new MysqlAdapter({ ...cfg(), dialect: "mariadb" });
  assert.equal(a.dialect, "mariadb");
  assert.equal(a.dialectDescriptor().dialect, "mariadb");
});

test("test() retorna ok:false quando não consegue conectar", async () => {
  const a = new MysqlAdapter(cfg("127.0.0.1:1/dummy"));
  const t = await a.test();
  assert.equal(t.ok, false);
  assert.ok(t.message);
  await a.close();
});

test("prepareMysqlQuery aplica LIMIT parametrizado somente a leitura segura", () => {
  assert.deepEqual(prepareMysqlQuery("SELECT id FROM users ORDER BY id;", 100), {
    sql: "SELECT id FROM users ORDER BY id LIMIT ?;",
    values: [101],
    serverSideLimitApplied: true,
  });
  assert.deepEqual(prepareMysqlQuery("WITH recent AS (SELECT id FROM users) SELECT id FROM recent ORDER BY id", 2), {
    sql: "WITH recent AS (SELECT id FROM users) SELECT id FROM recent ORDER BY id LIMIT ?",
    values: [3],
    serverSideLimitApplied: true,
  });

  for (const sql of [
    "UPDATE users SET name = 'x'",
    "WITH changed AS (SELECT 1) UPDATE users SET name = 'x'",
    "SELECT id FROM users LIMIT 10",
    "SELECT id FROM users FOR UPDATE",
  ]) {
    assert.deepEqual(prepareMysqlQuery(sql, 100), { sql, serverSideLimitApplied: false });
  }
});

test("runQuery aplica cap server-side com bind e calcula rowsMoreAvailable", async () => {
  let executedOptions: QueryOptions | undefined;
  const fields = [{ name: "v", type: 3 }] as FieldPacket[];
  const queryConnection = {
    query: async (options: QueryOptions): Promise<[unknown, FieldPacket[]]> => {
      executedOptions = options;
      return [Array.from({ length: 4 }, (_, i) => [i]), fields];
    },
    release: () => undefined,
  } as unknown as PoolConnection;
  const pool = {
    getConnection: async (): Promise<PoolConnection> => queryConnection,
  } as unknown as Pool;

  const result = await runQueryViaPool(pool, "SELECT v FROM values_table ORDER BY v", 3);

  assert.deepEqual(executedOptions, {
    sql: "SELECT v FROM values_table ORDER BY v LIMIT ?",
    values: [4],
    rowsAsArray: true,
  });
  assert.deepEqual(result.rows, [[0], [1], [2]]);
  assert.equal(result.rowsMoreAvailable, true);
});

test("runQuery mantém conexão ativa e cancelQuery usa outra conexão", async () => {
  let releaseQuery!: () => void;
  const queryFinished = new Promise<void>((resolve) => {
    releaseQuery = resolve;
  });
  let queryStarted!: () => void;
  const queryStartedPromise = new Promise<void>((resolve) => {
    queryStarted = resolve;
  });
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  let releasedQuery = false;
  let releasedKiller = false;
  const fields = [{ name: "v", type: 3 }] as FieldPacket[];
  const queryConnection = {
    threadId: 42,
    query: async (_options: QueryOptions): Promise<[unknown, FieldPacket[]]> => {
      queryStarted();
      await queryFinished;
      return [[[1], [2]], fields];
    },
    release: () => {
      releasedQuery = true;
    },
  } as unknown as PoolConnection;
  const killerConnection = {
    query: async (sql: string, values?: unknown[]): Promise<void> => {
      calls.push({ sql, values });
    },
    release: () => {
      releasedKiller = true;
    },
  } as unknown as PoolConnection;
  const connections: PoolConnection[] = [queryConnection, killerConnection];
  const pool = {
    getConnection: async (): Promise<PoolConnection> => connections.shift()!,
  } as unknown as Pool;
  const token = Symbol();
  let active: { token: symbol; threadId: number } | null = null;

  const resultPromise = runQueryViaPool(pool, "SELECT v", 1, (connection) => {
    active = { token, threadId: connection.threadId };
    return () => {
      active = null;
    };
  });
  await queryStartedPromise;
  assert.equal(releasedQuery, false);

  assert.equal(await cancelQueryViaPool(pool, 42, () => active?.token === token), true);
  assert.deepEqual(calls, [{ sql: "KILL QUERY ?", values: [42] }]);
  assert.equal(releasedKiller, true);

  releaseQuery();
  const result = await resultPromise;
  assert.deepEqual(result.rows, [[1]]);
  assert.equal(result.rowsMoreAvailable, true);
  assert.equal(releasedQuery, true);
  assert.equal(active, null);
});

test("cancelQuery ignora token obsoleto antes de KILL QUERY", async () => {
  let releaseKiller!: () => void;
  const killerReady = new Promise<void>((resolve) => {
    releaseKiller = resolve;
  });
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  let releasedKiller = false;
  const killerConnection = {
    query: async (sql: string, values?: unknown[]): Promise<void> => {
      calls.push({ sql, values });
    },
    release: () => {
      releasedKiller = true;
    },
  } as unknown as PoolConnection;
  const pool = {
    getConnection: async (): Promise<PoolConnection> => {
      await killerReady;
      return killerConnection;
    },
  } as unknown as Pool;
  const token = Symbol();
  let currentToken: symbol | null = token;

  const cancellation = cancelQueryViaPool(pool, 42, () => currentToken === token);
  currentToken = Symbol();
  releaseKiller();

  assert.equal(await cancellation, false);
  assert.deepEqual(calls, []);
  assert.equal(releasedKiller, true);
});

test("MySQL metadata helpers preserve filtered relations, routine parameters, definitions, indexes, and bound updates", async () => {
  const calls: Array<{ sql: string; values: readonly unknown[] | undefined }> = [];
  const responses: unknown[] = [
    [{ schema_name: "app" }],
    [
      { index_name: "PRIMARY", non_unique: 0, column_name: "id", seq_in_index: 1 },
      { index_name: "idx_customer", non_unique: 1, column_name: "customer_id", seq_in_index: 2 },
      { index_name: "idx_customer", non_unique: 1, column_name: "created_at", seq_in_index: 1 },
    ],
    [{ "Create View": "CREATE VIEW `app`.`orders` AS SELECT 1" }],
    [
      { table_schema: "app", table_name: "orders", table_type: "BASE TABLE" },
      { table_schema: "ignored", table_name: "audit", table_type: "BASE TABLE" },
    ],
    [
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
    [{ schema: "app", name: "order_total", ret_type: "decimal" }],
    [
      { specific_name: "order_total", parameter_name: "customer", data_type: "int", parameter_mode: "IN", ordinal_position: 1 },
      { specific_name: "order_total", parameter_name: "total", data_type: "decimal", parameter_mode: "OUT", ordinal_position: 2 },
    ],
    { affectedRows: 1 },
  ];
  const query = async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    const rows = responses.shift();
    assert.ok(rows, "unexpected SQL query");
    return [rows, []] as never;
  };
  const pool = { query } as unknown as Pool;
  const connection = pool as unknown as PoolConnection;

  assert.deepEqual(await listSchemaNames(connection), ["app"]);
  assert.deepEqual(await listIndexesViaPool(pool, "app", "orders"), [
    { name: "PRIMARY", unique: true, primary: true, columns: ["id"] },
    { name: "idx_customer", unique: false, primary: false, columns: ["created_at", "customer_id"] },
  ]);
  assert.equal(await getDefinitionViaPool(pool, "view", "app", "orders"), "CREATE VIEW `app`.`orders` AS SELECT 1");
  const schemas = await introspectSchemas(connection, ["app"]);
  assert.deepEqual(schemas[0]?.[2]?.[0], {
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
  });
  assert.deepEqual(await listFunctionsPerSchema(connection, "app"), [{
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
  assert.equal(await updateRowViaPool(pool, {
    schema: "app",
    table: "orders",
    set: { state: "done" },
    where: { id: 7 },
  }), 1);
  assert.deepEqual(calls.at(-1), {
    sql: "UPDATE `app`.`orders` SET `state` = ? WHERE `id` = ?",
    values: ["done", 7],
  });
});

if (MYSQL_CONN) {
  test("introspect real + runQuery SELECT 1", async () => {
    const a = new MysqlAdapter(cfg(MYSQL_CONN));
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
  test("introspect real: SKIPPED (set MYSQL_TEST_CONNECTION_STRING para rodar)", { skip: true }, () => {
    assert.ok(true);
  });
}
