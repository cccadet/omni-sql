import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldPacket, Pool, PoolConnection, QueryOptions } from "mysql2/promise";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import { cancelQueryViaPool, prepareMysqlQuery, runQueryViaPool } from "./introspection.ts";
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
