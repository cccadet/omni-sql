import type { DialectId } from "@omni-sql/ts-types";
import { dialectDescriptor } from "@omni-sql/dialect-descriptors";
import { tokenize, type Token } from "./lexer.ts";

export type ExecutionRiskLevel = "none" | "warning" | "critical";

export type ExecutionRiskKind =
  | "truncate"
  | "drop"
  | "delete-without-where"
  | "update-without-where"
  | "alter-drop";

export interface ExecutionRiskFinding {
  readonly kind: ExecutionRiskKind;
  readonly level: Exclude<ExecutionRiskLevel, "none">;
  readonly statement: string;
  readonly start: number;
  readonly objectName?: string;
}

export interface ExecutionRiskAnalysis {
  readonly level: ExecutionRiskLevel;
  readonly findings: readonly ExecutionRiskFinding[];
}

function codeTokens(sql: string, dialect: DialectId): Token[] {
  return tokenize(sql, dialectDescriptor(dialect)).filter(
    (token) => token.type !== "whitespace" && token.type !== "comment" && token.type !== "eof",
  );
}

function upper(token: Token | undefined): string {
  return token?.upper ?? token?.value.toUpperCase() ?? "";
}

function statementRanges(sql: string, tokens: readonly Token[], separator: string, batchTerminator: string | null): Array<{ start: number; end: number; tokens: Token[] }> {
  const ranges: Array<{ start: number; end: number; tokens: Token[] }> = [];
  let start = 0;
  let current: Token[] = [];
  for (const token of tokens) {
    if ((token.type === "punct" && token.value === separator) || (batchTerminator !== null && upper(token) === batchTerminator)) {
      if (current.length > 0) ranges.push({ start, end: token.start, tokens: current });
      start = token.end;
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) ranges.push({ start, end: sql.length, tokens: current });
  return ranges;
}

function objectAfter(tokens: readonly Token[], index: number): string | undefined {
  const parts: string[] = [];
  for (let i = index + 1; i < tokens.length && parts.length < 3; i++) {
    const token = tokens[i]!;
    if (token.type === "identifier" || token.type === "keyword") parts.push(token.value);
    else if (token.value !== ".") break;
  }
  return parts.length > 0 ? parts.join(".") : undefined;
}

function objectAfterCommand(tokens: readonly Token[], index: number): string | undefined {
  const optionalType = new Set(["TABLE", "DATABASE", "SCHEMA", "VIEW", "INDEX", "COLUMN", "IF", "EXISTS", "ONLY"]);
  let cursor = index;
  while (optionalType.has(upper(tokens[cursor + 1]))) cursor++;
  return objectAfter(tokens, cursor);
}

function hasWhereForOperation(tokens: readonly Token[], operationIndex: number): boolean {
  let depth = 0;
  for (let i = 0; i < operationIndex; i++) {
    if (tokens[i]?.value === "(") depth++;
    if (tokens[i]?.value === ")") depth--;
  }
  const operationDepth = depth;
  for (let i = operationIndex + 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.value === "(") depth++;
    if (token.value === ")") {
      depth--;
      if (depth < operationDepth) break;
    }
    if (depth === operationDepth && upper(token) === "WHERE") return true;
  }
  return false;
}

/** Conservative, dialect-aware preflight for statements that can destroy data or schema. */
export function analyzeExecutionRisk(sql: string, dialect: DialectId): ExecutionRiskAnalysis {
  const descriptor = dialectDescriptor(dialect);
  const tokens = codeTokens(sql, dialect);
  const findings: ExecutionRiskFinding[] = [];

  for (const range of statementRanges(sql, tokens, descriptor.statementSeparator, descriptor.batchTerminator)) {
    const words = range.tokens.map(upper);
    const statement = sql.slice(range.start, range.end).trim();
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!;
      const next = words[i + 1];
      if (word === "TRUNCATE") {
        const objectIndex = next === "TABLE" ? i + 1 : i;
        findings.push({ kind: "truncate", level: "critical", statement, start: range.start, objectName: objectAfter(range.tokens, objectIndex) });
      } else if (word === "DROP" && !words.slice(0, i).includes("ALTER")) {
        findings.push({ kind: "drop", level: "critical", statement, start: range.start, objectName: objectAfterCommand(range.tokens, i) });
      } else if (word === "DELETE" && words[i - 1] !== "ON" && !hasWhereForOperation(range.tokens, i)) {
        findings.push({ kind: "delete-without-where", level: "warning", statement, start: range.start, objectName: objectAfter(range.tokens, next === "FROM" ? i + 1 : i) });
      } else if (word === "UPDATE" && words[i - 1] !== "DO" && words[i - 1] !== "KEY" && !hasWhereForOperation(range.tokens, i)) {
        findings.push({ kind: "update-without-where", level: "warning", statement, start: range.start, objectName: objectAfter(range.tokens, i) });
      } else if (word === "ALTER" && next === "TABLE" && words.slice(i + 2).includes("DROP")) {
        findings.push({ kind: "alter-drop", level: "critical", statement, start: range.start, objectName: objectAfter(range.tokens, i + 1) });
      }
    }
  }

  const deduplicated = findings.filter((finding, index) =>
    findings.findIndex((candidate) => candidate.kind === finding.kind && candidate.start === finding.start) === index,
  );
  const level: ExecutionRiskLevel = deduplicated.some((finding) => finding.level === "critical")
    ? "critical"
    : deduplicated.length > 0 ? "warning" : "none";
  return { level, findings: deduplicated };
}
