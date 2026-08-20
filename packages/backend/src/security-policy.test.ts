import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import {
  assertEndpointHasNoEmbeddedCredentials,
  assertExecutionRiskAccepted,
  assertSafeExplainSql,
  extractLegacyEndpointCredentials,
} from "./security-policy.ts";

test("query run policy requires explicit acknowledgement for destructive SQL", () => {
  assert.doesNotThrow(() => assertExecutionRiskAccepted("SELECT 1", "postgres", undefined));
  assert.throws(() => assertExecutionRiskAccepted("DELETE FROM users", "postgres", undefined), /explicit confirmation/u);
  assert.doesNotThrow(() => assertExecutionRiskAccepted("DELETE FROM users", "postgres", true));
});

test("explain policy permits one read-only SELECT", () => {
  assert.doesNotThrow(() => assertSafeExplainSql("WITH totals AS (SELECT 1) SELECT * FROM totals;", "postgres"));
});

test("explain policy rejects batches, modifying CTEs, and locking reads", () => {
  for (const sql of [
    "SELECT 1; DROP TABLE users",
    "SELECT 1 /* ; */; DELETE FROM users",
    "WITH changed AS (DELETE FROM users RETURNING id) SELECT * FROM changed",
    "SELECT * FROM users FOR UPDATE",
  ]) assert.throws(() => assertSafeExplainSql(sql, "postgres"), /query\.explain/u, sql);
});

const connection = (endpoint: string): ConnectionConfig => ({
  id: "pg", label: "Postgres", dialect: "postgres", endpoint, user: "app",
});

test("connection policy rejects URI credentials but permits normal endpoints", () => {
  assert.throws(
    () => assertEndpointHasNoEmbeddedCredentials(connection("postgres://app:secret@db.example/app")),
    /endpoint não pode incluir/u,
  );
  assert.doesNotThrow(() => assertEndpointHasNoEmbeddedCredentials(connection("postgres://db.example/app")));
  assert.doesNotThrow(() => assertEndpointHasNoEmbeddedCredentials(connection("db.example:5432/app")));
});

test("legacy URI migration removes credentials and preserves them for the keyring", () => {
  const migrated = extractLegacyEndpointCredentials({ ...connection("postgres://legacy%20user:secret%2Fvalue@db.example/app"), user: "" });
  assert.deepEqual(migrated, {
    config: { ...connection("postgres://db.example/app"), user: "legacy user" },
    password: "secret/value",
  });
});
