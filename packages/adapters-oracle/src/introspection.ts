import oracledb, { type Connection } from "oracledb";
import type {
  Column,
  Constraint,
  FunctionDef,
  FunctionOverload,
  FunctionParameter,
  QueryResult,
  QueryResultColumn,
  Relation,
} from "@omni-sql/ts-types";

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

// ─────────────────────────── Introspection routines

export async function introspectSchemas(
  conn: Connection,
): Promise<ReadonlyArray<readonly [number, string, readonly Relation[]]>> {
  const rels = await execRows<RelationRow>(conn, RELATIONS_SQL);
  const bySchema = new Map<string, RelationRow[]>();
  for (const r of rels) {
    if (!bySchema.has(r.table_schema)) bySchema.set(r.table_schema, []);
    bySchema.get(r.table_schema)!.push(r);
  }

  const cols = await execRows<ColumnRow>(conn, COLUMNS_SQL);
  const colsByTable = new Map<string, ColumnRow[]>();
  for (const c of cols) {
    const key = `${c.table_schema}.${c.table_name}`;
    if (!colsByTable.has(key)) colsByTable.set(key, []);
    colsByTable.get(key)!.push(c);
  }

  const constraints = await execRows<ConstraintRow>(conn, CONSTRAINTS_SQL);
  const pkByTable = new Map<string, Set<string>>();
  const fksByTable = new Map<string, ConstraintRow[]>();
  for (const c of constraints) {
    const key = `${c.owner}.${c.table_name}`;
    if (c.constraint_type === "P") {
      if (!pkByTable.has(key)) pkByTable.set(key, new Set());
      pkByTable.get(key)!.add(c.column_name);
    } else {
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
      const pkCols = pkByTable.get(tableKey) ?? new Set<string>();
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
        relConstraints.push({ name: "pk", kind: "primary", columns: [...pkCols] });
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

export async function runQueryViaConnection(
  conn: Connection,
  sql: string,
  limit: number,
): Promise<QueryResult> {
  const t0 = Date.now();
  const result = await conn.execute(sql, [], {
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

    const rows = (await rs.getRows(limit)) as unknown[][];
    let moreAvailable = false;
    if (rows.length === limit) {
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

async function execRows<T>(
  conn: Connection,
  sql: string,
  binds: Record<string, string> = {},
): Promise<T[]> {
  const r = await conn.execute<T>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return (r.rows ?? []) as T[];
}
