import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
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
  await db.collection("items").insertMany([{ name: "first", nested: { city: "SP" }, tags: ["a", "b"] }, { name: "second", price: 10 }]);
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
