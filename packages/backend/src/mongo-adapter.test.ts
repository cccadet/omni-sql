import test from "node:test";
import assert from "node:assert/strict";
import { BSON, MongoClient } from "mongodb";
import { MongoAdapter, mongoResult, parseMongoQuery } from "./mongo-adapter.ts";
import { analyzeExecutionRisk } from "@omni-sql/autocomplete-engine";

test("MongoDB Extended JSON preserves BSON, bounds rows and rejects implicit writes", () => {
  const query = parseMongoQuery('{"collection":"items","operation":"find","filter":{"_id":{"$oid":"507f1f77bcf86cd799439011"}}}');
  assert.ok(query.filter._id instanceof BSON.ObjectId);
  for (const text of ['db.items.find({})', '{"collection":"items","operation":"command"}', '{"collection":"items","operation":"find","filter":[]}', '{"collection":"items","operation":"aggregate","pipeline":[{"$out":"stolen"}]}', '{"collection":"items","operation":"aggregate","pipeline":[{"$merge":"items"}]}', '{"collection":"items","operation":"updateOne"}']) {
    assert.throws(() => parseMongoQuery(text));
  }
  const result = mongoResult([{ _id: query.filter._id, value: BSON.Long.fromString("9223372036854775807") }, { other: true }], 1, 2);
  assert.deepEqual(result.rows, [[{ $oid: "507f1f77bcf86cd799439011" }, { $numberLong: "9223372036854775807" }]]);
  assert.equal(result.rowsMoreAvailable, true);
  assert.equal(analyzeExecutionRisk('{"collection":"items","operation":"deleteMany","filter":{}}', "mongodb").level, "critical");
  assert.equal(analyzeExecutionRisk('{"collection":"items","operation":"find","filter":{}}', "mongodb").level, "none");
});

test("MongoDB adapter bounds cursors, preserves document fields and sanitizes driver failures", async (t) => {
  const documents = [{ _id: new BSON.ObjectId(), name: "first" }, { other: true }];
  const limits: number[] = [];
  let closed = 0;
  let connected = 0;
  let failure: Error | undefined;
  let queryOptions: Record<string, unknown> = {};
  const cursor = () => ({
    limit(value: number) { limits.push(value); return this; },
    async close() { closed++; },
    async explain() { if (failure) throw failure; return { queryPlanner: { stage: "COLLSCAN" } }; },
    async *[Symbol.asyncIterator]() { if (failure) throw failure; yield* documents; },
  });
  const collection = {
    find(_filter: unknown, options: Record<string, unknown>) { queryOptions = options; return cursor(); },
    aggregate(pipeline: unknown[], options: Record<string, unknown>) {
      queryOptions = options;
      if (options.signal) assert.deepEqual(pipeline.at(-1), { $limit: 2 });
      return cursor();
    },
    async insertOne() { if (failure) throw failure; return { insertedId: documents[0]!._id }; },
    async updateOne() { return { matchedCount: 1, modifiedCount: 1 }; },
    async updateMany() { return { matchedCount: 2, modifiedCount: 2 }; },
    async deleteOne() { return { deletedCount: 1 }; },
    async deleteMany() { return { deletedCount: 2 }; },
    listIndexes() { return { async toArray() { return [{ name: "_id_", key: { _id: 1 } }, { name: "name", key: { name: 1 }, unique: true }]; } }; },
  };
  const db = {
    databaseName: "test",
    collection() { return collection; },
    async command() { if (failure) throw failure; return { ok: 1 }; },
    admin() { return { async listDatabases() { return { databases: [{ name: "test" }] }; } }; },
    listCollections() { return { async toArray() { return [{ name: "items", type: "collection" }, { name: "view", type: "view" }]; } }; },
  };
  t.mock.method(MongoClient.prototype, "db", () => db as unknown as ReturnType<MongoClient["db"]>);
  t.mock.method(MongoClient.prototype, "connect", async function (this: MongoClient) { connected++; return this; });
  t.mock.method(MongoClient.prototype, "close", async () => {});
  const config = { id: "mongo-unit", label: "Mongo", dialect: "mongodb" as const, endpoint: "mongodb://localhost/test", user: "" };
  const adapter = new MongoAdapter(config);
  const query = (operation: string, fields = {}) => JSON.stringify({ collection: "items", operation, ...fields });
  try {
    await adapter.connect(); await adapter.connect();
    assert.equal(connected, 1);
    assert.equal((await adapter.test()).ok, true);
    assert.deepEqual(await adapter.listAvailableSchemas(), ["test"]);
    const discovery = new MongoAdapter({ ...config, endpoint: "mongodb://localhost" });
    assert.deepEqual(await discovery.listAvailableSchemas(), ["test"]);
    await discovery.close();
    await adapter.introspect();
    assert.deepEqual(adapter.listTables("test").map(({ kind }) => kind), ["table", "view"]);
    assert.ok(adapter.listColumns("test", "items").some(({ name, isPrimaryKey }) => name === "_id" && isPrimaryKey));
    assert.deepEqual(adapter.listFunctions("test"), []);
    assert.equal(adapter.dialectDescriptor().dialect, "mongodb");
    const result = await adapter.runQuery(query("find", { projection: { name: 1 }, sort: { name: 1 } }), 1);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rowsMoreAvailable, true);
    assert.equal(limits.at(-1), 2);
    assert.equal(queryOptions.maxTimeMS, 60_000);
    assert.ok(queryOptions.signal instanceof AbortSignal);
    const heterogeneous = await adapter.runQuery(query("find"), 2);
    assert.equal(heterogeneous.rows[1]![0], null);
    assert.equal((await adapter.runQuery(query("aggregate", { pipeline: [{ $match: {} }] }), 1)).rows.length, 1);
    assert.equal((await adapter.runQuery(query("insertOne", { document: { name: "third" } }), 1)).rowsAffected, 1);
    for (const operation of ["updateOne", "updateMany"]) {
      assert.equal((await adapter.runQuery(query(operation, { update: { $set: { name: "updated" } } }), 1)).rowsAffected, operation === "updateOne" ? 1 : 2);
    }
    for (const operation of ["deleteOne", "deleteMany"]) {
      assert.equal((await adapter.runQuery(query(operation), 1)).rowsAffected, operation === "deleteOne" ? 1 : 2);
    }
    assert.equal((await adapter.explain(query("find"))).format, "json");
    assert.match((await adapter.explain(query("aggregate", { pipeline: [] }))).textual, /COLLSCAN/);
    await assert.rejects(adapter.explain(query("deleteMany")), /find or aggregate/);
    assert.deepEqual((await adapter.listIndexes("test", "items")).map(({ unique }) => unique), [true, true]);
    await assert.rejects(adapter.getDefinition(), /no SQL definition/);
    await assert.rejects(adapter.updateRow({} as never), /native MongoDB update/);
    await assert.rejects(adapter.insertRow({} as never), /native MongoDB insertOne/);
    for (const [code, expected] of [[18, /authentication/], [13, /permission/], [11000, /duplicate/], [50, /timed out/], [14, /type mismatch/]] as const) {
      failure = Object.assign(new Error("secret mongodb://user:password@host/test"), { code });
      await assert.rejects(adapter.runQuery(query("insertOne", { document: {} }), 1), expected);
    }
    failure = new Error("secret password");
    failure.name = "MongoServerSelectionError";
    await assert.rejects(adapter.test(), /server unavailable/);
    failure.name = "Error";
    await assert.rejects(adapter.runQuery(query("find"), 1), (error: Error) => !error.message.includes("secret") && error.message.includes("operation failed"));
    failure = undefined;
    await adapter.cancelRunning();
    assert.ok(closed >= 7);
    assert.throws(() => new MongoAdapter(config, "password"), /user is required/);
    assert.throws(() => new MongoAdapter({ ...config, endpoint: "mongodb://" }), /Invalid MongoDB URI/);
  } finally { await adapter.close(); }
});
