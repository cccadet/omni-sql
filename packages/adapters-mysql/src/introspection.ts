import type { Pool, PoolConnection, RowDataPacket, FieldPacket, ResultSetHeader } from "mysql2/promise";
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
import { mysqlDescriptor, quoteIdentifier } from "@omni-sql/dialect-descriptors";

// ─────────────────────────── Types

export interface RelationRow extends RowDataPacket {
  table_schema: string;
  table_name: string;
  table_type: "BASE TABLE" | "VIEW";
}

export interface ColumnRow extends RowDataPacket {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  ordinal_position: number;
  is_pk: 0 | 1;
  fk_schema: string | null;
  fk_table: string | null;
  fk_column: string | null;
}

export interface FunctionRow extends RowDataPacket {
  schema: string;
  name: string;
  ret_type: string;
  routine_type: "FUNCTION" | "PROCEDURE";
}

export interface ParameterRow extends RowDataPacket {
  specific_name: string;
  parameter_name: string | null;
  data_type: string | null;
  parameter_mode: "IN" | "OUT" | "INOUT" | null;
  ordinal_position: number;
}

// Schemas mantidos pelo próprio MySQL — nunca interessam ao usuário final.
const SYSTEM_SCHEMAS = ["mysql", "information_schema", "performance_schema", "sys"];
const SYSTEM_SCHEMAS_SQL = SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(", ");

// Aliases explícitos em TODA coluna selecionada aqui e abaixo — sem `AS`,
// o `information_schema` do MySQL devolve o nome da coluna em MAIÚSCULO no
// resultado (ex.: `TABLE_SCHEMA`) independente de como foi escrito no SELECT,
// o que faz o `RowDataPacket` não bater com os campos em minúsculo que o
// driver espera aqui (vira `undefined` silenciosamente).
const SCHEMA_NAMES_SQL = `
SELECT schema_name AS schema_name
FROM information_schema.schemata
WHERE schema_name NOT IN (${SYSTEM_SCHEMAS_SQL})
ORDER BY schema_name
`;

/** Lista os nomes de schema (= database no MySQL) disponíveis — usado pela UI para deixar o usuário escolher o que indexar. */
export async function listSchemaNames(conn: PoolConnection): Promise<readonly string[]> {
  const [rows] = await conn.query<(RowDataPacket & { schema_name: string })[]>(SCHEMA_NAMES_SQL);
  return rows.map((r) => r.schema_name);
}

const RELATIONS_SQL = `
SELECT table_schema AS table_schema, table_name AS table_name, table_type AS table_type
FROM information_schema.tables
WHERE table_schema NOT IN (${SYSTEM_SCHEMAS_SQL})
  AND table_type IN ('BASE TABLE', 'VIEW')
ORDER BY table_schema, table_name
`;

// MySQL já expõe referenced_table_schema/name/column direto em
// key_column_usage — dispensa o segundo join via constraint_column_usage
// que o Postgres precisa (information_schema padrão não tem essas colunas lá).
const COLUMNS_SQL = `
SELECT
  c.table_schema AS table_schema, c.table_name AS table_name, c.column_name AS column_name,
  c.data_type AS data_type,
  c.is_nullable AS is_nullable,
  c.column_default AS column_default,
  c.ordinal_position AS ordinal_position,
  (pk.column_name IS NOT NULL) AS is_pk,
  fk.referenced_table_schema AS fk_schema,
  fk.referenced_table_name   AS fk_table,
  fk.referenced_column_name  AS fk_column
FROM information_schema.columns c
LEFT JOIN (
  SELECT kcu.table_schema, kcu.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
   AND tc.table_name      = kcu.table_name
  WHERE tc.constraint_type = 'PRIMARY KEY'
) pk ON pk.table_schema = c.table_schema
    AND pk.table_name   = c.table_name
    AND pk.column_name  = c.column_name
LEFT JOIN information_schema.key_column_usage fk
  ON fk.table_schema = c.table_schema
 AND fk.table_name   = c.table_name
 AND fk.column_name  = c.column_name
 AND fk.referenced_table_name IS NOT NULL
WHERE c.table_schema NOT IN (${SYSTEM_SCHEMAS_SQL})
ORDER BY c.table_schema, c.table_name, c.ordinal_position
`;

// MySQL não tem overload de função (uma assinatura por nome) — bem mais
// simples que Postgres/Oracle, que precisam agrupar por (schema, name).
const FUNCTIONS_SQL = `
SELECT routine_schema AS \`schema\`, routine_name AS name, data_type AS ret_type,
       routine_type AS routine_type
FROM information_schema.routines
WHERE routine_schema = ? AND routine_type IN ('FUNCTION', 'PROCEDURE')
ORDER BY routine_name
`;

const PARAMETERS_SQL = `
SELECT specific_name AS specific_name, parameter_name AS parameter_name,
       data_type AS data_type, parameter_mode AS parameter_mode, ordinal_position AS ordinal_position
FROM information_schema.parameters
WHERE specific_schema = ? AND routine_type IN ('FUNCTION', 'PROCEDURE')
ORDER BY specific_name, ordinal_position
`;

// PRIMARY é o nome fixo do índice de PK no MySQL — sinaliza `primary` sem
// precisar de uma segunda consulta (diferente de Postgres/Oracle).
const INDEXES_SQL = `
SELECT index_name AS index_name, non_unique AS non_unique, column_name AS column_name, seq_in_index AS seq_in_index
FROM information_schema.statistics
WHERE table_schema = ? AND table_name = ?
ORDER BY index_name, seq_in_index
`;

export interface IndexRow extends RowDataPacket {
  index_name: string;
  non_unique: 0 | 1;
  column_name: string;
  seq_in_index: number;
}

/** Índices de uma tabela — consulta ao vivo (não faz parte da introspecção em lote). */
export async function listIndexesViaPool(pool: Pool, schema: string, table: string): Promise<IndexInfo[]> {
  const [rows] = await pool.query<IndexRow[]>(INDEXES_SQL, [schema, table]);
  const byName = new Map<string, IndexRow[]>();
  for (const r of rows) {
    if (!byName.has(r.index_name)) byName.set(r.index_name, []);
    byName.get(r.index_name)!.push(r);
  }
  return [...byName.entries()].map(([name, cols]) => ({
    name,
    unique: cols[0]!.non_unique === 0,
    primary: name === "PRIMARY",
    columns: cols.slice().sort((a, b) => a.seq_in_index - b.seq_in_index).map((c) => c.column_name),
  }));
}

/** Texto de definição (`CREATE VIEW`/`CREATE FUNCTION`) — consulta ao vivo via `SHOW CREATE`. */
export async function getDefinitionViaPool(
  pool: Pool,
  kind: "view" | "function",
  schema: string,
  name: string,
): Promise<string> {
  const ref = `${quoteIdentifier(mysqlDescriptor, schema)}.${quoteIdentifier(mysqlDescriptor, name)}`;
  if (kind === "view") {
    const [rows] = await pool.query<(RowDataPacket & { "Create View": string })[]>(`SHOW CREATE VIEW ${ref}`);
    if (rows.length === 0) throw new Error(`view não encontrada: ${schema}.${name}`);
    return rows[0]!["Create View"];
  }
  // Tenta FUNCTION primeiro; se não encontrar, tenta PROCEDURE.
  try {
    const [rows] = await pool.query<(RowDataPacket & { "Create Function": string })[]>(`SHOW CREATE FUNCTION ${ref}`);
    if (rows.length > 0) return rows[0]!["Create Function"];
  } catch {
    // não é uma FUNCTION — tenta PROCEDURE abaixo
  }
  const [procRows] = await pool.query<(RowDataPacket & { "Create Procedure": string })[]>(`SHOW CREATE PROCEDURE ${ref}`);
  if (procRows.length === 0) throw new Error(`função/procedure não encontrada: ${schema}.${name}`);
  return procRows[0]!["Create Procedure"];
}

// ─────────────────────────── Introspection routines

export async function introspectSchemas(
  conn: PoolConnection,
  schemaFilter?: readonly string[],
): Promise<ReadonlyArray<readonly [number, string, readonly Relation[]]>> {
  const allow = schemaFilter && schemaFilter.length > 0 ? new Set(schemaFilter) : null;
  const [rels] = await conn.query<RelationRow[]>(RELATIONS_SQL);
  const bySchema = new Map<string, RelationRow[]>();
  for (const r of rels) {
    if (allow && !allow.has(r.table_schema)) continue;
    if (!bySchema.has(r.table_schema)) bySchema.set(r.table_schema, []);
    bySchema.get(r.table_schema)!.push(r);
  }
  const [cols] = await conn.query<ColumnRow[]>(COLUMNS_SQL);
  const colsByTable = new Map<string, ColumnRow[]>();
  for (const c of cols) {
    if (allow && !allow.has(c.table_schema)) continue;
    const key = `${c.table_schema}.${c.table_name}`;
    if (!colsByTable.has(key)) colsByTable.set(key, []);
    colsByTable.get(key)!.push(c);
  }
  const out: Array<readonly [number, string, readonly Relation[]]> = [];
  let i = 0;
  for (const [schemaName, schemaRels] of bySchema) {
    const relations: Relation[] = schemaRels.map((r) => {
      const rcols = colsByTable.get(`${schemaName}.${r.table_name}`) ?? [];
      const columns: Column[] = rcols.map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        nullable: c.is_nullable === "YES",
        isPrimaryKey: c.is_pk === 1,
        ordinalPosition: c.ordinal_position,
        ...(c.column_default !== null ? { defaultValue: c.column_default } : {}),
        ...(c.fk_schema
          ? {
              foreignKeyTo: {
                schema: c.fk_schema,
                table: c.fk_table!,
                column: c.fk_column!,
              },
            }
          : {}),
      }));
      const constraints: Constraint[] = [];
      const pkCols = rcols.filter((c) => c.is_pk === 1).map((c) => c.column_name);
      if (pkCols.length) {
        constraints.push({ name: "pk", kind: "primary", columns: pkCols });
      }
      for (const c of rcols) {
        if (c.fk_schema) {
          constraints.push({
            name: `fk_${c.column_name}`,
            kind: "foreign",
            columns: [c.column_name],
            references: {
              schema: c.fk_schema,
              table: c.fk_table!,
              column: c.fk_column!,
            },
          });
        }
      }
      return {
        schema: schemaName,
        name: r.table_name,
        kind: r.table_type === "VIEW" ? "view" : "table",
        columns,
        constraints,
      } satisfies Relation;
    });
    out.push([i++, schemaName, relations] as const);
  }
  return out;
}

export async function listFunctionsPerSchema(
  conn: PoolConnection,
  schema: string,
): Promise<FunctionDef[]> {
  const [fnRows] = await conn.query<FunctionRow[]>(FUNCTIONS_SQL, [schema]);
  if (fnRows.length === 0) return [];
  const [paramRows] = await conn.query<ParameterRow[]>(PARAMETERS_SQL, [schema]);
  const paramsBySpecificName = new Map<string, ParameterRow[]>();
  for (const p of paramRows) {
    if (!paramsBySpecificName.has(p.specific_name)) paramsBySpecificName.set(p.specific_name, []);
    paramsBySpecificName.get(p.specific_name)!.push(p);
  }

  return fnRows.map((fn) => {
    const args = paramsBySpecificName.get(fn.name) ?? [];
    const params: FunctionParameter[] = args
      .filter((a) => a.parameter_name !== null)
      .map((a, idx) => ({
        name: a.parameter_name!,
        dataType: a.data_type ?? "unknown",
        mode: a.parameter_mode === "OUT" ? "out" : a.parameter_mode === "INOUT" ? "inout" : "in",
        ordinalPosition: idx,
      }));
    const overload: FunctionOverload = { parameters: params, returnType: fn.ret_type };
    return { schema: fn.schema, name: fn.name, overloads: [overload] };
  });
}

// ─────────────────────────── Query execution

/**
 * MySQL não tem um análogo direto ao cursor server-side do Postgres via
 * driver `mysql2`; leituras seguras recebem LIMIT parametrizado de limit+1,
 * enquanto instruções sem rewrite seguro mantêm execução direta.
 */
interface MysqlSqlToken {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly depth: number;
}

function isSqlIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isSqlIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function skipMysqlQuoted(sql: string, start: number): number {
  const quote = sql[start];
  for (let i = start + 1; i < sql.length; i += 1) {
    if (sql[i] === "\\") {
      i += 1;
      continue;
    }
    if (sql[i] !== quote) continue;
    if (sql[i + 1] === quote) {
      i += 1;
      continue;
    }
    return i + 1;
  }
  return sql.length;
}

function isMysqlLineCommentStart(sql: string, index: number): boolean {
  const char = sql[index];
  if (char === "#") return true;
  return char === "-" && sql[index + 1] === "-" && (sql[index + 2] === undefined || /\s/.test(sql[index + 2]!));
}

function tokenizeMysqlSql(sql: string): MysqlSqlToken[] {
  const tokens: MysqlSqlToken[] = [];
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const char = sql[i]!;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (isMysqlLineCommentStart(sql, i)) {
      const newline = sql.indexOf("\n", i + (char === "#" ? 1 : 2));
      i = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (char === "/" && sql[i + 1] === "*") {
      const commentEnd = sql.indexOf("*/", i + 2);
      i = commentEnd === -1 ? sql.length : commentEnd + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const start = i;
      i = skipMysqlQuoted(sql, i);
      tokens.push({ value: "<quoted>", start, end: i, depth });
      continue;
    }
    if (char === "(") {
      tokens.push({ value: char, start: i, end: i + 1, depth });
      depth += 1;
      i += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      tokens.push({ value: char, start: i, end: i + 1, depth });
      i += 1;
      continue;
    }
    if (char === ";" || char === ",") {
      tokens.push({ value: char, start: i, end: i + 1, depth });
      i += 1;
      continue;
    }
    if (isSqlIdentifierStart(char)) {
      const start = i;
      i += 1;
      while (i < sql.length && isSqlIdentifierPart(sql[i]!)) i += 1;
      tokens.push({ value: sql.slice(start, i).toUpperCase(), start, end: i, depth });
      continue;
    }
    tokens.push({ value: char, start: i, end: i + 1, depth });
    i += 1;
  }
  return tokens;
}

function withMainStatement(tokens: readonly MysqlSqlToken[]): string | undefined {
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

function hasTopLevelToken(tokens: readonly MysqlSqlToken[], value: string): boolean {
  return tokens.some((token) => token.depth === 0 && token.value === value);
}

function isReadQuery(tokens: readonly MysqlSqlToken[]): boolean {
  const first = tokens[0]?.value;
  const statement = first === "SELECT" ? "SELECT" : first === "WITH" ? withMainStatement(tokens) : undefined;
  if (statement !== "SELECT") return false;

  // Locking reads and SELECT ... INTO/PROCEDURE have syntax/side effects that
  // make appending LIMIT at statement end unsafe.
  if (hasTopLevelToken(tokens, "INTO") || hasTopLevelToken(tokens, "PROCEDURE")) return false;
  return !tokens.some((token, index) =>
    token.depth === 0 && token.value === "FOR" &&
    (tokens[index + 1]?.value === "UPDATE" || tokens[index + 1]?.value === "SHARE"),
  ) && !tokens.some((token, index) =>
    token.depth === 0 && token.value === "LOCK" &&
    tokens[index + 1]?.depth === 0 && tokens[index + 1]?.value === "IN" &&
    tokens[index + 2]?.depth === 0 && tokens[index + 2]?.value === "SHARE",
  );
}

function hasMultipleStatements(tokens: readonly MysqlSqlToken[]): boolean {
  const semicolons = tokens.filter((token) => token.depth === 0 && token.value === ";");
  return semicolons.length > 0 && (semicolons.length !== 1 || tokens.at(-1) !== semicolons[0]);
}

export interface PreparedMysqlQuery {
  readonly sql: string;
  readonly values?: number[];
  readonly serverSideLimitApplied: boolean;
}

export function prepareMysqlQuery(sql: string, limit: number): PreparedMysqlQuery {
  const tokens = tokenizeMysqlSql(sql);
  if (tokens.length === 0 || hasMultipleStatements(tokens) || !isReadQuery(tokens) || hasTopLevelToken(tokens, "LIMIT")) {
    return { sql, serverSideLimitApplied: false };
  }

  const delimiter = tokens.find((token) => token.depth === 0 && token.value === ";");
  const lastToken = delimiter ? tokens[tokens.indexOf(delimiter) - 1] : tokens.at(-1);
  if (!lastToken || lastToken.value === ";") return { sql, serverSideLimitApplied: false };

  return {
    sql: `${sql.slice(0, lastToken.end)} LIMIT ?${sql.slice(lastToken.end)}`,
    values: [limit + 1],
    serverSideLimitApplied: true,
  };
}

export async function runQueryViaPool(
  pool: Pool,
  sql: string,
  limit: number,
  onConnection?: (connection: PoolConnection) => (() => void) | undefined,
): Promise<QueryResult> {
  const t0 = Date.now();
  const connection = await pool.getConnection();
  let cleanup: (() => void) | undefined;
  try {
    cleanup = onConnection?.(connection);
    const prepared = prepareMysqlQuery(sql, limit);
    const queryOptions = {
      sql: prepared.sql,
      ...(prepared.values ? { values: prepared.values } : {}),
      rowsAsArray: true,
    };
    const [rowsOrHeader, fields]: [unknown, FieldPacket[]] = await connection.query(queryOptions);
    const elapsedMs = Date.now() - t0;

    if (!Array.isArray(rowsOrHeader) || fields.length === 0) {
      // DML/DDL sem result set — mysql2 retorna um ResultSetHeader.
      const header = rowsOrHeader as { affectedRows?: number };
      return {
        columns: [],
        rows: [],
        ...(header.affectedRows !== undefined ? { rowsAffected: header.affectedRows } : {}),
        rowsMoreAvailable: false,
        elapsedMs,
      };
    }

    const columns: QueryResultColumn[] = fields.map((f) => ({
      name: f.name,
      dataType: mapMysqlTypeToDataType(f.type),
      nullable: true,
    }));
    const rows = rowsOrHeader as unknown[][];
    return {
      columns,
      rows: rows.slice(0, limit),
      rowsMoreAvailable: rows.length > limit,
      elapsedMs,
    };
  } finally {
    try {
      cleanup?.();
    } finally {
      connection.release();
    }
  }
}

/** Cancela query por thread id usando outra conexão, nunca conexão executando query. */
export async function cancelQueryViaPool(
  pool: Pool,
  threadId: number,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  const connection = await pool.getConnection();
  try {
    // Evita matar thread reutilizada se query original terminou enquanto killer
    // aguardava slot no pool.
    if (!isCurrent()) return false;
    await connection.query("KILL QUERY ?", [threadId]);
    return true;
  } finally {
    connection.release();
  }
}

/**
 * `UPDATE` de uma linha via PK, parametrizado (`?, ?, ...`) — nunca interpola
 * valores diretamente no SQL. `spec.where`/`spec.set` já vêm validados pela
 * camada de backend; aqui só quotamos identificadores e montamos os binds.
 */
export async function updateRowViaPool(pool: Pool, spec: RowUpdateSpec): Promise<number> {
  const setEntries = Object.entries(spec.set);
  const whereEntries = Object.entries(spec.where);
  if (setEntries.length === 0) throw new Error("updateRow: nada para atualizar (set vazio)");
  if (whereEntries.length === 0) throw new Error("updateRow: where vazio (sem PK para localizar a linha)");

  const values: unknown[] = [];
  const setClause = setEntries
    .map(([col, val]) => {
      values.push(val);
      return `${quoteIdentifier(mysqlDescriptor, col)} = ?`;
    })
    .join(", ");
  const whereClause = whereEntries
    .map(([col, val]) => {
      values.push(val);
      return `${quoteIdentifier(mysqlDescriptor, col)} = ?`;
    })
    .join(" AND ");
  const tableRef = spec.schema
    ? `${quoteIdentifier(mysqlDescriptor, spec.schema)}.${quoteIdentifier(mysqlDescriptor, spec.table)}`
    : quoteIdentifier(mysqlDescriptor, spec.table);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`,
    values,
  );
  return result.affectedRows ?? 0;
}

function mapMysqlTypeToDataType(typeId: number | undefined): string {
  // Códigos numéricos de `mysql2` (enum `Types`) — mapeados para nomes
  // amigáveis de superfície de UI, na mesma linha do mapeamento de OID do pg-adapter.
  const map: Record<number, string> = {
    0: "decimal", 1: "tinyint", 2: "smallint", 3: "int", 4: "float", 5: "double",
    7: "timestamp", 8: "bigint", 9: "mediumint", 10: "date", 11: "time",
    12: "datetime", 13: "year", 15: "varchar", 16: "bit", 245: "json",
    246: "decimal", 247: "enum", 248: "set", 249: "tinyblob", 250: "mediumblob",
    251: "longblob", 252: "blob", 253: "varchar", 254: "char",
  };
  return typeId !== undefined ? (map[typeId] ?? `type:${typeId}`) : "unknown";
}

export type { Pool, PoolConnection };
