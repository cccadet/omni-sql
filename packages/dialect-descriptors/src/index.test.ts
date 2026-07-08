import { test } from "node:test";
import assert from "node:assert/strict";
import { dialectDescriptor, postgresDescriptor, sqlserverDescriptor, oracleDescriptor } from "./index.ts";

test("postgres descriptor uses ANSI-style identifier quote", () => {
  assert.equal(postgresDescriptor.identifierQuoteChars[0], '"');
  assert.equal(postgresDescriptor.statementSeparator, ";");
  assert.ok(postgresDescriptor.keywords.has("RETURNING"));
});

test("mssql supports square brackets and GO batch terminator", () => {
  assert.deepEqual([...sqlserverDescriptor.identifierQuoteChars], ["[", "]"]);
  assert.equal(sqlserverDescriptor.batchTerminator, "GO");
  assert.ok(sqlserverDescriptor.keywords.has("TOP"));
});

test("oracle accepts alternative slash separator", () => {
  assert.ok(oracleDescriptor.alternativeStatementSeparators.includes("/"));
});

test("registry lookup returns descriptor by id", () => {
  assert.equal(dialectDescriptor("postgres"), postgresDescriptor);
  assert.equal(dialectDescriptor("sqlserver"), sqlserverDescriptor);
});