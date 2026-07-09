import { skipNonCode } from "./sql-statements";

/**
 * Bind variables no estilo `:nome` (Oracle/DataGrip). Não confunde com
 * `::tipo` (cast do Postgres) nem com ocorrências dentro de strings,
 * comentários ou blocos dollar-quoted.
 */
const VARIABLE_RE = /^:([A-Za-z_][A-Za-z0-9_]*)/;

/** Nomes das variáveis em `sql`, na ordem de primeira ocorrência, sem duplicatas. */
export function extractVariables(sql: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const n = sql.length;
  let i = 0;

  while (i < n) {
    const skip = skipNonCode(sql, i);
    if (skip !== null) {
      i = skip;
      continue;
    }

    if (sql[i] === ":") {
      if (sql[i + 1] === ":") {
        i += 2; // `::tipo` — cast, não é variável
        continue;
      }
      const m = VARIABLE_RE.exec(sql.slice(i));
      if (m) {
        const name = m[1]!;
        if (!seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
        i += m[0].length;
        continue;
      }
    }

    i++;
  }

  return names;
}

/** União (ordenada, sem duplicatas) das variáveis em várias instruções. */
export function extractVariablesUnion(sqls: readonly string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const sql of sqls) {
    for (const name of extractVariables(sql)) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * Substitui cada `:nome` por um literal de texto SQL escapado (aspas simples
 * dobradas). Não é bind real via driver — é o mesmo modelo usado por
 * clientes de SQL de mesa (ex.: DataGrip): o valor vira parte do texto
 * enviado ao banco, e a comparação/coerção de tipo fica a cargo do próprio
 * SGBD (funciona bem para número/data comparados contra colunas tipadas).
 */
export function substituteVariables(sql: string, values: Readonly<Record<string, string>>): string {
  let result = "";
  const n = sql.length;
  let i = 0;

  while (i < n) {
    const skip = skipNonCode(sql, i);
    if (skip !== null) {
      result += sql.slice(i, skip);
      i = skip;
      continue;
    }

    if (sql[i] === ":") {
      if (sql[i + 1] === ":") {
        result += "::";
        i += 2;
        continue;
      }
      const m = VARIABLE_RE.exec(sql.slice(i));
      if (m) {
        const value = values[m[1]!] ?? "";
        result += `'${value.replace(/'/g, "''")}'`;
        i += m[0].length;
        continue;
      }
    }

    result += sql[i];
    i++;
  }

  return result;
}
