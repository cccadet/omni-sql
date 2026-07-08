import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresDescriptor } from "@omni-sql/dialect-descriptors";
import type { DialectDescriptor } from "@omni-sql/dialect-descriptors";
import { autocompleteTier1, type MetadataSource } from "./engine.ts";
import type { ScopeRef } from "./context.ts";
import type { FunctionDef, Relation } from "@omni-sql/ts-types";

const USERS: Relation = {
  schema: "public",
  name: "users",
  kind: "table",
  columns: [
    { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinalPosition: 0 },
    { name: "name", dataType: "text", nullable: false, isPrimaryKey: false, ordinalPosition: 1 },
    { name: "email", dataType: "text", nullable: true, isPrimaryKey: false, ordinalPosition: 2 },
  ],
  constraints: [],
};

const ORDERS: Relation = {
  schema: "public",
  name: "orders",
  kind: "table",
  columns: [
    { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinalPosition: 0 },
    { name: "user_id", dataType: "integer", nullable: false, isPrimaryKey: false, ordinalPosition: 1 },
    { name: "total", dataType: "numeric", nullable: false, isPrimaryKey: false, ordinalPosition: 2 },
  ],
  constraints: [],
};

const USERS_VIEW: Relation = {
  schema: "public",
  name: "active_users",
  kind: "view",
  columns: USERS.columns,
  constraints: [],
};

const COALESCE: FunctionDef = {
  schema: "pg_catalog",
  name: "COALESCE",
  overloads: [
    {
      parameters: [{ name: "v", dataType: "any", mode: "in", ordinalPosition: 0 }],
      returnType: "any",
    },
  ],
};

function metaOf(dialect: DialectDescriptor): MetadataSource {
  return {
    dialect,
    listRelations: () => [USERS, ORDERS, USERS_VIEW],
    listFunctions: () => [COALESCE],
    resolveRelation: (ref: ScopeRef) => {
      const all = [USERS, ORDERS, USERS_VIEW];
      return all.find((r) => r.name === ref.table && (ref.schema == null || r.schema === ref.schema)) ?? null;
    },
  };
}

test("caso 1: cursor após FROM → sugere tabelas/views", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT 1 FROM ";
  const out = autocompleteTier1(sql, sql.length, meta);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("users"));
  assert.ok(labels.includes("orders"));
  assert.ok(labels.includes("active_users"));
  assert.ok(out.every((s) => s.kind === "table" || s.kind === "view"));
});

test("caso 2: SELECT sem FROM → `*` + funções", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT ";
  const out = autocompleteTier1(sql, sql.length, meta);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("*"));
  assert.ok(labels.includes("COALESCE"));
});

test("caso 3: SELECT ... FROM users → colunas da tabela em escopo", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT  FROM users";
  const cursor = "SELECT ".length;
  const out = autocompleteTier1(sql, cursor, meta);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("id"));
  assert.ok(labels.includes("email"));
});

test("caso 4: alias `u.` → colunas do alias", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT u. FROM users u";
  const cursor = "SELECT u.".length;
  const out = autocompleteTier1(sql, cursor, meta);
  assert.ok(out.every((s) => s.kind === "column"));
  const labels = out.map((s) => s.label);
  assert.deepEqual([...labels].sort(), ["email", "id", "name"]);
});

test("caso 5: múltiplos JOINs com aliases → colunas de todas em escopo (WHERE)", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT u.id FROM users u JOIN orders o ON u.id = o.user_id WHERE ";
  const cursor = sql.length;
  const out = autocompleteTier1(sql, cursor, meta);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("id"));
  assert.ok(labels.includes("user_id"));
  assert.ok(labels.includes("total"));
});

test("caso 6: ORDER BY reusa colunas em escopo", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT u.id FROM users u ORDER BY ";
  const cursor = sql.length;
  const out = autocompleteTier1(sql, cursor, meta);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("id"));
  assert.ok(labels.includes("email"));
});

test.todo("caso 7: CTE WITH x AS (...) deve listar x no FROM");
test.todo("caso 8: subqueries correlacionadas herdam escopo externo");