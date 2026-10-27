import type { DialectId } from "@omni-sql/ts-types";
import { skipNonCode } from "./sql-statements";

/** One `name [(cols)] AS [NOT] [MATERIALIZED] (body)` block of a WITH clause. Offsets are relative to the statement text. */
export interface CteDefinition {
  /** Name as written (quotes included), so it can be selected from verbatim. */
  readonly name: string;
  readonly nameStart: number;
  /** Offset just after the closing parenthesis of the body. */
  readonly end: number;
  readonly dataModifying: boolean;
}

export interface CteClause {
  /** Offset of the `WITH` keyword. */
  readonly start: number;
  readonly ctes: readonly CteDefinition[];
  /** Set when the clause could not be read to its end (unbalanced body, missing AS, ...). */
  readonly incomplete: boolean;
  /** Set when a CTE uses syntax the preview does not rebuild (PostgreSQL SEARCH/CYCLE). */
  readonly unsupported: boolean;
}

export type CtePreview =
  | { readonly ok: true; readonly cteName: string; readonly sql: string }
  | { readonly ok: false; readonly reason: "no-cte" | "incomplete" | "unsupported" }
  | { readonly ok: false; readonly reason: "data-modifying"; readonly cteName: string };

const WORD = /[A-Za-z0-9_$#@]/;
const DATA_MODIFYING = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);
/** `FOR UPDATE` / `FOR NO KEY UPDATE` lock rows; they do not change data. */
const LOCKING_PREFIX = new Set(["FOR", "KEY"]);

function skipTrivia(sql: string, i: number, dialect?: DialectId): number {
  while (i < sql.length) {
    if (/\s/.test(sql[i]!)) { i++; continue; }
    const isComment = sql.startsWith("--", i) || sql.startsWith("/*", i);
    if (!isComment) break;
    i = skipNonCode(sql, i, dialect) ?? i + 1;
  }
  return i;
}

function readWord(sql: string, i: number): string | null {
  let j = i;
  while (j < sql.length && WORD.test(sql[j]!)) j++;
  return j > i ? sql.slice(i, j) : null;
}

function keywordAt(sql: string, i: number, keyword: string): boolean {
  return readWord(sql, i)?.toUpperCase() === keyword;
}

const CLOSING_QUOTE: Readonly<Record<string, string>> = { '"': '"', "[": "]", "`": "`" };

/** Reads a plain, "double", [bracket] or `backtick` identifier. Returns the offset after it. */
function readIdentifier(sql: string, i: number): number | null {
  const open = sql[i];
  const close = open === undefined ? undefined : CLOSING_QUOTE[open];
  if (close) {
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === close) {
        if (sql[j + 1] === close) { j += 2; continue; }
        return j + 1;
      }
      j++;
    }
    return null;
  }
  if (!/[A-Za-z_]/.test(open ?? "")) return null;
  const word = readWord(sql, i);
  return word ? i + word.length : null;
}

/** Given the offset of `(`, returns the offset just after its matching `)`, or null if unbalanced. */
function matchParen(sql: string, open: number, dialect?: DialectId): number | null {
  let depth = 0;
  let i = open;
  while (i < sql.length) {
    const skip = skipNonCode(sql, i, dialect);
    if (skip !== null) { i = skip; continue; }
    const c = sql[i]!;
    if (c === "[" || c === "`") { i = readIdentifier(sql, i) ?? sql.length; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
    i++;
  }
  return null;
}

function hasDataModifyingKeyword(sql: string, start: number, end: number, dialect?: DialectId): boolean {
  let previous = "";
  let i = start;
  while (i < end) {
    const skip = skipNonCode(sql, i, dialect);
    if (skip !== null) { i = skip; continue; }
    const word = WORD.test(sql[i]!) && (i === 0 || !WORD.test(sql[i - 1]!)) ? readWord(sql, i) : null;
    if (!word) { i++; continue; }
    const upper = word.toUpperCase();
    if (DATA_MODIFYING.has(upper) && !(upper === "UPDATE" && LOCKING_PREFIX.has(previous))) return true;
    previous = upper;
    i += word.length;
  }
  return false;
}

/** Offsets of `WITH` keywords at parenthesis depth 0, in order. */
function topLevelWithKeywords(sql: string, dialect?: DialectId): number[] {
  const found: number[] = [];
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const skip = skipNonCode(sql, i, dialect);
    if (skip !== null) { i = skip; continue; }
    const c = sql[i]!;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (WORD.test(c) && (i === 0 || !WORD.test(sql[i - 1]!))) {
      const word = readWord(sql, i)!;
      if (depth === 0 && word.toUpperCase() === "WITH") found.push(i);
      i += word.length;
      continue;
    }
    i++;
  }
  return found;
}

/** Reads `name [(cols)] AS` and returns the offset after AS, or null when the text is not a CTE header. */
function readCteHeader(sql: string, i: number, dialect?: DialectId): { nameEnd: number; afterAs: number } | null {
  const nameEnd = readIdentifier(sql, i);
  if (nameEnd === null) return null;
  let j = skipTrivia(sql, nameEnd, dialect);
  if (sql[j] === "(") {
    const columnsEnd = matchParen(sql, j, dialect);
    if (columnsEnd === null) return null;
    j = skipTrivia(sql, columnsEnd, dialect);
  }
  if (!keywordAt(sql, j, "AS")) return null;
  return { nameEnd, afterAs: j + 2 };
}

/**
 * Finds the CTE list of a statement. The first top-level `WITH` followed by a
 * CTE header wins, so `CREATE VIEW v AS WITH ...` and `INSERT INTO t WITH ...`
 * work while `WITH (NOLOCK)` or `WITH TIME ZONE` are skipped. The query after
 * the list is never read: it is often incomplete while the user types.
 */
export function findCteClause(sql: string, dialect?: DialectId): CteClause | null {
  for (const withStart of topLevelWithKeywords(sql, dialect)) {
    let i = skipTrivia(sql, withStart + 4, dialect);
    if (keywordAt(sql, i, "RECURSIVE")) i = skipTrivia(sql, i + "RECURSIVE".length, dialect);
    if (readCteHeader(sql, i, dialect)) return { start: withStart, ...readCteList(sql, i, dialect) };
  }
  return null;
}

/** Reads one CTE starting at its name, or null when it is not complete yet. */
function readCteDefinition(sql: string, i: number, dialect?: DialectId): CteDefinition | null {
  const header = readCteHeader(sql, i, dialect);
  if (!header) return null;
  let j = skipTrivia(sql, header.afterAs, dialect);
  if (keywordAt(sql, j, "NOT")) j = skipTrivia(sql, j + 3, dialect);
  if (keywordAt(sql, j, "MATERIALIZED")) j = skipTrivia(sql, j + "MATERIALIZED".length, dialect);
  const end = sql[j] === "(" ? matchParen(sql, j, dialect) : null;
  if (end === null) return null;
  return { name: sql.slice(i, header.nameEnd), nameStart: i, end, dataModifying: hasDataModifyingKeyword(sql, j, end, dialect) };
}

function readCteList(sql: string, i: number, dialect?: DialectId): Omit<CteClause, "start"> {
  const ctes: CteDefinition[] = [];
  for (;;) {
    const cte = readCteDefinition(sql, i, dialect);
    if (!cte) return { ctes, incomplete: true, unsupported: false };
    ctes.push(cte);
    i = skipTrivia(sql, cte.end, dialect);
    if (keywordAt(sql, i, "SEARCH") || keywordAt(sql, i, "CYCLE")) return { ctes, incomplete: false, unsupported: true };
    if (sql[i] !== ",") return { ctes, incomplete: false, unsupported: false };
    i = skipTrivia(sql, i + 1, dialect);
  }
}

/**
 * Builds `WITH <every CTE up to the target> SELECT * FROM <target>` for the CTE
 * at `offset` (relative to `sql`). Earlier CTEs are kept as written, which
 * resolves chained dependencies; RECURSIVE, column lists and MATERIALIZED are
 * preserved. Row limits and cancellation are left to the normal run path.
 */
export function buildCtePreview(sql: string, offset: number, dialect?: DialectId): CtePreview {
  const clause = findCteClause(sql, dialect);
  if (!clause) return { ok: false, reason: "no-cte" };
  const index = clause.ctes.findIndex((cte) => offset >= cte.nameStart && offset <= cte.end);
  if (index === -1) {
    if (clause.unsupported) return { ok: false, reason: "unsupported" };
    // The cursor sits after the last complete CTE, inside a body that never closes.
    const last = clause.ctes.at(-1);
    if (clause.incomplete && offset > (last?.end ?? clause.start)) return { ok: false, reason: "incomplete" };
    return { ok: false, reason: "no-cte" };
  }
  // SEARCH/CYCLE after the target would be dropped by the slice below and change its columns.
  if (clause.unsupported && index === clause.ctes.length - 1) return { ok: false, reason: "unsupported" };
  const included = clause.ctes.slice(0, index + 1);
  // PostgreSQL runs data-modifying CTEs even when nothing references them.
  const modifying = included.find((cte) => cte.dataModifying);
  if (modifying) return { ok: false, reason: "data-modifying", cteName: modifying.name };
  const target = included[index]!;
  return { ok: true, cteName: target.name, sql: `${sql.slice(clause.start, target.end)}\nSELECT * FROM ${target.name}` };
}
