import type { DialectId, SqlDiagnostic } from "@omni-sql/ts-types";
import { Dialect, transpile } from "@polyglot-sql/sdk";

type Replacement = { readonly name: string; readonly replacement: string; readonly dialects: readonly DialectId[] };

// This catalogue is only used to infer a likely source dialect. The actual
// statement conversion is delegated to Polyglot/WASM below.
const FUNCTION_REPLACEMENTS: readonly Replacement[] = [
  { name: "SYSDATE", replacement: "CURRENT_TIMESTAMP", dialects: ["oracle"] },
  { name: "SYSTIMESTAMP", replacement: "CURRENT_TIMESTAMP", dialects: ["oracle"] },
  { name: "GETDATE", replacement: "CURRENT_TIMESTAMP", dialects: ["sqlserver"] },
  { name: "NOW", replacement: "CURRENT_TIMESTAMP", dialects: ["mysql", "mariadb", "postgres"] },
  { name: "NVL", replacement: "COALESCE", dialects: ["oracle"] },
  { name: "IFNULL", replacement: "COALESCE", dialects: ["mysql", "mariadb"] },
];

function replacementFor(name: string, target: DialectId): Replacement | undefined {
  return FUNCTION_REPLACEMENTS.find((candidate) =>
    candidate.name === name.toUpperCase() && !candidate.dialects.includes(target),
  );
}

function replaceIdentifier(sql: string, start: number, end: number, replacement: string): string {
  return `${sql.slice(0, start)}${replacement}${sql.slice(end)}`;
}

function polyglotDialect(dialect: DialectId): Dialect {
  switch (dialect) {
    case "postgres": return Dialect.PostgreSQL;
    case "mysql":
    case "mariadb": return Dialect.MySQL;
    case "sqlserver": return Dialect.TSQL;
    case "oracle": return Dialect.Oracle;
    default: return Dialect.Generic;
  }
}

function transpileWithPolyglot(sql: string, source: DialectId, target: DialectId): string | undefined {
  try {
    const result = transpile(sql, polyglotDialect(source), polyglotDialect(target), {
      unsupportedLevel: "raise",
    });
    if (!result.success || !result.sql?.[0]) return undefined;
    return normalizeTemporalArithmetic(result.sql[0], source, target);
  } catch {
    return undefined;
  }
}

/**
 * Polyglot translates Oracle's SYSDATE correctly as a timestamp, but an
 * Oracle numeric date offset is still emitted as `timestamp +/- integer`.
 * PostgreSQL requires an interval for that operation; Oracle's number is in
 * days, so preserve that unit explicitly.
 */
function normalizeTemporalArithmetic(sql: string, source: DialectId, target: DialectId): string {
  if (source !== "oracle" || target !== "postgres") return sql;
  return sql.replace(
    /\bCURRENT_TIMESTAMP\b\s*([+-])\s*(\d+(?:\.\d+)?)/gi,
    (_match, operator: string, amount: string) => `CURRENT_TIMESTAMP ${operator} INTERVAL '${amount} days'`,
  );
}

/** Local, zero-I/O diagnostics for well-known cross-dialect functions. */
export function diagnoseDialectFunctions(sql: string, target: DialectId): SqlDiagnostic[] {
  const diagnostics: SqlDiagnostic[] = [];
  const tokenPattern = /\b[A-Za-z_][A-Za-z0-9_$]*\b/g;
  for (const match of sql.matchAll(tokenPattern)) {
    const name = match[0];
    const start = match.index ?? 0;
    const candidate = replacementFor(name, target);
    if (!candidate) continue;
    const sourceDialect = candidate.dialects[0];
    if (!sourceDialect) continue;
    const transpiledSql = transpileWithPolyglot(sql, sourceDialect, target)
      ?? replaceIdentifier(sql, start, start + name.length, candidate.replacement);
    diagnostics.push({
      message: `${name} não existe no dialeto ${target}.`,
      severity: "error",
      start,
      end: start + name.length,
      source: "dialect",
      sourceDialect,
      targetDialect: target,
      transpiledSql,
      transpileMessage: `Possível conversão ${sourceDialect} → ${target}: ${candidate.replacement}`,
    });
  }
  return diagnostics;
}

export function mergeDiagnostics(
  local: readonly SqlDiagnostic[],
  database: readonly SqlDiagnostic[],
): SqlDiagnostic[] {
  const out = [...local];
  for (const diagnostic of database) {
    const duplicate = out.some((item) => item.start === diagnostic.start && item.end === diagnostic.end);
    if (!duplicate) out.push(diagnostic);
  }
  return out.sort((a, b) => a.start - b.start);
}
