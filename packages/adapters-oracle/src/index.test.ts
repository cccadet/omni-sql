import { test } from "node:test";
import assert from "node:assert/strict";
import { OracleAdapter } from "./index.ts";
import { introspectSchemas } from "./introspection.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import type { Connection } from "oracledb";

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

test("test() retorna ok:false quando não consegue conectar", async () => {
  const a = new OracleAdapter(cfg("127.0.0.1:1/dummy"), "nobody");
  const t = await a.test();
  assert.equal(t.ok, false);
  assert.ok(t.message);
  await a.close();
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
