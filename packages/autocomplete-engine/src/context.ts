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
  readonly aliasQuoted?: boolean;
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
  /**
   * Colunas (lowercased, preservando `alias.coluna` quando qualificado) já
   * digitadas na lista do `SELECT` antes do cursor.
   */
  readonly selectedColumns: readonly string[];
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
export function findStatement(input: string, cursor: number, dialect: DialectDescriptor): {
  text: string;
  start: number;
} {
  const sep = dialect.statementSeparator;
  const boundedCursor = Math.max(0, Math.min(cursor, input.length));
  const separators = tokenize(input, dialect)
    .filter((token) => token.type === "punct" && token.value === sep)
    .map((token) => token.start);
  let start = 0;
  for (const offset of separators) {
    if (offset >= boundedCursor) break;
    start = offset + 1;
  }
  const end = separators.find((offset) => offset >= boundedCursor) ?? input.length;
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
      } else if (up === "ON" || up === "USING") {
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
function extractScope(tokens: readonly Token[], statementText: string): ScopeRef[] {
  const refs: ScopeRef[] = [];
  // Re-pass: capturar pares `table [alias]` e `schema.table [alias]` em janela FROM.
  let i = 0;
  let insideFrom = false;
  let expectRelation = false;
  let inJoinCondition = false;
  // Profundidade de parênteses: corpos de CTE (`WITH x AS (...)`) e
  // subqueries têm seu próprio FROM/JOIN interno, que não pode vazar pro
  // escopo da query externa — senão `WITH b1 AS (SELECT ... FROM t1 JOIN t2
  // ...) SELECT <cursor> FROM b1` sugere colunas de t1/t2 junto com as de
  // b1. Só processamos FROM/JOIN/identificadores no nível 0 (fora de
  // qualquer parêntese); dentro deles, só rastreamos abre/fecha.
  let depth = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.type === "punct" && t.value === "(") {
      if (depth === 0 && expectRelation) expectRelation = false;
      depth++;
      i++;
      continue;
    }
    if (t.type === "punct" && t.value === ")") {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 0 && t.type === "keyword") {
      const up = t.upper ?? t.value.toUpperCase();
      if (up === "FROM") {
        insideFrom = true;
        inJoinCondition = false;
        expectRelation = true;
        i++;
        continue;
      }
      if (up === "JOIN" || up === "STRAIGHT_JOIN") {
        insideFrom = true;
        inJoinCondition = false;
        expectRelation = true;
        i++;
        continue;
      }
      if (JOIN_TOKENS.has(up)) {
        // LEFT/INNER/etc. are JOIN modifiers, not relation names.
        if (insideFrom) {
          inJoinCondition = false;
          expectRelation = true;
        }
        i++;
        continue;
      }
      if (up === "ON" || up === "USING") {
        if (insideFrom) {
          inJoinCondition = true;
          expectRelation = false;
        }
        i++;
        continue;
      }
      if (MAJOR_CLAUSE_TOKENS.has(up)) {
        insideFrom = false;
        inJoinCondition = false;
        expectRelation = false;
        i++;
        if (up === "GROUP" || up === "ORDER") i++;
        continue;
      }
    }
    if (depth === 0 && insideFrom && !inJoinCondition && expectRelation && t.type === "identifier") {
      // Possível `schema.table` ou `table` seguido de alias.
      let schema: string | null = null;
      let table = t.value;
      let tableToken = t;
      let j = i + 1;
      if (tokens[j]?.type === "punct" && tokens[j]?.value === ".") {
        schema = t.value;
        const tb = tokens[j + 1];
        if (tb && (tb.type === "identifier" || tb.type === "keyword")) {
          table = tb.value;
          tableToken = tb;
          j += 2;
        } else {
          j = i + 1;
        }
      }
      // Pula `AS` opcional e captura alias.
      let aliasId = j;
      if (tokens[aliasId]?.type === "keyword" && (tokens[aliasId]?.upper) === "AS") aliasId++;
      const aliasTok = tokens[aliasId];
      const hasAlias = aliasTok?.type === "identifier";
      const alias = hasAlias ? aliasTok.value : table;
      const aliasToken = hasAlias ? aliasTok! : tableToken;
      const aliasQuoted = ["\"", "`", "["].includes(statementText[aliasToken.start]!);
      refs.push({ schema, table, alias, ...(aliasQuoted ? { aliasQuoted: true } : {}) });
      expectRelation = false;
      i = hasAlias ? aliasId + 1 : j;
      continue;
    }
    if (depth === 0 && insideFrom && t.type === "punct" && t.value === ",") {
      inJoinCondition = false;
      expectRelation = true;
      i++;
      continue;
    }
    i++;
  }
  return refs;
}

/**
 * Extrai colunas já digitadas na lista do `SELECT` (profundidade 0) antes do
 * cursor, para excluí-las das sugestões individuais. Só considera segmentos
 * (separados por vírgula em profundidade 0) já completos — o último
 * segmento é o que está sendo digitado agora e não conta. Segmentos que
 * contêm parênteses (expressões, chamadas de função) são ignorados: só
 * `col` ou `t.col` simples são reconhecidos, para evitar falsos positivos.
 */
function extractAlreadySelectedColumns(prelude: readonly Token[]): string[] {
  let selectIdx = -1;
  let depth = 0;
  for (let i = 0; i < prelude.length; i++) {
    const t = prelude[i]!;
    if (t.type === "punct" && t.value === "(") {
      depth++;
      continue;
    }
    if (t.type === "punct" && t.value === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && t.type === "keyword" && (t.upper ?? t.value.toUpperCase()) === "SELECT") {
      selectIdx = i;
    }
  }
  if (selectIdx < 0) return [];

  const segments: Token[][] = [[]];
  depth = 0;
  for (let i = selectIdx + 1; i < prelude.length; i++) {
    const t = prelude[i]!;
    if (t.type === "punct" && t.value === "(") {
      depth++;
      segments[segments.length - 1]!.push(t);
      continue;
    }
    if (t.type === "punct" && t.value === ")") {
      depth = Math.max(0, depth - 1);
      segments[segments.length - 1]!.push(t);
      continue;
    }
    if (depth === 0 && t.type === "punct" && t.value === ",") {
      segments.push([]);
      continue;
    }
    segments[segments.length - 1]!.push(t);
  }

  // O último segmento é o que está sendo digitado agora; não conta como
  // "já selecionado".
  const completed = segments.slice(0, -1);
  const used: string[] = [];
  for (const seg of completed) {
    const hasParen = seg.some((t) => t.type === "punct" && (t.value === "(" || t.value === ")"));
    if (hasParen) continue;
    if (seg[0]?.type !== "identifier") continue;
    let sourceEnd = 1;
    let source = seg[0]!.value.toLowerCase();
    if (seg[1]?.type === "punct" && seg[1].value === "." && seg[2]?.type === "identifier") {
      sourceEnd = 3;
      source = `${source}.${seg[2].value.toLowerCase()}`;
    }
    const suffix = seg.slice(sourceEnd);
    const validAlias =
      suffix.length === 0 ||
      (suffix.length === 1 && suffix[0]?.type === "identifier") ||
      (suffix.length === 2 && suffix[0]?.type === "keyword" && suffix[0].upper === "AS" && suffix[1]?.type === "identifier");
    if (validAlias) used.push(source);
  }
  return used;
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
  if (last.type === "identifier" && tokens[tokens.length - 2]?.value === ".") {
    const prev = tokens[tokens.length - 3];
    if (prev && (prev.type === "identifier" || prev.type === "keyword")) return prev.value;
  }
  return null;
}

/** Token sendo digita no momento (parcial, sem trailing punct/space). */
function detectCursorToken(allTokens: readonly Token[], cursor: number): Token | null {
  for (const t of allTokens) {
    if (isSignificant(t) && t.type === "identifier" && cursor >= t.start && cursor <= t.end) return t;
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
  const scope = extractScope(significant, text);
  const qualifier = detectQualifier(prelude);
  const selectedColumns = clause === "select-list" ? extractAlreadySelectedColumns(prelude) : [];
  return {
    clause,
    prelude,
    statementTokens: significant,
    scope,
    cursorToken,
    qualifier,
    statementText: text,
    statementStart: start,
    selectedColumns,
  };
}
