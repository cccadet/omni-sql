import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseDialectFunctions, diagnosePolyglotSyntaxError, mergeDiagnostics } from "./sql-diagnostics.ts";

test("diagnoseDialectFunctions localiza SYSDATE e sugere Oracle para PostgreSQL", () => {
  const sql = "SELECT * FROM customers WHERE created_at > sysdate - 10";
  const [diagnostic] = diagnoseDialectFunctions(sql, "postgres");
  assert.ok(diagnostic);
  assert.equal(sql.slice(diagnostic.start, diagnostic.end), "sysdate");
  assert.equal(diagnostic.sourceDialect, "oracle");
  assert.equal(
    diagnostic.transpiledSql,
    "SELECT * FROM customers WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '10 days'",
  );
});

test("transpilation Oracle preserva offsets numéricos de data como intervalos PostgreSQL", () => {
  const [diagnostic] = diagnoseDialectFunctions("select sysdate + 1.5", "postgres");
  assert.match(diagnostic?.transpiledSql ?? "", /CURRENT_TIMESTAMP \+ INTERVAL '1\.5 days'/);
});

test("funções nativas do dialeto alvo não geram falso positivo", () => {
  assert.deepEqual(diagnoseDialectFunctions("select now()", "postgres"), []);
  assert.deepEqual(diagnoseDialectFunctions("select sysdate from dual", "oracle"), []);
});

test("mergeDiagnostics mantém diagnóstico local quando banco cobre o mesmo range", () => {
  const local = diagnoseDialectFunctions("select sysdate", "postgres");
  const database = [{ ...local[0]!, source: "database" as const, message: "erro do banco" }];
  assert.equal(mergeDiagnostics(local, database).length, 1);
  assert.equal(mergeDiagnostics([], database)[0]?.source, "database");
});

test("diagnostica LIMIT PostgreSQL para Oracle com FETCH FIRST", () => {
  const sql = "SELECT * FROM customers LIMIT 10";
  const [diagnostic] = diagnosePolyglotSyntaxError(sql, "oracle", [{
    source: "database",
    message: "ORA-00933: SQL command not properly ended",
    severity: "error",
    start: 0,
    end: sql.length,
  }]);
  assert.equal(diagnostic?.source, "polyglot");
  assert.equal(diagnostic?.sourceDialect, "postgres");
  assert.match(diagnostic?.transpiledSql ?? "", /FETCH FIRST 10 ROWS ONLY/i);
});

test("não sugere Polyglot para falha sem sintaxe", () => {
  const sql = "SELECT * FROM missing_table LIMIT 10";
  assert.deepEqual(diagnosePolyglotSyntaxError(sql, "oracle", [{
    source: "database",
    message: "ORA-00942: table or view does not exist",
    severity: "error",
    start: 0,
    end: sql.length,
  }]), []);
});
