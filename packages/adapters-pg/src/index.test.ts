import { test } from "node:test";
import assert from "node:assert/strict";
import pg, { type Pool, type PoolClient, type Query as PgQuery } from "pg";
import { PostgresAdapter } from "./index.ts";
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
