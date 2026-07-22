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
