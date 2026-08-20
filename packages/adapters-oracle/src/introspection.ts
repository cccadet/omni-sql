import oracledb, { type Connection } from "oracledb";
import type {
  Column,
  Constraint,
  FunctionDef,
  FunctionOverload,
  FunctionParameter,
  IndexInfo,
  QueryResult,
  QueryResultColumn,
  Relation,
} from "@omni-sql/ts-types";
import type { RowUpdateSpec } from "@omni-sql/adapters-core";
import { oracleDescriptor, quoteIdentifier } from "@omni-sql/dialect-descriptors";

// ─────────────────────────── Types

export interface RelationRow {
  table_schema: string;
  table_name: string;
  table_type: "TABLE" | "VIEW";
}

export interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "Y" | "N";
  column_default: string | null;
  ordinal_position: number;
}

export interface ConstraintRow {
  owner: string;
  table_name: string;
  constraint_name: string;
  constraint_type: "P" | "R";
  column_name: string;
  r_owner: string | null;
  r_table_name: string | null;
  r_column_name: string | null;
}

export interface ArgumentRow {
  schema: string;
  name: string;
  overload: number | null;
  argument_name: string | null;
  data_type: string | null;
  in_out: "IN" | "OUT" | "IN/OUT" | null;
  position: number;
}

// Schemas maintidos pelo próprio Oracle (SYS, SYSTEM, CTXSYS, ...) — nunca
// interessam ao usuário final, então ficam fora da introspecção por padrão.
const NON_MAINTAINED_OWNER_FILTER =
  "owner NOT IN (SELECT username FROM all_users WHERE oracle_maintained = 'Y')";

const RELATIONS_SQL = `
SELECT owner AS "table_schema", table_name AS "table_name", 'TABLE' AS "table_type"
FROM all_tables
WHERE ${NON_MAINTAINED_OWNER_FILTER}
UNION ALL
SELECT owner AS "table_schema", view_name AS "table_name", 'VIEW' AS "table_type"
FROM all_views
WHERE ${NON_MAINTAINED_OWNER_FILTER}
ORDER BY 1, 2
`;

const COLUMNS_SQL = `
SELECT
  owner AS "table_schema",
  table_name AS "table_name",
  column_name AS "column_name",
  data_type AS "data_type",
  nullable AS "is_nullable",
  data_default AS "column_default",
  column_id AS "ordinal_position"
FROM all_tab_columns
WHERE ${NON_MAINTAINED_OWNER_FILTER}
ORDER BY owner, table_name, column_id
`;

const CONSTRAINTS_SQL = `
SELECT
  ac.owner AS "owner",
  ac.table_name AS "table_name",
  ac.constraint_name AS "constraint_name",
  ac.constraint_type AS "constraint_type",
  acc.column_name AS "column_name",
  rac.owner AS "r_owner",
  rac.table_name AS "r_table_name",
  racc.column_name AS "r_column_name"
FROM all_constraints ac
JOIN all_cons_columns acc
  ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name
LEFT JOIN all_constraints rac
  ON rac.owner = ac.r_owner AND rac.constraint_name = ac.r_constraint_name
LEFT JOIN all_cons_columns racc
  ON racc.owner = rac.owner AND racc.constraint_name = rac.constraint_name AND racc.position = acc.position
WHERE ac.constraint_type IN ('P', 'R')
  AND ac.${NON_MAINTAINED_OWNER_FILTER}
ORDER BY ac.owner, ac.table_name, ac.constraint_name, acc.position
`;

const SCHEMA_NAMES_SQL = `
SELECT username AS "schema_name"
FROM all_users
WHERE oracle_maintained = 'N'
ORDER BY username
`;

/** Lista os nomes de schema (owners) disponíveis sem introspectar tabelas/colunas — usado pela UI para deixar o usuário escolher o que indexar. */
export async function listSchemaNames(conn: Connection): Promise<readonly string[]> {
  const rows = await execRows<{ schema_name: string }>(conn, SCHEMA_NAMES_SQL);
  return rows.map((r) => r.schema_name);
}

const ARGUMENTS_SQL = `
SELECT
  owner AS "schema",
  object_name AS "name",
  overload AS "overload",
  argument_name AS "argument_name",
  data_type AS "data_type",
  in_out AS "in_out",
  position AS "position"
FROM all_arguments
WHERE package_name IS NULL
  AND owner = :schema
ORDER BY object_name, overload, sequence
`;

const INDEXES_SQL = `
SELECT
  ai.index_name AS "index_name",
  ai.uniqueness AS "uniqueness",
  aic.column_name AS "column_name",
  aic.column_position AS "ordinal"
FROM all_indexes ai
JOIN all_ind_columns aic
  ON aic.index_owner = ai.owner AND aic.index_name = ai.index_name
WHERE ai.table_owner = :schema AND ai.table_name = :table_name
ORDER BY ai.index_name, aic.column_position
`;

const PRIMARY_INDEX_NAMES_SQL = `
SELECT index_name AS "index_name"
FROM all_constraints
WHERE owner = :schema AND table_name = :table_name AND constraint_type = 'P' AND index_name IS NOT NULL
`;

export interface IndexRow {
  index_name: string;
  uniqueness: "UNIQUE" | "NONUNIQUE";
  column_name: string;
  ordinal: number;
}

/** Índices de uma tabela — consulta ao vivo (não faz parte da introspecção em lote). */
export async function listIndexesViaConnection(
  conn: Connection,
  schema: string,
  table: string,
): Promise<IndexInfo[]> {
  const rows = await execRows<IndexRow>(conn, INDEXES_SQL, { schema: schema.toUpperCase(), table_name: table.toUpperCase() });
  const pkRows = await execRows<{ index_name: string }>(conn, PRIMARY_INDEX_NAMES_SQL, { schema: schema.toUpperCase(), table_name: table.toUpperCase() });
  const pkNames = new Set(pkRows.map((r) => r.index_name));
  const byName = new Map<string, IndexRow[]>();
  for (const r of rows) {
    if (!byName.has(r.index_name)) byName.set(r.index_name, []);
    byName.get(r.index_name)!.push(r);
  }
  return [...byName.entries()].map(([name, cols]) => ({
    name,
    unique: cols[0]!.uniqueness === "UNIQUE",
    primary: pkNames.has(name),
    columns: cols.slice().sort((a, b) => a.ordinal - b.ordinal).map((c) => c.column_name),
  }));
}

/** Texto de definição (`CREATE VIEW`/`CREATE FUNCTION`) — consulta ao vivo via dicionário de dados. */
export async function getDefinitionViaConnection(
  conn: Connection,
  kind: "view" | "function",
  schema: string,
  name: string,
): Promise<string> {
  if (kind === "view") {
    const rows = await execRows<{ text: string }>(
      conn,
      `SELECT text AS "text" FROM all_views WHERE owner = :schema AND view_name = :name`,
      { schema: schema.toUpperCase(), name: name.toUpperCase() },
    );
    if (rows.length === 0) throw new Error(`view não encontrada: ${schema}.${name}`);
    return `CREATE OR REPLACE VIEW ${quoteIdentifier(oracleDescriptor, schema)}.${quoteIdentifier(oracleDescriptor, name)} AS\n${rows[0]!.text}`;
  }
  const rows = await execRows<{ text: string }>(
    conn,
    `SELECT text AS "text" FROM all_source WHERE owner = :schema AND name = :name AND type = 'FUNCTION' ORDER BY line`,
    { schema: schema.toUpperCase(), name: name.toUpperCase() },
  );
  if (rows.length === 0) throw new Error(`função não encontrada: ${schema}.${name}`);
  return rows.map((r) => r.text).join("");
}

// ─────────────────────────── Introspection routines

export async function introspectSchemas(
  conn: Connection,
  schemaFilter?: readonly string[],
): Promise<ReadonlyArray<readonly [number, string, readonly Relation[]]>> {
  // Filtro em memória (em vez de parametrizar RELATIONS_SQL/COLUMNS_SQL) —
  // mantém as queries multi-linha existentes intactas; o ganho real é pular
  // `listFunctionsPerSchema` (uma query por schema) para os excluídos.
  const allow = schemaFilter && schemaFilter.length > 0 ? new Set(schemaFilter) : null;
  const rels = await execRows<RelationRow>(conn, RELATIONS_SQL);
  const bySchema = new Map<string, RelationRow[]>();
  for (const r of rels) {
    if (allow && !allow.has(r.table_schema)) continue;
    if (!bySchema.has(r.table_schema)) bySchema.set(r.table_schema, []);
    bySchema.get(r.table_schema)!.push(r);
  }

  const cols = await execRows<ColumnRow>(conn, COLUMNS_SQL);
  const colsByTable = new Map<string, ColumnRow[]>();
  for (const c of cols) {
    if (allow && !allow.has(c.table_schema)) continue;
    const key = `${c.table_schema}.${c.table_name}`;
    if (!colsByTable.has(key)) colsByTable.set(key, []);
    colsByTable.get(key)!.push(c);
  }

  const constraints = await execRows<ConstraintRow>(conn, CONSTRAINTS_SQL);
  const pkByTable = new Map<string, { name: string; columns: Set<string> }>();
  const fksByTable = new Map<string, ConstraintRow[]>();
  for (const c of constraints) {
    const key = `${c.owner}.${c.table_name}`;
    if (c.constraint_type === "P") {
      if (!pkByTable.has(key)) pkByTable.set(key, { name: c.constraint_name, columns: new Set() });
      pkByTable.get(key)!.columns.add(c.column_name);
    } else if (c.r_owner !== null && c.r_table_name !== null && c.r_column_name !== null) {
      // LEFT JOINs can produce incomplete FK rows. Keep valid metadata, omit malformed references.
      if (!fksByTable.has(key)) fksByTable.set(key, []);
      fksByTable.get(key)!.push(c);
    }
  }

  const out: Array<readonly [number, string, readonly Relation[]]> = [];
  let i = 0;
  for (const [schemaName, schemaRels] of bySchema) {
    const relations: Relation[] = schemaRels.map((r) => {
      const tableKey = `${schemaName}.${r.table_name}`;
      const rcols = colsByTable.get(tableKey) ?? [];
      const pk = pkByTable.get(tableKey);
      const pkCols = pk?.columns ?? new Set<string>();
      const fkRows = fksByTable.get(tableKey) ?? [];
      const fkByColumn = new Map(fkRows.map((f) => [f.column_name, f]));

      const columns: Column[] = rcols.map((c) => {
        const fk = fkByColumn.get(c.column_name);
        return {
          name: c.column_name,
          dataType: c.data_type,
          nullable: c.is_nullable === "Y",
          isPrimaryKey: pkCols.has(c.column_name),
          ordinalPosition: c.ordinal_position,
          ...(c.column_default !== null ? { defaultValue: c.column_default } : {}),
          ...(fk
            ? {
                foreignKeyTo: {
                  schema: fk.r_owner!,
                  table: fk.r_table_name!,
                  column: fk.r_column_name!,
                },
              }
            : {}),
        };
      });

      const relConstraints: Constraint[] = [];
      if (pkCols.size > 0) {
        relConstraints.push({ name: pk!.name, kind: "primary", columns: [...pkCols] });
      }
      for (const fk of fkRows) {
        relConstraints.push({
          name: fk.constraint_name,
          kind: "foreign",
          columns: [fk.column_name],
          references: {
            schema: fk.r_owner!,
            table: fk.r_table_name!,
            column: fk.r_column_name!,
          },
        });
      }

      return {
        schema: schemaName,
        name: r.table_name,
        kind: r.table_type === "VIEW" ? "view" : "table",
        columns,
        constraints: relConstraints,
      } satisfies Relation;
    });
    out.push([i++, schemaName, relations] as const);
  }
  return out;
}

export async function listFunctionsPerSchema(
  conn: Connection,
  schema: string,
): Promise<FunctionDef[]> {
  const rows = await execRows<ArgumentRow>(conn, ARGUMENTS_SQL, { schema });

  const byName = new Map<string, Map<number, ArgumentRow[]>>();
  for (const r of rows) {
    const overload = r.overload ?? 0;
    if (!byName.has(r.name)) byName.set(r.name, new Map());
    const overloads = byName.get(r.name)!;
    if (!overloads.has(overload)) overloads.set(overload, []);
    overloads.get(overload)!.push(r);
  }

  const out: FunctionDef[] = [];
  for (const [name, overloads] of byName) {
    const overloadsBuilt: FunctionOverload[] = [];
    for (const args of overloads.values()) {
      // Retorno de função escalar vem com argument_name NULL e position 0.
      const ret = args.find((a) => a.argument_name === null && a.position === 0);
      const params: FunctionParameter[] = args
        .filter((a) => a.argument_name !== null)
        .map((a, idx) => ({
          name: a.argument_name!,
          dataType: a.data_type ?? "unknown",
          mode: a.in_out === "OUT" ? "out" : a.in_out === "IN/OUT" ? "inout" : "in",
          ordinalPosition: idx,
        }));
      overloadsBuilt.push({ parameters: params, returnType: ret?.data_type ?? "void" });
    }
    out.push({ schema, name, overloads: overloadsBuilt });
  }
  return out;
}

// ─────────────────────────── Query execution

const ORACLE_LIMIT_BIND = "omni_sql_limit";

interface OracleSqlToken {
  readonly value: string;
  readonly start: number;
  readonly depth: number;
}

function isSqlIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isSqlIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$#]/.test(char);
}

function skipSingleQuoted(sql: string, start: number): number {
  for (let i = start + 1; i < sql.length; i += 1) {
    if (sql[i] !== "'") continue;
    if (sql[i + 1] === "'") {
      i += 1;
      continue;
    }
    return i + 1;
  }
  return sql.length;
}

function skipDoubleQuoted(sql: string, start: number): number {
  for (let i = start + 1; i < sql.length; i += 1) {
    if (sql[i] !== '"') continue;
    if (sql[i + 1] === '"') {
      i += 1;
      continue;
    }
    return i + 1;
  }
  return sql.length;
}

function skipOracleQuoted(sql: string, start: number): number | null {
  if (!/[qQ]/.test(sql[start] ?? "") || sql[start + 1] !== "'") return null;
  const delimiter = sql[start + 2];
  if (delimiter === undefined) return sql.length;
  const closingDelimiter = delimiter === "[" ? "]" : delimiter === "(" ? ")" : delimiter === "{" ? "}" : delimiter === "<" ? ">" : delimiter;
  for (let i = start + 3; i < sql.length; i += 1) {
    if (sql[i] === closingDelimiter && sql[i + 1] === "'") return i + 2;
  }
  return sql.length;
}

function tokenizeOracleSql(sql: string): OracleSqlToken[] {
  const tokens: OracleSqlToken[] = [];
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const char = sql[i]!;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "-" && sql[i + 1] === "-") {
      const newline = sql.indexOf("\n", i + 2);
      i = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (char === "/" && sql[i + 1] === "*") {
      const commentEnd = sql.indexOf("*/", i + 2);
      i = commentEnd === -1 ? sql.length : commentEnd + 2;
      continue;
    }
    const oracleQuotedEnd = skipOracleQuoted(sql, i);
    if (oracleQuotedEnd !== null) {
      i = oracleQuotedEnd;
      continue;
    }
    if (char === "'") {
      i = skipSingleQuoted(sql, i);
      continue;
    }
    if (char === '"') {
      i = skipDoubleQuoted(sql, i);
      continue;
    }
    if (char === "(") {
      tokens.push({ value: char, start: i, depth });
      depth += 1;
      i += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      tokens.push({ value: char, start: i, depth });
      i += 1;
      continue;
    }
    if (char === ";") {
      tokens.push({ value: char, start: i, depth });
      i += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ value: char, start: i, depth });
      i += 1;
      continue;
    }
    if (isSqlIdentifierStart(char)) {
      const start = i;
      i += 1;
      while (i < sql.length && isSqlIdentifierPart(sql[i]!)) i += 1;
      tokens.push({ value: sql.slice(start, i).toUpperCase(), start, depth });
      continue;
    }
    i += 1;
  }
  return tokens;
}

/** Remove only a final statement delimiter outside literals/comments. */
export function stripTrailingStatementDelimiter(sql: string): string {
  const trimmed = sql.trimEnd();
  const last = tokenizeOracleSql(trimmed).at(-1);
  return last?.value === ";" && last.depth === 0 ? trimmed.slice(0, last.start).trimEnd() : trimmed;
}

function withMainStatement(tokens: readonly OracleSqlToken[]): string | undefined {
  let index = 1;
  if (tokens[index]?.value === "RECURSIVE") index += 1;
  while (index < tokens.length) {
    while (index < tokens.length && !(tokens[index]!.value === "AS" && tokens[index]!.depth === 0)) index += 1;
    if (index >= tokens.length || tokens[index + 1]?.value !== "(") return undefined;
    const openingDepth = tokens[index + 1]!.depth;
    index += 2;
    while (index < tokens.length && !(tokens[index]!.value === ")" && tokens[index]!.depth === openingDepth)) index += 1;
    if (index >= tokens.length) return undefined;
    index += 1;
    if (tokens[index]?.value === "," && tokens[index]?.depth === 0) {
      index += 1;
      continue;
    }
    return tokens[index]?.value;
  }
  return undefined;
}

function isReadQuery(sql: string): boolean {
  const tokens = tokenizeOracleSql(sql);
  const first = tokens[0]?.value;
  const statement = first === "SELECT" ? "SELECT" : first === "WITH" ? withMainStatement(tokens) : undefined;
  if (statement !== "SELECT") return false;
  return !tokens.some((token, index) =>
    token.depth === 0 && token.value === "FOR" && tokens[index + 1]?.depth === 0 && tokens[index + 1]?.value === "UPDATE",
  );
}

export interface PreparedOracleQuery {
  readonly sql: string;
  readonly binds: Record<string, number>;
  readonly serverSideLimitApplied: boolean;
}

export function prepareOracleQuery(sql: string, limit: number): PreparedOracleQuery {
  const normalized = stripTrailingStatementDelimiter(sql);
  // O ponto-e-vírgula é um delimitador do cliente (SQL*Plus/IDE), não parte
  // do SQL enviado pela API node-oracledb. Isso vale também para DDL/DCL,
  // como GRANT, que não passam pelo wrapper de SELECT abaixo.
  if (!isReadQuery(normalized)) return { sql: normalized, binds: {}, serverSideLimitApplied: false };
  return {
    sql: `SELECT * FROM (\n${normalized}\n)\nWHERE ROWNUM <= :${ORACLE_LIMIT_BIND}`,
    binds: { [ORACLE_LIMIT_BIND]: limit + 1 },
    serverSideLimitApplied: true,
  };
}

export async function runQueryViaConnection(
  conn: Connection,
  sql: string,
  limit: number,
): Promise<QueryResult> {
  const t0 = Date.now();
  const prepared = prepareOracleQuery(sql, limit);
  const result = await conn.execute(prepared.sql, prepared.serverSideLimitApplied ? prepared.binds : [], {
    resultSet: true,
    outFormat: oracledb.OUT_FORMAT_ARRAY,
  });

  if (!result.resultSet) {
    // DML/DDL sem result set (INSERT/UPDATE/DELETE/CREATE...).
    await conn.commit();
    return {
      columns: [],
      rows: [],
      ...(result.rowsAffected !== undefined ? { rowsAffected: result.rowsAffected } : {}),
      rowsMoreAvailable: false,
      elapsedMs: Date.now() - t0,
    };
  }

  const rs = result.resultSet;
  try {
    const columns: QueryResultColumn[] = (result.metaData ?? []).map((m) => ({
      name: m.name,
      dataType: (m.dbTypeName ?? "unknown").replace(/^DB_TYPE_/, "").toLowerCase(),
      nullable: true,
    }));

    const fetchedRows = (await rs.getRows(prepared.serverSideLimitApplied ? limit + 1 : limit)) as unknown[][];
    const rows = fetchedRows.slice(0, limit);
    let moreAvailable = false;
    if (prepared.serverSideLimitApplied) {
      moreAvailable = fetchedRows.length > limit;
    } else if (rows.length === limit) {
      const peek = (await rs.getRows(1)) as unknown[][];
      moreAvailable = peek.length > 0;
    }
    return {
      columns,
      rows,
      rowsMoreAvailable: moreAvailable,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    await rs.close();
  }
}

/**
 * `UPDATE` de uma linha via PK, com bind vars nomeados (`:s0, :s1, ...` /
 * `:w0, :w1, ...`) — nunca interpola valores no SQL. `spec.where`/`spec.set`
 * já vêm validados pela camada de backend (colunas reais, `where` cobrindo
 * exatamente a PK); aqui só quotamos identificadores e montamos os binds.
 */
export async function updateRowViaConnection(conn: Connection, spec: RowUpdateSpec): Promise<number> {
  const setEntries = Object.entries(spec.set);
  const whereEntries = Object.entries(spec.where);
  if (setEntries.length === 0) throw new Error("updateRow: nada para atualizar (set vazio)");
  if (whereEntries.length === 0) throw new Error("updateRow: where vazio (sem PK para localizar a linha)");

  const binds: Record<string, unknown> = {};
  const setClause = setEntries
    .map(([col, val], i) => {
      const bind = `s${i}`;
      binds[bind] = val;
      return `${quoteIdentifier(oracleDescriptor, col)} = :${bind}`;
    })
    .join(", ");
  const whereClause = whereEntries
    .map(([col, val], i) => {
      const bind = `w${i}`;
      binds[bind] = val;
      return `${quoteIdentifier(oracleDescriptor, col)} = :${bind}`;
    })
    .join(" AND ");
  const tableRef = spec.schema
    ? `${quoteIdentifier(oracleDescriptor, spec.schema)}.${quoteIdentifier(oracleDescriptor, spec.table)}`
    : quoteIdentifier(oracleDescriptor, spec.table);

  // `binds` é `Record<string, unknown>` (valores de coluna arbitrários) — os
  // typings do oracledb exigem um `BindParameter` mais estreito que `unknown`
  // não satisfaz estruturalmente, daí o cast no limite com o driver.
  const result = await conn.execute(
    `UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`,
    binds as Record<string, oracledb.BindParameter>,
  );
  await conn.commit();
  return result.rowsAffected ?? 0;
}

async function execRows<T>(
  conn: Connection,
  sql: string,
  binds: Record<string, string> = {},
): Promise<T[]> {
  const r = await conn.execute<T>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return (r.rows ?? []) as T[];
}
