import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcDatabaseError, safeOracleDatabaseError, safePostgresDatabaseError } from "./rpc-errors.ts";

test("safeOracleDatabaseError exposes a structured single-line ORA message", () => {
  const error = Object.assign(
    new Error("ORA-01031: insufficient privileges\nHelp: https://docs.oracle.com/error-help/db/ora-01031/"),
    { code: "ORA-01031", errorNum: 1031 },
  );

  const safe = safeOracleDatabaseError(error);
  assert.ok(safe instanceof RpcDatabaseError);
  assert.equal(safe.message, "ORA-01031: insufficient privileges");
});

test("safeOracleDatabaseError rejects unstructured and mismatched errors", () => {
  assert.equal(safeOracleDatabaseError(new Error("password=secret")), undefined);
  assert.equal(safeOracleDatabaseError(Object.assign(new Error("ORA-01031: denied"), { code: "NJS-500" })), undefined);
  assert.equal(safeOracleDatabaseError(Object.assign(new Error("ORA-00955: duplicate"), { code: "ORA-01031" })), undefined);
});

test("safePostgresDatabaseError exposes a structured SQLSTATE message", () => {
  const error = Object.assign(new Error('column "codex_verified_at" already exists'), { code: "42701", severity: "ERROR" });
  const safe = safePostgresDatabaseError(error);
  assert.ok(safe instanceof RpcDatabaseError);
  assert.equal(safe.message, '42701: column "codex_verified_at" already exists');
});

test("safePostgresDatabaseError rejects unstructured errors", () => {
  assert.equal(safePostgresDatabaseError(new Error("password=secret")), undefined);
  assert.equal(safePostgresDatabaseError(Object.assign(new Error("bad"), { code: "not-sqlstate" })), undefined);
  assert.equal(safePostgresDatabaseError(Object.assign(new Error("user-defined secret"), { code: "P0001" })), undefined);
});

test("PostgreSQL connection errors use fixed messages without driver secrets", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED"]) {
    const safe = safePostgresDatabaseError(Object.assign(new Error("password=secret"), { code }));
    assert.ok(safe instanceof RpcDatabaseError);
    assert.ok(safe.message.startsWith(`${code}: `));
    assert.ok(!safe.message.includes("secret"));
  }
  const safe = safePostgresDatabaseError(Object.assign(new Error("password authentication failed"), { code: "28P01" }));
  assert.equal(safe?.message, "28P01: password authentication failed");
});
