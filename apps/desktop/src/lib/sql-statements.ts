/**
 * Divide um texto SQL em instruções separadas por `;`, ignorando `;` dentro
 * de strings, identificadores entre aspas, comentários e blocos com
 * dollar-quoting do Postgres (`$$ ... $$` / `$tag$ ... $tag$` — usado em
 * corpos de função/procedure). Não entende blocos PL/SQL do Oracle
 * (`BEGIN ... END;`) sem dollar-quoting — nesses casos o `;` interno do
 * bloco ainda separa instruções incorretamente.
 */
export interface SqlStatement {
  /** Texto da instrução, já sem espaços/`;` nas bordas. */
  text: string;
  /** Offset (no texto original) onde a instrução começa. */
  start: number;
  /** Offset (no texto original) onde a instrução termina. */
  end: number;
}

/**
 * Se `i` está no início de um comentário, string entre aspas ou bloco
 * dollar-quoted, retorna o índice logo após o fim dele. Senão, retorna
 * `null`. Compartilhado entre `splitStatements` e a extração de variáveis
 * (`sql-variables.ts`) — ambos precisam pular esses trechos do mesmo jeito.
 */
export function skipNonCode(sql: string, i: number): number | null {
  const n = sql.length;
  const c = sql[i];

  if (c === "-" && sql[i + 1] === "-") {
    const nl = sql.indexOf("\n", i);
    return nl === -1 ? n : nl;
  }

  if (c === "/" && sql[i + 1] === "*") {
    const close = sql.indexOf("*/", i + 2);
    return close === -1 ? n : close + 2;
  }

  if (c === "'" || c === '"') {
    const quote = c;
    let j = i + 1;
    while (j < n) {
      if (sql[j] === quote) {
        if (sql[j + 1] === quote) {
          j += 2;
          continue;
        }
        j++;
        break;
      }
      j++;
    }
    return j;
  }

  if (c === "$") {
    const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
    if (tagMatch) {
      const tag = tagMatch[0];
      const close = sql.indexOf(tag, i + tag.length);
      return close === -1 ? n : close + tag.length;
    }
  }

  return null;
}

export function splitStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  const n = sql.length;
  let i = 0;
  let stmtStart = 0;

  const pushStatement = (rawEnd: number) => {
    const raw = sql.slice(stmtStart, rawEnd);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const leadingWs = raw.length - raw.trimStart().length;
      const start = stmtStart + leadingWs;
      statements.push({ text: trimmed, start, end: start + trimmed.length });
    }
  };

  while (i < n) {
    const skip = skipNonCode(sql, i);
    if (skip !== null) {
      i = skip;
      continue;
    }

    if (sql[i] === ";") {
      pushStatement(i);
      i++;
      stmtStart = i;
      continue;
    }

    i++;
  }
  pushStatement(n);

  return statements;
}

/** Instrução cujo intervalo contém `offset` (ou a última, se `offset` estiver após tudo). */
export function statementAt(statements: SqlStatement[], offset: number): SqlStatement | undefined {
  for (const s of statements) {
    if (offset <= s.end) return s;
  }
  return statements[statements.length - 1];
}
