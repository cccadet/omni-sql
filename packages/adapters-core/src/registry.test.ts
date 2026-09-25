import assert from "node:assert/strict";
import { test } from "node:test";
import type { Adapter } from "./index.ts";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import { AdapterError, databaseDiagnostic } from "./index.ts";
import { registerAdapter, resolveAdapter } from "./registry.ts";

test("registry rejects unknown dialects and passes credentials to the factory", () => {
  const config = { id: "registry-test", label: "Test", dialect: "postgres", endpoint: "localhost", user: "test" } satisfies ConnectionConfig;
  assert.throws(() => resolveAdapter(config), /adapter not registered for dialect: postgres/);

  const adapter = { id: config.id } as Adapter;
  registerAdapter("postgres", (receivedConfig, password) => {
    assert.equal(receivedConfig, config);
    assert.equal(password, "secret");
    return adapter;
  });
  assert.equal(resolveAdapter(config, "secret"), adapter);
});

test("adapter errors retain the public cause and database diagnostics locate the SQL", () => {
  const error = new AdapterError("network", "offline", { cause: new Error("socket") });
  assert.equal(error.causeTag, "network");
  assert.equal(error.name, "AdapterError");
  assert.equal((error.cause as Error).message, "socket");
  assert.deepEqual(databaseDiagnostic("SELECT 1", error, "postgres"), {
    message: "offline", severity: "error", start: 0, end: 8, source: "database", targetDialect: "postgres",
  });
});
