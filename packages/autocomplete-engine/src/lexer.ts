import type { DialectDescriptor } from "@omni-sql/dialect-descriptors";

export type TokenType =
  | "identifier"
  | "keyword"
  | "punct"
  | "string"
  | "number"
  | "comment"
  | "whitespace"
  | "eof";

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  /** Offset inicial (inclusivo). */
  readonly start: number;
  /** Offset final (exclusivo). */
  readonly end: number;
  /** Valor em uppercase para keywords — conveniência. */
  readonly upper?: string;
}

/**
 * Lexer SQL tolerante. Não é um parser de dialeto — apenas separa tokens
 * respeitando o `DialectDescriptor` (quote de identificador, comentários,
 * separadores). Usado em tier1 do autocomplete (Fase 2). O lexer é tolerante:
 * nunca lança; tokens inválidos viram "identifier".
 */
export function tokenize(input: string, dialect: DialectDescriptor): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let i = 0;

  const isIdentStart = (c: string): boolean => /[A-Za-z_$]/.test(c);
  const isIdentCont = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);
  const isDigit = (c: string): boolean => c >= "0" && c <= "9";

  while (i < n) {
    const c = input[i]!;
    const start = i;

    // Whitespace
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      let j = i + 1;
      while (j < n && /[ \t\r\n]/.test(input[j]!)) j++;
      tokens.push({ type: "whitespace", value: input.slice(start, j), start, end: j });
      i = j;
      continue;
    }

    // Block comment
    if (input.startsWith(dialect.blockComment[0], i)) {
      const end = input.indexOf(dialect.blockComment[1], i + dialect.blockComment[0].length);
      const j = end === -1 ? n : end + dialect.blockComment[1].length;
      tokens.push({ type: "comment", value: input.slice(start, j), start, end: j });
      i = j;
      continue;
    }

    // Line comment
    const lineComment = dialect.lineComment.find((p) => input.startsWith(p, i));
    if (lineComment) {
      let j = i + lineComment.length;
      while (j < n && input[j] !== "\n") j++;
      tokens.push({ type: "comment", value: input.slice(start, j), start, end: j });
      i = j;
      continue;
    }

    // String literal (single quote, doubled escape)
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (input[j] === "'") {
          if (input[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      tokens.push({ type: "string", value: input.slice(start, j), start, end: j });
      i = j;
      continue;
    }

    // Identifier quotes
    const quote = dialect.identifierQuoteChars.find((q) => q === c);
    if (quote) {
      let j = i + 1;
      while (j < n && input[j] !== quote) j++;
      if (j < n) j++;
      tokens.push({ type: "identifier", value: input.slice(start, j), start, end: j });
      i = j;
      continue;
    }

    // Number — aceita dígitos, ponto, e notação científica (e/E seguido de +/-).
    if (isDigit(c)) {
      let j = i + 1;
      while (j < n) {
        const ch = input[j]!;
        const prev = input[j - 1]!;
        const isExpSign = (ch === "+" || ch === "-") && /[eE]/.test(prev);
        if (/[0-9.]/.test(ch) || isExpSign || /[eE]/.test(ch)) {
          j++;
        } else {
          break;
        }
      }
      tokens.push({ type: "number", value: input.slice(start, j), start, end: j });
      i = j;
      continue;
    }

    // Identifier
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentCont(input[j]!)) j++;
      const value = input.slice(start, j);
      const upper = value.toUpperCase();
      const type: TokenType = dialect.keywords.has(upper) ? "keyword" : "identifier";
      tokens.push({ type, value, start, end: j, upper: type === "keyword" ? upper : undefined });
      i = j;
      continue;
    }

    // Punctuation
    const single = c;
    if (".,();".includes(single)) {
      tokens.push({ type: "punct", value: single, start, end: i + 1 });
      i += 1;
      continue;
    }

    // Operators — token único por caractere em tier1 (não precisamos de granular)
    if ("+-*/<>=!%".includes(single)) {
      tokens.push({ type: "punct", value: single, start, end: i + 1 });
      i += 1;
      continue;
    }

    // Unknown char → vira identifier de 1 char (tolerância)
    tokens.push({ type: "identifier", value: single, start, end: i + 1 });
    i += 1;
  }

  tokens.push({ type: "eof", value: "", start: n, end: n });
  return tokens;
}