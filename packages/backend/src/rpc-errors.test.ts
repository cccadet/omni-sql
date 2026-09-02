import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcDatabaseError, safeOracleDatabaseError } from "./rpc-errors.ts";

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
