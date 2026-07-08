import type { DialectDescriptor } from "@omni-sql/dialect-descriptors";
import type { Token } from "./lexer.ts";
import { tokenize } from "./lexer.ts";

export type ClauseId =
  | "select-list"
  | "from"
  | "where"
  | "group-by"
  | "having"
  | "order-by"
  | "on"
  | "join"
  | "with"
  | "unknown";

/** Alias/tabela declarado em escopo até o cursor. */
export interface ScopeRef {
  readonly schema: string | null;
  readonly table: string;
  readonly alias: string;
}

export interface AliasNode {
  readonly name: string;
  readonly schema: string | null;
}

/** Contexto resolvido por tier1 para o cursor. */
export interface ResolvedContext {
  readonly clause: ClauseId;
  /** Tokens válidos (sem whitespace/comentário/eof) relevantes à esquerda do cursor. */
  readonly prelude: readonly Token[];
  /** Tokens significantes do statement inteiro (lookahead incluso). */
  readonly statementTokens: readonly Token[];
  /** Aliases disponíveis até o cursor (FROM/JOIN + CTEs). */
  readonly scope: readonly ScopeRef[];
  /** Token sendo digitado no momento (ou null). */
  readonly cursorToken: Token | null;
  /** Qualificador antes do ponto (ex: `t.<cursor>` → "t"). */
  readonly qualifier: string | null;
  /** Statement contendo o cursor (substring). */
  readonly statementText: string;
  /** Offset do statement dentro do SQL completo. */
  readonly statementStart: number;
}

const CLAUSE_KEYWORDS: Record<string, ClauseId> = {
  SELECT: "select-list",
  FROM: "from",
  WHERE: "where",
  GROUP: "group-by",
  HAVING: "having",
  ORDER: "order-by",
  WITH: "with",
};

const MAJOR_CLAUSE_TOKENS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "WITH", "UNION", "EXCEPT", "MINUS", "INTERSECT",
]);

const JOIN_TOKENS = new Set(["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "STRAIGHT_JOIN", "NATURAL"]);

function isSignificant(t: Token): boolean {
  return t.type !== "whitespace" && t.type !== "comment" && t.type !== "eof";
}

/** Encontra o statement que contém o cursor (split por statementSeparator). */
function findStatement(input: string, cursor: number, dialect: DialectDescriptor): {
  text: string;
  start: number;
} {
  const sep = dialect.statementSeparator;
  let start = 0;
  for (let i = 0; i < cursor && i < input.length; i++) {
    if (input[i] === sep) start = i + 1;
  }
  let end = input.length;
  for (let i = cursor; i < input.length; i++) {
    if (input[i] === sep) {
      end = i;
      break;
    }
  }
  return { text: input.slice(start, end), start };
}

/** Determina a cláusula do cursor a partir dos tokens significantes. */
function detectClause(tokens: readonly Token[]): ClauseId {
  let clause: ClauseId = "unknown";
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.type === "keyword") {
      const up = t.upper ?? t.value.toUpperCase();
      if (CLAUSE_KEYWORDS[up]) {
        clause = CLAUSE_KEYWORDS[up]!;
      } else if (up === "ON") {
        clause = "on";
      } else if (up === "JOIN" || JOIN_TOKENS.has(up)) {
        // JOIN é um contexto FROM-like até o próximo ON/próxima cláusula.
        clause = "join";
      }
      // `GROUP BY`/`ORDER BY` exigem 2 tokens; consumimos BY em seguida.
      if ((up === "GROUP" || up === "ORDER") && tokens[i + 1]?.upper === "BY") {
        i += 2;
        continue;
      }
    }
    i++;
  }
  return clause;
}

/** Varre tokens entre FROM/JOIN e a próxima cláusula maior extraindo aliases. */
function extractScope(tokens: readonly Token[]): ScopeRef[] {
  const refs: ScopeRef[] = [];
  // Re-pass: capturar pares `table [alias]` e `schema.table [alias]` em janela FROM.
  let i = 0;
  let insideFrom = false;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.type === "keyword") {
      const up = t.upper ?? t.value.toUpperCase();
      if (up === "FROM" || JOIN_TOKENS.has(up)) {
        insideFrom = true;
        i++;
        while (i < tokens.length && JOIN_TOKENS.has((tokens[i]?.upper) ?? "")) i++;
        continue;
      }
      if (MAJOR_CLAUSE_TOKENS.has(up)) {
        insideFrom = false;
        i++;
        if (up === "GROUP" || up === "ORDER") i++;
        continue;
      }
    }
    if (insideFrom && t.type === "identifier") {
      // Possível `schema.table` ou `table` seguido de alias.
      let schema: string | null = null;
      let table = t.value;
      let j = i + 1;
      if (tokens[j]?.type === "punct" && tokens[j]?.value === ".") {
        schema = t.value;
        const tb = tokens[j + 1];
        if (tb && (tb.type === "identifier" || tb.type === "keyword")) {
          table = tb.value;
          j += 2;
        } else {
          j = i + 1;
        }
      }
      // Pula `AS` opcional e captura alias.
      let aliasId = j;
      if (tokens[aliasId]?.type === "keyword" && (tokens[aliasId]?.upper) === "AS") aliasId++;
      const aliasTok = tokens[aliasId];
      const alias =
        aliasTok && (aliasTok.type === "identifier" || (aliasTok.type === "keyword" && !MAJOR_CLAUSE_TOKENS.has(aliasTok.upper ?? aliasTok.value.toUpperCase()) && !JOIN_TOKENS.has(aliasTok.upper ?? aliasTok.value.toUpperCase())))
          ? aliasTok.value
          : table;
      refs.push({ schema, table, alias });
      i = aliasTok ? aliasId + 1 : j;
      continue;
    }
    if (insideFrom && t.type === "punct" && t.value === ",") {
      i++;
      continue;
    }
    i++;
  }
  return refs;
}

/** Calcula qualificador antes do cursor: `t.` → "t". */
function detectQualifier(tokens: readonly Token[]): string | null {
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1]!;
  if (last.type === "punct" && last.value === ".") {
    const prev = tokens[tokens.length - 2]!;
    if (prev && (prev.type === "identifier" || prev.type === "keyword")) {
      return prev.value;
    }
  }
  return null;
}

/** Token sendo digita no momento (parcial, sem trailing punct/space). */
function detectCursorToken(allTokens: readonly Token[], cursor: number): Token | null {
  for (let i = allTokens.length - 1; i >= 0; i--) {
    const t = allTokens[i]!;
    if (!isSignificant(t)) continue;
    if (cursor >= t.start && cursor <= t.end && t.type === "identifier") return t;
    if (cursor > t.end && t.type === "identifier") return t;
    return null;
  }
  return null;
}

export function resolveContext(
  input: string,
  cursor: number,
  dialect: DialectDescriptor,
): ResolvedContext {
  const { text, start } = findStatement(input, cursor, dialect);
  const all = tokenize(text, dialect);
  const significant = all.filter(isSignificant);
  // Tokens à esquerda do cursor inclusive o parcial.
  const prelude = significant.filter((t) => t.start < cursor - start);
  const cursorToken = detectCursorToken(all, cursor - start);
  const clause = detectClause(prelude);
  // Escopo é extraído do statement inteiro (lookahead) — assim, digitar `SELECT
  // <cursor> FROM users u` ainda resolve aliases da cláusula FROM à direita.
  const scope = extractScope(significant);
  const qualifier = detectQualifier(prelude);
  return {
    clause,
    prelude,
    statementTokens: significant,
    scope,
    cursorToken,
    qualifier,
    statementText: text,
    statementStart: start,
  };
}