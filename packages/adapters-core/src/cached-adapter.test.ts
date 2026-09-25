import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectionConfig, Relation } from "@omni-sql/ts-types";
import { CachedAdapter } from "./cached-adapter.ts";

class FakeAdapter extends CachedAdapter {
  readonly dialect = "postgres";
  relations: Relation[] = [];
  async connect() {}
  async close() {}
  async test() { return { ok: true, latencyMs: 0 }; }
  async listAvailableSchemas() { return ["public"]; }
  protected databaseName() { return "testdb"; }
  protected async introspectSchemas() { return [[null, "public", this.relations]] as const; }
  protected async listFunctionsForSchema() { return []; }
  async runQuery(): Promise<never> { throw new Error("unused"); }
  async explain(): Promise<never> { throw new Error("unused"); }
  async listIndexes(): Promise<never> { throw new Error("unused"); }
  async getDefinition(): Promise<never> { throw new Error("unused"); }
  async updateRow(): Promise<never> { throw new Error("unused"); }
  async insertRow(): Promise<never> { throw new Error("unused"); }
  dialectDescriptor(): never { throw new Error("unused"); }
}

test("introspection replaces cached metadata and lookups return current relations", async () => {
  const config = { id: "cache-test", label: "Test", dialect: "postgres", endpoint: "localhost", user: "test" } satisfies ConnectionConfig;
  const adapter = new FakeAdapter(config);
  const relation: Relation = {
    schema: "public", name: "items", kind: "table", constraints: [],
    columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinalPosition: 1 }],
  };
  assert.deepEqual(adapter.listTables("public"), []);
  assert.deepEqual(adapter.listColumns("public", "items"), []);

  adapter.relations = [relation];
  assert.deepEqual(await adapter.introspect(), { connectionId: "cache-test", name: "testdb", schemas: [{ database: "testdb", name: "public" }] });
  assert.deepEqual(adapter.listTables("public"), [relation]);
  assert.deepEqual(adapter.listColumns("public", "items"), relation.columns);
  assert.deepEqual(adapter.listFunctions("public"), []);

  adapter.relations = [];
  await adapter.introspect();
  assert.deepEqual(adapter.listTables("public"), []);
  assert.deepEqual(adapter.listColumns("public", "items"), []);
});
