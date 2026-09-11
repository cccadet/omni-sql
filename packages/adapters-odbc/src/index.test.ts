import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOdbcConnectionString } from "./index.ts";

test("builds DSN and DSN-less connection strings without persisting credentials", () => {
  assert.equal(buildOdbcConnectionString("Corporate DB", "alice", "s}ecret"), "DSN={Corporate DB};UID={alice};PWD={s}}ecret}");
  assert.equal(buildOdbcConnectionString("DRIVER={SQLite3};Database=C:\\db.sqlite;", "", undefined), "DRIVER={SQLite3};Database=C:\\db.sqlite");
});
