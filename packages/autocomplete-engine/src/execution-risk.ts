import type { DialectId } from "@omni-sql/ts-types";
import { dialectDescriptor } from "@omni-sql/dialect-descriptors";
import { tokenize, type Token } from "./lexer.ts";

export type ExecutionRiskLevel = "none" | "warning" | "critical";

export type ExecutionRiskKind =
  | "truncate"
  | "drop"
  | "delete-without-where"
  | "update-without-where"
  | "alter-drop"
  | "mongo-update"
  | "mongo-delete";

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

export type ReadOnlySqlAnalysis =
  | { readonly readOnly: true }
  | { readonly readOnly: false; readonly reason: string };

const READ_ONLY_LEADS = new Set(["SELECT", "WITH", "VALUES", "TABLE", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"]);

/** Words that write, lock, change session state or run other code, wherever they appear. */
const NON_READ_WORDS = new Set([
  "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT", "REPLACE", "TRUNCATE", "DROP", "CREATE", "ALTER", "RENAME",
  "GRANT", "REVOKE", "CALL", "EXEC", "EXECUTE", "DO", "COPY", "LOCK", "UNLOCK", "VACUUM", "ANALYZE", "ANALYSE",
  "REINDEX", "CLUSTER", "REFRESH", "IMPORT", "LOAD", "INTO", "OUTFILE", "DUMPFILE", "SET", "RESET", "BEGIN",
  "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "PREPARE", "DEALLOCATE", "LISTEN", "NOTIFY", "UNLISTEN",
  "DISCARD", "ATTACH", "DETACH", "PRAGMA", "INSTALL", "CHECKPOINT", "SHUTDOWN", "KILL", "PURGE", "FLUSH",
  "HANDLER", "OPTIMIZE", "REPAIR", "DECLARE", "UPDLOCK", "XLOCK", "TABLOCKX", "HOLDLOCK",
]);

/** Same-named scalar functions that only read (`REPLACE(s, a, b)`, MySQL `INSERT(s, pos, len, t)`). */
const READ_FUNCTIONS = new Set(["REPLACE", "INSERT"]);

const MONGO_READ_OPERATIONS = new Set(["find", "aggregate"]);

function analyzeMongoReadOnly(text: string): ReadOnlySqlAnalysis {
  let query: unknown;
  try { query = JSON.parse(text); } catch { return { readOnly: false, reason: "MongoDB query must be valid Extended JSON" }; }
  if (!query || typeof query !== "object" || Array.isArray(query)) return { readOnly: false, reason: "MongoDB query must be an object" };
  const { operation, pipeline } = query as { operation?: unknown; pipeline?: unknown };
  if (typeof operation !== "string" || !MONGO_READ_OPERATIONS.has(operation)) {
    return { readOnly: false, reason: "Read-only MongoDB access allows only find and aggregate" };
  }
  if (Array.isArray(pipeline) && pipeline.some((stage) => stage && typeof stage === "object" && ("$out" in stage || "$merge" in stage))) {
    return { readOnly: false, reason: "Read-only MongoDB access rejects $out and $merge stages" };
  }
  return { readOnly: true };
}

/**
 * Fail-closed check for MCP read-only access: one statement that starts with a
 * read command and contains no writing, locking or session-changing word.
 * Quoted identifiers and qualified names (`t.comment`) are not treated as
 * commands. Database functions with side effects cannot be detected lexically;
 * adapters add a database-enforced read-only transaction where supported.
 */
export function analyzeReadOnlySql(sql: string, dialect: DialectId): ReadOnlySqlAnalysis {
  if (dialect === "mongodb") return analyzeMongoReadOnly(sql);
  const descriptor = dialectDescriptor(dialect);
  const tokens = codeTokens(sql, dialect);
  const ranges = statementRanges(sql, tokens, descriptor.statementSeparator, descriptor.batchTerminator);
  if (ranges.length === 0) return { readOnly: false, reason: "SQL is empty" };
  if (ranges.length > 1) return { readOnly: false, reason: "Read-only access allows a single statement" };
  const statement = ranges[0]!.tokens;
  // Quoted identifiers keep their raw quote at `start`; only bare words can be commands.
  const word = (token: Token | undefined): string | null =>
    token && (token.type === "keyword" || token.type === "identifier") && /[A-Za-z_]/.test(sql[token.start] ?? "") ? upper(token) : null;

  const lead = statement.find((token) => token.value !== "(");
  const leadWord = word(lead);
  if (!leadWord || !READ_ONLY_LEADS.has(leadWord)) return { readOnly: false, reason: `Read-only access does not allow ${leadWord ?? "this"} statements` };
  if (leadWord === "EXPLAIN" && word(statement[statement.indexOf(lead!) + 1]) === "PLAN") {
    return { readOnly: false, reason: "EXPLAIN PLAN writes to the plan table; use explainSql instead" };
  }
  for (let i = 0; i < statement.length; i++) {
    const current = word(statement[i]);
    if (!current || statement[i - 1]?.value === ".") continue;
    const next = statement[i + 1];
    if (current === "FOR" && ["UPDATE", "SHARE", "NO", "KEY"].includes(word(next) ?? "")) {
      return { readOnly: false, reason: "Read-only access does not allow locking clauses" };
    }
    if (!NON_READ_WORDS.has(current)) continue;
    if (READ_FUNCTIONS.has(current) && next?.value === "(") continue;
    if (current === "SET" && ["CHARACTER", "CHARSET"].includes(word(statement[i - 1]) ?? "")) continue;
    return { readOnly: false, reason: `Read-only access does not allow ${current}` };
  }
  return { readOnly: true };
}

/** Conservative, dialect-aware preflight for statements that can destroy data or schema. */
export function analyzeExecutionRisk(sql: string, dialect: DialectId): ExecutionRiskAnalysis {
  if (dialect === "mongodb") {
    try {
      const query = JSON.parse(sql) as { operation?: string; collection?: string };
      const kind = query.operation?.startsWith("delete") ? "mongo-delete" : query.operation?.startsWith("update") ? "mongo-update" : null;
      return kind ? { level: "critical", findings: [{ kind, level: "critical", statement: sql, start: 0, objectName: query.collection }] } : { level: "none", findings: [] };
    } catch { return { level: "none", findings: [] }; }
  }
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
