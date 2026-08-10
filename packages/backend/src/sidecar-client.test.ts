import { test } from "node:test";
import assert from "node:assert/strict";

process.env.OMNI_SQL_AUTH_TOKEN = "sidecar-test-token";
const { resolveCteRelations } = await import("./sidecar-client.ts");

test("sidecar-client: sql sem WITH nem tenta chamar o sidecar", async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("não deveria ser chamado");
  }) as typeof fetch;
  try {
    const relations = await resolveCteRelations("select * from users");
    assert.deepEqual(relations, []);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sidecar-client: mapeia resposta do sidecar para Relation[]", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(input), "http://127.0.0.1:41921/scope/resolve");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sidecar-test-token");
    assert.equal(JSON.parse(String(init?.body)).sql, "with b1 as (select 1 as x) select from b1");
    return new Response(
      JSON.stringify({ ctes: [{ name: "b1", columns: ["x"] }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const relations = await resolveCteRelations("with b1 as (select 1 as x) select from b1");
    assert.equal(relations.length, 1);
    assert.equal(relations[0]?.name, "b1");
    assert.equal(relations[0]?.kind, "view");
    assert.deepEqual(
      relations[0]?.columns.map((c) => c.name),
      ["x"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sidecar-client: falha do sidecar (rede/timeout/JSON inválido) retorna lista vazia, nunca lança", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("sidecar indisponível");
  }) as typeof fetch;
  try {
    const relations = await resolveCteRelations("with b1 as (select 1 as x) select from b1");
    assert.deepEqual(relations, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sidecar-client: resposta HTTP não-2xx retorna lista vazia", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;
  try {
    const relations = await resolveCteRelations("with b1 as (select 1 as x) select from b1");
    assert.deepEqual(relations, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sidecar-client: JSON estruturalmente inválido retorna lista vazia", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ ctes: [{ name: "b1", columns: [1] }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
  try {
    assert.deepEqual(await resolveCteRelations("with b1 as (select 1 as x) select from b1"), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sidecar-client: cursor resolve somente CTEs do statement atual", async () => {
  const sql = "with old_cte as (select 1 as old_col) select from old_cte; with current_cte as (select 1 as current_col) select from current_cte";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const statement = JSON.parse(String(init?.body)).sql;
    assert.equal(statement.includes("old_cte"), false);
    assert.equal(statement.includes("current_cte"), true);
    return new Response(
      JSON.stringify({ ctes: [{ name: "current_cte", columns: ["current_col"] }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const relations = await resolveCteRelations(sql, sql.length);
    assert.deepEqual(relations.map((relation) => relation.name), ["current_cte"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
