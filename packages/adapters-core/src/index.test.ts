import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import { InMemoryAdapter } from "./in-memory.ts";
import { bootstrapDefaultRegistry, resolveAdapter } from "./registry.ts";

const cfg = (id: string): ConnectionConfig => ({
  id,
  label: "test",
  dialect: "postgres",
  endpoint: "memory://local",
  user: "anon",
});

test("in-memory adapter returns SELECT 1 with one row", async () => {
  const adapter = new InMemoryAdapter(cfg("c1"));
  await adapter.connect();
  const r = await adapter.runQuery("SELECT 1", 100);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]?.[0], 1);
  await adapter.close();
});

test("in-memory adapter returns users * with 2 rows and 3 columns", async () => {
  const adapter = new InMemoryAdapter(cfg("c2"));
  await adapter.connect();
  const r = await adapter.runQuery("SELECT * FROM users", 100);
  assert.equal(r.rows.length, 2);
  assert.equal(r.columns.length, 3);
  assert.equal(r.columns[0]?.name, "id");
  await adapter.close();
});

test("registry falls back to InMemoryAdapter for unconfigured dialects", async () => {
  bootstrapDefaultRegistry();
  const adapter = resolveAdapter(cfg("c3"));
  assert.ok(adapter instanceof InMemoryAdapter);
  await adapter.connect();
  assert.equal(adapter.id, "c3");
});

test("introspect yields schema list", async () => {
  const adapter = new InMemoryAdapter(cfg("c4"));
  await adapter.connect();
  const db = await adapter.introspect();
  assert.ok(db.schemas.some((s) => s.name === "public"));
});