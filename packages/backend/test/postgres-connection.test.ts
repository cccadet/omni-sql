import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonRpcResponse, TestConnectionResult } from "../src/protocol.ts";

const dir = mkdtempSync(join(tmpdir(), "omni-pg-errors-"));
process.env.OMNI_SQL_METADATA_DB = join(dir, "metadata.db");
process.env.OMNI_SQL_DEV_KEYRING_FILE = join(dir, "keyring.json");
process.env.OMNI_SQL_AUTH_TOKEN = "pg-errors-test";
const { startServer } = await import("../src/index.ts");

test("real PostgreSQL connection failures survive test, schema listing and introspection RPC", async () => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const config = { id: "pg-offline", label: "Offline", dialect: "postgres",
    endpoint: `127.0.0.1:${address.port}/postgres`, user: "test" };
  const server = startServer(0);
  await once(server, "listening");
  const rpcAddress = server.address();
  assert.ok(rpcAddress && typeof rpcAddress !== "string");
  const rpc = async (method: string, params: unknown): Promise<JsonRpcResponse> => {
    const response = await fetch(`http://127.0.0.1:${rpcAddress.port}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer pg-errors-test" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return await response.json() as JsonRpcResponse;
  };
  try {
    const tested = await rpc("connection.test", { config, password: "secret" });
    const result = tested.result as TestConnectionResult;
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /^ECONNREFUSED: Connection refused/);
    assert.equal((await rpc("connection.add", { config, password: "secret" })).error, undefined);
    for (const [method, params] of [
      ["connection.listSchemas", { config, password: "secret" }],
      ["metadata.introspect", { connectionId: config.id }],
    ] as const) {
      const response = await rpc(method, params);
      assert.match(response.error?.message ?? "", /^ECONNREFUSED: Connection refused/);
      assert.ok(!JSON.stringify(response).includes("secret"));
    }
  } finally {
    await rpc("connection.remove", { connectionId: config.id });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
