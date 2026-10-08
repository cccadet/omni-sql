import test from "node:test";
import assert from "node:assert/strict";
import { BSON, MongoClient } from "mongodb";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const dockerIntegration = process.env.OMNI_SQL_RUN_INTEGRATION === "1";
const endpoint = process.env.OMNI_SQL_TEST_MONGO_URI ?? (dockerIntegration ? "mongodb://127.0.0.1:27017/omni_test?authSource=admin" : undefined);
test("HTTP RPC MongoDB connection, metadata, BSON reads, writes and destructive confirmation", { skip: !endpoint }, async () => {
  const token = process.env.OMNI_SQL_AUTH_TOKEN = "mongo-integration-token";
  const tempDir = mkdtempSync(join(tmpdir(), "omni-mongo-integration-"));
  process.env.OMNI_SQL_METADATA_DB = join(tempDir, "metadata.db");
  process.env.OMNI_SQL_DEV_KEYRING_FILE = join(tempDir, "keyring.json");
  const { startServer } = await import("../src/index.ts");
  const { closeBackendResources } = await import("../src/handlers.ts");
  const adminUser = process.env.OMNI_SQL_TEST_MONGO_ADMIN_USER ?? (dockerIntegration ? "omni_root" : undefined);
  const adminPassword = process.env.OMNI_SQL_TEST_MONGO_ADMIN_PASSWORD ?? (dockerIntegration ? "omni_root" : undefined);
  const client = new MongoClient(endpoint!, adminUser ? { auth: { username: adminUser, password: adminPassword ?? "" } } : {});
  await client.connect();
  const db = client.db();
  await db.collection("items").deleteMany({});
  await db.collection("items").insertMany([{ name: "first", nested: { city: "SP" }, tags: ["a", "b"], id_guia: ["123", "456"] }, { name: "second", price: 10, id_guia: ["789"] }]);
  const user = "omni_mongo_test";
  const password = "p:'/?@";
  await client.db("admin").command({ dropUser: user }).catch(() => undefined);
  await client.db("admin").command({ createUser: user, pwd: password, roles: [{ role: "readWrite", db: db.databaseName }] });
  const authenticatedUri = new URL(endpoint!);
  authenticatedUri.searchParams.set("authSource", "admin");
  const authenticatedEndpoint = authenticatedUri.toString();
  const server = startServer(0);
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const port = address.port;
  async function rpc(method: string, params: unknown = {}) {
    return await (await fetch(`http://127.0.0.1:${port}/rpc`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json() as { result?: Record<string, unknown>; error?: { message: string } };
  }
  const connectionId = "mongo-integration";
  const config = { id: connectionId, label: "Mongo integration", dialect: "mongodb", endpoint: authenticatedEndpoint, user, schemas: [db.databaseName] };
  try {
    assert.equal((await rpc("connection.add", { config, password })).error, undefined);
    assert.equal((await rpc("connection.test", { config })).result?.ok, true);
    const credentials = await rpc("connection.mongoCredentials", { connectionId });
    assert.equal(credentials.result?.password, password);
    assert.equal((await rpc("connection.test", { config, password: "wrong-password" })).result?.ok, false);
    assert.equal((await rpc("metadata.introspect", { connectionId })).error, undefined);
    const metadata = await rpc("metadata.listRelations", { connectionId, includeColumns: true });
    assert.ok((metadata.result?.relations as { name: string }[]).some((relation) => relation.name === "items"));
    const query = (operation: string, rest = {}) => JSON.stringify({ database: db.databaseName, collection: "items", operation, ...rest });
    await db.collection("items").createIndex({ id_guia: 1 });
    for (const where of ["id_guia = '456'", "list_contains(id_guia, '456')"]) {
      const planned = await rpc("query.mongoSqlPlan", { connectionId, sql: `SELECT * FROM items WHERE ${where}` });
      assert.equal(planned.error, undefined);
      assert.ok(planned.result?.query);
      const found = await rpc("query.run", { connectionId, sql: planned.result.query, limit: 1 });
      assert.equal(found.error, undefined, found.error?.message);
      assert.equal((found.result?.rows as unknown[][]).length, 1);
      assert.ok(JSON.stringify(found.result?.rows).includes("first"));
      assert.equal(found.result?.rowsMoreAvailable, false);
      const explanation = await rpc("query.explain", { connectionId, sql: planned.result.query });
      assert.equal(explanation.error, undefined, explanation.error?.message);
      assert.ok(JSON.stringify(explanation.result).includes("IXSCAN"), "array filter must have an index scan in its explain plan");
    }
    assert.equal((await rpc("query.mongoSqlPlan", { connectionId, sql: "SELECT 1" })).result?.query, null);
    const result = await rpc("query.run", { connectionId, sql: query("find", { sort: { name: 1 } }), limit: 1 });
    assert.equal(result.error, undefined); assert.equal(result.result?.rowsMoreAvailable, true);
    const rows = result.result?.rows as unknown[][]; assert.equal(rows.length, 1);
    assert.ok(JSON.stringify(rows).includes("$oid")); assert.ok(JSON.stringify(rows).includes("SP"));
    assert.equal((await rpc("query.run", { connectionId, sql: query("insertOne", { document: { name: "third" } }) })).result?.rowsAffected, 1);
    assert.match((await rpc("query.run", { connectionId, sql: query("deleteMany", { filter: {} }) })).error!.message, /confirmation/);
    assert.equal(await db.collection("items").countDocuments(), 3);
    assert.equal((await rpc("query.run", { connectionId, sql: query("updateOne", { filter: { name: "third" }, update: { $set: { name: "updated" } } }), executionRiskAccepted: true })).result?.rowsAffected, 1);
    assert.equal((await rpc("query.run", { connectionId, sql: query("aggregate", { pipeline: [{ $match: { name: "updated" } }] }) })).error, undefined);
    assert.equal((await rpc("query.explain", { connectionId, sql: query("find", { filter: { name: "updated" } }) })).result?.format, "json");
    assert.equal((await rpc("query.run", { connectionId, sql: query("deleteOne", { filter: { name: "updated" } }), executionRiskAccepted: true })).result?.rowsAffected, 1);
    // Exercise the same conversion and execution RPCs used by /mongo.
    const conversionCollection = db.collection("conversion_cases");
    await conversionCollection.deleteMany({});
    await conversionCollection.insertMany([
      { category: "A", value: 10 }, { category: "A", value: 20 },
      { category: "B", value: null }, { category: "B" }, { category: "C", value: 5 },
    ]);
    async function convertAndRun(sql: string) {
      const before = await conversionCollection.countDocuments();
      const converted = await rpc("query.mongoConvert", { connectionId, sql });
      assert.equal(converted.error, undefined, converted.error?.message);
      assert.equal(await conversionCollection.countDocuments(), before, "conversion does not execute");
      const result = await rpc("query.run", { connectionId, sql: converted.result?.query, limit: 100 });
      assert.equal(result.error, undefined, result.error?.message);
      const columns = result.result?.columns as { name: string }[];
      return (result.result?.rows as unknown[][]).map((row) => BSON.EJSON.deserialize(
        Object.fromEntries(columns.map((column, i) => [column.name, row[i]])), { relaxed: true },
      ));
    }
    assert.deepEqual(await convertAndRun("SELECT category AS status, value FROM conversion_cases WHERE value >= 10 ORDER BY value DESC LIMIT 1"), [{ status: "A", value: 20 }]);
    assert.deepEqual(await convertAndRun("SELECT category, COUNT(*) AS total, COUNT(value) AS n, SUM(value) AS soma, AVG(value) AS media, MIN(value) AS minimo, MAX(value) AS maximo FROM conversion_cases GROUP BY category ORDER BY category"), [
      { category: "A", total: 2, n: 2, soma: 30, media: 15, minimo: 10, maximo: 20 },
      { category: "B", total: 2, n: 0, soma: null, media: null, minimo: null, maximo: null },
      { category: "C", total: 1, n: 1, soma: 5, media: 5, minimo: 5, maximo: 5 },
    ]);
    assert.deepEqual(await convertAndRun("SELECT category, COUNT(*) AS total FROM conversion_cases GROUP BY category HAVING COUNT(*) >= 2 ORDER BY total DESC, category LIMIT 1"), [{ category: "A", total: 2 }]);
    assert.deepEqual(await convertAndRun("SELECT COUNT(*) AS total, SUM(value) AS soma FROM conversion_cases WHERE value > 999"), [{ total: 0, soma: null }]);
    assert.deepEqual(await convertAndRun("SELECT category FROM conversion_cases WHERE value IS NULL ORDER BY category"), [{ category: "B" }, { category: "B" }]);
    assert.deepEqual(await convertAndRun("SELECT category FROM conversion_cases WHERE value <> 10 ORDER BY value"), [{ category: "C" }, { category: "A" }]);
    assert.deepEqual(await convertAndRun("SELECT * FROM conversion_cases WHERE value NOT IN (10, NULL)"), []);
    assert.deepEqual(await convertAndRun("SELECT * FROM conversion_cases LIMIT 0"), []);
    assert.match((await rpc("query.mongoConvert", { connectionId, sql: "SELECT * FROM conversion_cases JOIN items ON true" })).error!.message, /não suportada/);
    assert.deepEqual(await convertAndRun("SELECT category FROM conversion_cases GROUP BY category HAVING COUNT(*) >= 2 ORDER BY SUM(value) DESC"), [{ category: "A" }, { category: "B" }]);
    assert.deepEqual(await convertAndRun("SELECT category FROM conversion_cases WHERE NOT (value = 10 OR value IS NULL) ORDER BY value"), [{ category: "C" }, { category: "A" }]);
    await conversionCollection.drop();
    const rejected = await rpc("connection.add", { config: { ...config, endpoint: "mongodb://secret:password@localhost/test" } });
    assert.match(rejected.error!.message, /embedded credentials/);
    assert.ok(!rejected.error!.message.includes("password@"));
  } finally {
    await rpc("connection.remove", { connectionId });
    server.close(); await once(server, "close");
    await closeBackendResources();
    await client.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
