import type { DialectId } from "@omni-sql/ts-types";

/**
 * Descritor por dialeto: ponto de amarra entre o lexer (autocomplete-engine)
 * e os adaptadores. O lexer permanece agnóstico de banco; apenas consulta o
 * descritor para tolerar particularidades sintáticas.
 */
export interface DialectDescriptor {
  readonly dialect: DialectId;
  /** Palavras reservadas em uppercase. */
  readonly keywords: ReadonlySet<string>;
  /** Separador de statements (típico: ";"); Oracle também aceita "/". */
  readonly statementSeparator: string;
  /** Alternativos (ex: Oracle "/"). Vazio se nenhum. */
  readonly alternativeStatementSeparators: readonly string[];
  /** Caracteres de quote de identificador (ex: `"` (ANSI), `` ` `` (MySQL), `[` `]` (MSSQL)). */
  readonly identifierQuoteChars: readonly string[];
  /** Limite de tamanho de nome de identificador (null se desconhecido). */
  readonly identifierMaxLength: number | null;
  /** Prefixo de comentário de linha. */
  readonly lineComment: readonly string[];
  /** Delimitadores de comentário de bloco. */
  readonly blockComment: readonly [string, string];
  /** Sufixo de statements em lotes (ex: T-SQL `GO`). */
  readonly batchTerminator: string | null;
}

const ANSI_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER",
  "ON", "AS", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION",
  "INSERT", "UPDATE", "DELETE", "WITH", "RECURSIVE", "AND", "OR", "NOT", "NULL",
  "IS", "IN", "BETWEEN", "LIKE", "CASE", "WHEN", "THEN", "ELSE", "END", "DISTINCT",
  "ALL", "ANY", "EXISTS", "TRUE", "FALSE", "ASC", "DESC", "CROSS", "USING",
  "VALUES", "INTO", "DEFAULT", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
  "CONSTRAINT", "UNIQUE", "CHECK", "CREATE", "TABLE", "VIEW", "ALTER", "DROP",
  "INDEX", "SET", "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION", "FUNCTION",
  "PROCEDURE", "RETURN", "RETURNS", "DECLARE", "CAST", "AS", "EXPLAIN",
] as const;

const ANSI_BLOCK: [string, string] = ["/*", "*/"];

const PG_KEYWORDS = new Set([
  ...ANSI_KEYWORDS,
  "RETURNING", "ILIKE", "SIMILAR", "OVERLAY", "ARRAY", "ROW", "GENERATED",
  "RETURN", "LANGUAGE", "STRICT", "VOLATILE", "STABLE", "IMMUTABLE",
  "SERIAL", "BIGSERIAL", "SMALLSERIAL", "UUID", "JSONB", "JSON",
]);

const MSSQL_KEYWORDS = new Set([
  ...ANSI_KEYWORDS,
  "TOP", "GO", "MERGE", "OUTPUT", "PIVOT", "UNPIVOT", "APPLY", "OUTPUT",
  "TRY", "CATCH", "THROW", "XML", "ROW", "TABLESAMPLE", "AT", "TIME", "ZONE",
]);

const ORACLE_KEYWORDS = new Set([
  ...ANSI_KEYWORDS,
  "ROWNUM", "SYSDATE", "DUAL", "LEVEL", "CONNECT", "PRIOR", "START", "MINUS",
  "XE", "PACKAGE", "BODY", "PROC", "CURSOR", "LOOP", "EXCEPTION", "RAISE",
  "ROWTYPE", "BULK", "RETURNING", "AT", "TIMESTAMP",
]);

const MYSQL_KEYWORDS = new Set([
  ...ANSI_KEYWORDS,
  "LIMIT", "SHOW", "DESCRIBE", "EXPLAIN", "STRAIGHT_JOIN", "USE", "FORCE",
  "IGNORE", "SQL_CALC_FOUND_ROWS", "SEPARATOR", "AUTO_INCREMENT",
]);

function ansiLike(
  dialect: DialectId,
  keywords: ReadonlySet<string>,
  opts: {
    identifierQuoteChars: readonly string[];
    batchTerminator?: string | null;
    alternativeStatementSeparators?: readonly string[];
  },
): DialectDescriptor {
  return {
    dialect,
    keywords,
    statementSeparator: ";",
    alternativeStatementSeparators: opts.alternativeStatementSeparators ?? [],
    identifierQuoteChars: opts.identifierQuoteChars,
    identifierMaxLength: 63,
    lineComment: ["--"],
    blockComment: ANSI_BLOCK,
    batchTerminator: opts.batchTerminator ?? null,
  };
}

export const postgresDescriptor: DialectDescriptor = ansiLike("postgres", PG_KEYWORDS, {
  identifierQuoteChars: ['"'],
});

export const mysqlDescriptor: DialectDescriptor = ansiLike("mysql", MYSQL_KEYWORDS, {
  identifierQuoteChars: ["`", '"'],
});

export const mariadbDescriptor: DialectDescriptor = {
  ...ansiLike("mariadb", MYSQL_KEYWORDS, { identifierQuoteChars: ["`", '"'] }),
  dialect: "mariadb",
};

export const sqlserverDescriptor: DialectDescriptor = {
  ...ansiLike("sqlserver", MSSQL_KEYWORDS, {
    identifierQuoteChars: ['[', "]"],
    batchTerminator: "GO",
  }),
  identifierMaxLength: 128,
  lineComment: ["--"],
};

export const oracleDescriptor: DialectDescriptor = {
  ...ansiLike("oracle", ORACLE_KEYWORDS, {
    identifierQuoteChars: ['"'],
    alternativeStatementSeparators: ["/"],
  }),
  identifierMaxLength: 30,
  lineComment: ["--"],
};

export const jdbcGenericDescriptor: DialectDescriptor = ansiLike("jdbc-generic", new Set(ANSI_KEYWORDS), {
  identifierQuoteChars: ['"'],
});

export const odbcDescriptor: DialectDescriptor = ansiLike("odbc", new Set(ANSI_KEYWORDS), {
  identifierQuoteChars: ['"'],
});

const REGISTRY = {
  postgres: postgresDescriptor,
  mysql: mysqlDescriptor,
  mariadb: mariadbDescriptor,
  sqlserver: sqlserverDescriptor,
  oracle: oracleDescriptor,
  "jdbc-generic": jdbcGenericDescriptor,
  odbc: odbcDescriptor,
} satisfies Record<DialectId, DialectDescriptor>;

export function dialectDescriptor(dialect: DialectId): Readonly<DialectDescriptor> {
  return REGISTRY[dialect];
}