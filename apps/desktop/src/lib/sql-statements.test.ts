import { test, assert } from "vitest";
import { splitStatements, statementAt } from "./sql-statements";

test("splitStatements: separates simple statements", () => {
  const sql = "SELECT 1; SELECT 2;";
  const stmts = splitStatements(sql);
  assert.equal(stmts.length, 2);
  assert.equal(stmts[0]!.text, "SELECT 1");
  assert.equal(stmts[1]!.text, "SELECT 2");
});

test("splitStatements: ignores semicolons inside strings", () => {
  const sql = "SELECT ';'; SELECT 'ok'";
  const stmts = splitStatements(sql);
  assert.equal(stmts.length, 2);
  assert.equal(stmts[0]!.text, "SELECT ';'");
  assert.equal(stmts[1]!.text, "SELECT 'ok'");
});

test("splitStatements: ignores semicolons inside comments", () => {
  const sql = "-- a;b\nSELECT 1; SELECT 2";
  const stmts = splitStatements(sql);
  assert.equal(stmts.length, 2);
  assert.equal(stmts[0]!.text, "-- a;b\nSELECT 1");
  assert.equal(stmts[1]!.text, "SELECT 2");
});

test("splitStatements: handles dollar-quoting", () => {
  const sql = "SELECT $tag$ a;b $tag$; SELECT 1";
  const stmts = splitStatements(sql);
  assert.equal(stmts.length, 2);
  assert.equal(stmts[0]!.text, "SELECT $tag$ a;b $tag$");
  assert.equal(stmts[1]!.text, "SELECT 1");
});

test("statementAt: returns statement containing offset", () => {
  const sql = "SELECT 1; SELECT 2";
  const stmts = splitStatements(sql);
  const first = statementAt(stmts, 2);
  assert.equal(first?.text, "SELECT 1");
  const second = statementAt(stmts, 12);
  assert.equal(second?.text, "SELECT 2");
});
