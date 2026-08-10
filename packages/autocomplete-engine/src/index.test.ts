import { test } from "node:test";
import assert from "node:assert/strict";
import { mysqlDescriptor, oracleDescriptor, postgresDescriptor, sqlserverDescriptor } from "@omni-sql/dialect-descriptors";
import type { DialectDescriptor } from "@omni-sql/dialect-descriptors";
import { autocompleteTier1, type MetadataSource } from "./engine.ts";
import { findStatement, resolveContext, type ScopeRef } from "./context.ts";
import type { FunctionDef, Relation } from "@omni-sql/ts-types";

const USERS: Relation = {
  schema: "public",
  name: "users",
  kind: "table",
  columns: [
    { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinalPosition: 0 },
    { name: "name", dataType: "text", nullable: false, isPrimaryKey: false, ordinalPosition: 1 },
    { name: "email", dataType: "text", nullable: true, isPrimaryKey: false, ordinalPosition: 2 },
  ],
  constraints: [],
};

const ORDERS: Relation = {
  schema: "public",
  name: "orders",
  kind: "table",
  columns: [
    { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinalPosition: 0 },
    { name: "user_id", dataType: "integer", nullable: false, isPrimaryKey: false, ordinalPosition: 1 },
    { name: "total", dataType: "numeric", nullable: false, isPrimaryKey: false, ordinalPosition: 2 },
  ],
  constraints: [],
};

const USERS_VIEW: Relation = {
  schema: "public",
  name: "active_users",
  kind: "view",
  columns: USERS.columns,
  constraints: [],
};

const COALESCE: FunctionDef = {
  schema: "pg_catalog",
  name: "COALESCE",
  overloads: [
    {
      parameters: [{ name: "v", dataType: "any", mode: "in", ordinalPosition: 0 }],
      returnType: "any",
    },
  ],
};

function metaOf(dialect: DialectDescriptor): MetadataSource {
  return {
    dialect,
    listSchemas: () => ["public"],
    listRelations: () => [USERS, ORDERS, USERS_VIEW],
    listFunctions: () => [COALESCE],
    resolveRelation: (ref: ScopeRef) => {
      const all = [USERS, ORDERS, USERS_VIEW];
      return all.find((r) => r.name === ref.table && (ref.schema == null || r.schema === ref.schema)) ?? null;
    },
  };
}

test("FROM prefixa schemas antes de tabelas/views", () => {
  const meta = metaOf(postgresDescriptor);
  const relation: Relation = { ...USERS, name: "auto_table" };
  const schemaMeta: MetadataSource = {
    ...meta,
    listSchemas: () => ["auto", "public"],
    listRelations: () => [relation],
  };
  const sql = "SELECT 1 FROM auto";
  const out = autocompleteTier1(sql, sql.length, schemaMeta);
  assert.equal(out[0]?.kind, "schema");
  assert.equal(out[0]?.label, "auto");
  assert.equal(out[1]?.kind, "table");
  assert.equal(out[1]?.label, "auto_table");
});

test("caso 1: cursor após FROM → sugere tabelas/views", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT 1 FROM ";
  const out = autocompleteTier1(sql, sql.length, meta);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("users"));
  assert.ok(labels.includes("orders"));
  assert.ok(labels.includes("active_users"));
  assert.ok(labels.includes("public"));
  assert.ok(out.some((s) => s.kind === "schema"));
});

test("FROM sem prefixo sugere schemas e relações", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT * FROM ";
  const out = autocompleteTier1(sql, sql.length, meta);
  assert.ok(out.some((s) => s.kind === "schema" && s.label === "public"));
  assert.ok(out.some((s) => s.kind === "table" && s.label === "users"));
});

test("schema. sugere apenas relações do schema", () => {
  const meta = metaOf(postgresDescriptor);
  const auditUsers: Relation = { ...USERS, schema: "audit", name: "users" };
  const schemaMeta: MetadataSource = {
    ...meta,
    listSchemas: () => ["public", "audit"],
    listRelations: () => [...meta.listRelations(), auditUsers],
  };
  const sql = "SELECT * FROM audit.";
  const out = autocompleteTier1(sql, sql.length, schemaMeta);
  assert.deepEqual(out.map((s) => s.label), ["users"]);
  assert.equal(out[0]?.insertText, "users");
});

test("schema.partial seleciona somente parte da tabela", () => {
  const meta = metaOf(postgresDescriptor);
  const auditUsers: Relation = { ...USERS, schema: "audit", name: "users" };
  const schemaMeta: MetadataSource = {
    ...meta,
    listSchemas: () => ["audit"],
    listRelations: () => [auditUsers, USERS],
  };
  const sql = "SELECT * FROM audit.us";
  const out = autocompleteTier1(sql, sql.length, schemaMeta);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.label, "users");
  assert.equal(out[0]?.insertText, "users");
});

test("caso 2: SELECT sem FROM → `*`, sem ruído de funções sem prefixo", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT ";
  const out = autocompleteTier1(sql, sql.length, meta);
  const labels = out.map((s) => s.label);
  assert.deepEqual(labels, ["*"]);
});

test("prefixos contextuais oferecem snippets mínimos", () => {
  const meta = metaOf(postgresDescriptor);
  const snippets = [
    ["", "SELECT * FROM $1"],
    ["sel", "SELECT * FROM $1"],
    ["order", "ORDER BY $1"],
    ["GROUP", "GROUP BY $1"],
    ["left", "LEFT JOIN $1 ON $2"],
    ["INNER", "INNER JOIN $1 ON $2"],
  ] as const;
  for (const [sql, expected] of snippets) {
    const out = autocompleteTier1(sql, sql.length, meta);
    assert.deepEqual(out.map((suggestion) => suggestion.insertText), [expected], sql || "empty input");
    assert.ok(out.every((suggestion) => !suggestion.label.includes("$")));
  }
});

test("ORDER/GROUP top-level sem BY sugerem somente BY; após BY sugerem colunas", () => {
  for (const keyword of ["ORDER", "GROUP"] as const) {
    const pending = `SELECT * FROM users ${keyword} `;
    const pendingOut = autocompleteTier1(pending, pending.length, metaOf(postgresDescriptor));
    assert.deepEqual(pendingOut.map((suggestion) => suggestion.label), ["BY"]);
    assert.equal(pendingOut[0]?.insertText, "BY ");

    const complete = `${pending}BY `;
    const completeOut = autocompleteTier1(complete, complete.length, metaOf(postgresDescriptor));
    assert.ok(completeOut.some((suggestion) => suggestion.label === "id"));
    assert.ok(!completeOut.some((suggestion) => suggestion.label === "BY"));
  }
});

test("ORDER/GROUP sem BY sugere BY no nível de subquery contendo cursor", () => {
  for (const keyword of ["ORDER", "GROUP"] as const) {
    const sql = `SELECT * FROM users WHERE id IN (SELECT id FROM orders ${keyword} `;
    const out = autocompleteTier1(sql, sql.length, metaOf(postgresDescriptor));
    assert.deepEqual(out.map((suggestion) => suggestion.label), ["BY"]);
  }
});

test("qualifier quoted compara alias exatamente; qualifier nonquoted aplica folding", () => {
  const quotedSql = 'SELECT "x". FROM users "X" JOIN orders "x" ON true';
  const quotedCtx = resolveContext(quotedSql, 'SELECT "x".'.length, postgresDescriptor);
  assert.equal(quotedCtx.qualifier, "x");
  assert.equal(quotedCtx.qualifierQuoted, true);
  const quotedOut = autocompleteTier1(quotedSql, 'SELECT "x".'.length, metaOf(postgresDescriptor));
  assert.deepEqual(quotedOut.map((suggestion) => suggestion.label), ["id", "total", "user_id"]);

  const nonquotedSql = "SELECT U. FROM users u";
  const nonquotedCtx = resolveContext(nonquotedSql, "SELECT U.".length, postgresDescriptor);
  assert.equal(nonquotedCtx.qualifier, "U");
  assert.equal(nonquotedCtx.qualifierQuoted, undefined);
  const nonquotedOut = autocompleteTier1(nonquotedSql, "SELECT U.".length, metaOf(postgresDescriptor));
  assert.deepEqual(nonquotedOut.map((suggestion) => suggestion.label), ["email", "id", "name"]);
  const oracleOut = autocompleteTier1(nonquotedSql, "SELECT U.".length, metaOf(oracleDescriptor));
  assert.deepEqual(oracleOut.map((suggestion) => suggestion.label), ["email", "id", "name"]);
});

test("aliases quoted/nonquoted com mesmo valor resolvem em Postgres e Oracle", () => {
  for (const dialect of [postgresDescriptor, oracleDescriptor]) {
    const quotedAlias = 'SELECT u. FROM users "u"';
    assert.deepEqual(
      autocompleteTier1(quotedAlias, "SELECT u.".length, metaOf(dialect)).map((suggestion) => suggestion.label),
      ["email", "id", "name"],
    );

    const unquotedAlias = "SELECT \"u\". FROM users u";
    assert.deepEqual(
      autocompleteTier1(unquotedAlias, 'SELECT "u".'.length, metaOf(dialect)).map((suggestion) => suggestion.label),
      ["email", "id", "name"],
    );
  }
});

test("qualifier quoted não resolve alias quoted com caixa diferente", () => {
  const sql = 'SELECT "x". FROM users "X"';
  const out = autocompleteTier1(sql, 'SELECT "x".'.length, metaOf(postgresDescriptor));
  assert.deepEqual(out, []);
});

test("ORDER/GROUP sem BY fora de subquery continua no nível externo", () => {
  const sql = "SELECT * FROM users WHERE id IN (SELECT id FROM orders) ORDER ";
  const out = autocompleteTier1(sql, sql.length, metaOf(postgresDescriptor));
  assert.deepEqual(out.map((suggestion) => suggestion.label), ["BY"]);
});

test("findStatement separa slash Oracle somente isolado em linha", () => {
  const sql = "SELECT ' / ' AS marker /* / */ FROM dual\n/\nSELECT 2 FROM dual";
  const cursor = sql.lastIndexOf("SELECT 2") + "SELECT 2".length;
  assert.equal(findStatement(sql, cursor, oracleDescriptor).text.trim(), "SELECT 2 FROM dual");

  const division = "SELECT 10 / 2 FROM dual";
  assert.equal(findStatement(division, division.length, oracleDescriptor).text, division);
});

test("findStatement separa SQL Server GO somente isolado em linha", () => {
  const sql = "SELECT 'GO' AS marker -- GO\nFROM users\nGO\nSELECT 2 FROM users";
  const cursor = sql.lastIndexOf("SELECT 2") + "SELECT 2".length;
  assert.equal(findStatement(sql, cursor, sqlserverDescriptor).text.trim(), "SELECT 2 FROM users");

  const quoted = "SELECT 'GO' AS marker";
  assert.equal(findStatement(quoted, quoted.length, sqlserverDescriptor).text, quoted);
});

test("após relação sugere somente transições SQL, em ordem", () => {
  const sql = "SELECT * FROM users ";
  const out = autocompleteTier1(sql, sql.length, metaOf(postgresDescriptor));
  assert.deepEqual(out.map((suggestion) => suggestion.label), [
    "WHERE",
    "JOIN",
    "GROUP BY",
    "HAVING",
    "ORDER BY",
  ]);
  assert.ok(!out.some((suggestion) => ["users", "orders", "active_users"].includes(suggestion.label)));
});

test("LEFT/INNER completos pedem JOIN, sem FULL em MySQL/MariaDB", () => {
  for (const dialect of [mysqlDescriptor, { ...mysqlDescriptor, dialect: "mariadb" as const }]) {
    for (const modifier of ["LEFT", "INNER"]) {
      const sql = `SELECT * FROM users ${modifier} `;
      const out = autocompleteTier1(sql, sql.length, metaOf(dialect));
      assert.deepEqual(out.map((suggestion) => suggestion.label), ["JOIN"]);
      assert.ok(!out.some((suggestion) => suggestion.label.toUpperCase().includes("FULL")));
    }
    const full = autocompleteTier1("SELECT * FROM users full", "SELECT * FROM users full".length, metaOf(dialect));
    assert.ok(!full.some((suggestion) => suggestion.label.toUpperCase().includes("FULL")));
  }
});

test("caso 3: SELECT ... FROM users → colunas da tabela em escopo", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT  FROM users";
  const cursor = "SELECT ".length;
  const out = autocompleteTier1(sql, cursor, meta);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("id"));
  assert.ok(labels.includes("email"));
});

test("caso 4: alias `u.` → colunas do alias", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT u. FROM users u";
  const cursor = "SELECT u.".length;
  const out = autocompleteTier1(sql, cursor, meta);
  assert.ok(out.every((s) => s.kind === "column"));
  const labels = out.map((s) => s.label);
  assert.deepEqual([...labels].sort(), ["email", "id", "name"]);
});

test("identificadores quoted resolvem aliases ANSI, MySQL e SQL Server", () => {
  for (const [dialect, quote] of [
    [postgresDescriptor, '"'],
    [mysqlDescriptor, "`"],
    [sqlserverDescriptor, "["],
  ] as const) {
    const closeQuote = quote === "[" ? "]" : quote;
    const sql = `SELECT ${quote}x${closeQuote}. FROM users ${quote}x${closeQuote}`;
    const out = autocompleteTier1(sql, "SELECT ".length + 4, metaOf(dialect));
    assert.deepEqual(out.map((s) => s.label), ["email", "id", "name"]);
  }
});

test("alias case-insensitive resolve colunas", () => {
  const sql = "SELECT U. FROM users u";
  const out = autocompleteTier1(sql, "SELECT U.".length, metaOf(postgresDescriptor));
  assert.deepEqual(out.map((s) => s.label), ["email", "id", "name"]);
});

test("alias uppercase não citado preserva texto, sem quote automático", () => {
  const sql = "SELECT  FROM users X JOIN orders o ON true";
  const ids = autocompleteTier1(sql, "SELECT ".length, metaOf(postgresDescriptor)).filter((suggestion) => suggestion.label === "id");
  assert.ok(ids.some((suggestion) => suggestion.insertText === "X.id"));
  assert.ok(!ids.some((suggestion) => suggestion.insertText === '"X".id'));
});

test("caso 5: múltiplos JOINs com aliases → colunas de todas em escopo (WHERE)", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT u.id FROM users u JOIN orders o ON u.id = o.user_id WHERE ";
  const cursor = sql.length;
  const out = autocompleteTier1(sql, cursor, meta);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("id"));
  assert.ok(labels.includes("user_id"));
  assert.ok(labels.includes("total"));
});

test("JOIN orders ON não transforma ON em alias e sugere colunas de orders", () => {
  const sql = "SELECT * FROM users JOIN orders ON ";
  const ctx = resolveContext(sql, sql.length, postgresDescriptor);
  assert.deepEqual(ctx.scope, [
    { schema: null, table: "users", alias: "users" },
    { schema: null, table: "orders", alias: "orders" },
  ]);
  const out = autocompleteTier1(sql, sql.length, metaOf(postgresDescriptor));
  assert.ok(out.some((suggestion) => suggestion.label === "user_id"));
  assert.ok(out.some((suggestion) => suggestion.detail?.startsWith("orders.")));
  assert.ok(!out.some((suggestion) => suggestion.detail?.startsWith("ON.")));
});

test("após relação JOIN sugere ON prioritário, sem transições gerais", () => {
  const sql = "SELECT * FROM users JOIN orders ";
  const out = autocompleteTier1(sql, sql.length, metaOf(postgresDescriptor));
  assert.deepEqual(out.map((suggestion) => suggestion.label), ["ON", "USING"]);
  assert.equal(out[0]?.insertText, "ON ");
  assert.equal(out[0]?.relevance, 1000);
});

test("CROSS/NATURAL JOIN não sugerem ON/USING após relação", () => {
  for (const join of ["CROSS JOIN", "NATURAL JOIN"] as const) {
    const sql = `SELECT * FROM users ${join} orders `;
    const out = autocompleteTier1(sql, sql.length, metaOf(postgresDescriptor));
    assert.deepEqual(out.map((suggestion) => suggestion.label), [
      "WHERE",
      "JOIN",
      "GROUP BY",
      "HAVING",
      "ORDER BY",
    ]);
    assert.ok(!out.some((suggestion) => ["ON", "USING"].includes(suggestion.label)));
  }
});

test("SQL Server não sugere USING após relação JOIN", () => {
  const sql = "SELECT * FROM users JOIN orders ";
  const out = autocompleteTier1(sql, sql.length, metaOf(sqlserverDescriptor));
  assert.deepEqual(out.map((suggestion) => suggestion.label), ["ON"]);
});

test("USING também não vira alias", () => {
  const sql = "SELECT * FROM users JOIN orders USING ";
  const ctx = resolveContext(sql, sql.length, postgresDescriptor);
  assert.deepEqual(ctx.scope.map((ref) => ref.alias), ["users", "orders"]);
  assert.equal(ctx.clause, "on");
});

test("USING sugere somente nomes comuns, sem qualificação ou duplicatas", () => {
  const keywordUsers = { ...USERS, columns: [...USERS.columns, { name: "order", dataType: "text", nullable: true, isPrimaryKey: false, ordinalPosition: 3 }, { name: "display-name", dataType: "text", nullable: true, isPrimaryKey: false, ordinalPosition: 4 }] };
  const keywordOrders = { ...ORDERS, columns: [...ORDERS.columns, { name: "order", dataType: "text", nullable: true, isPrimaryKey: false, ordinalPosition: 3 }, { name: "display-name", dataType: "text", nullable: true, isPrimaryKey: false, ordinalPosition: 4 }] };
  const base = metaOf(postgresDescriptor);
  const meta: MetadataSource = {
    ...base,
    listRelations: () => [keywordUsers, keywordOrders],
    resolveRelation: (ref) => [keywordUsers, keywordOrders].find((relation) => relation.name === ref.table) ?? null,
  };
  const sql = "SELECT * FROM users JOIN orders USING (";
  const out = autocompleteTier1(sql, sql.length, meta);
  assert.deepEqual(out.map((suggestion) => suggestion.label), ["display-name", "id", "order"]);
  assert.equal(out.find((suggestion) => suggestion.label === "order")?.insertText, '"order"');
  assert.equal(out.find((suggestion) => suggestion.label === "display-name")?.insertText, '"display-name"');
  assert.ok(out.every((suggestion) => !suggestion.insertText?.includes(".")));
});

test("colunas homônimas em JOIN inserem alias.qualificação", () => {
  const sql = "SELECT  FROM users u JOIN orders o ON u.id = o.user_id";
  const out = autocompleteTier1(sql, "SELECT ".length, metaOf(postgresDescriptor));
  assert.deepEqual(
    out.filter((s) => s.label === "id").map((s) => s.insertText).sort(),
    ["o.id", "u.id"],
  );
});

test("caso 6: ORDER BY reusa colunas em escopo", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT u.id FROM users u ORDER BY ";
  const cursor = sql.length;
  const out = autocompleteTier1(sql, cursor, meta);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("id"));
  assert.ok(labels.includes("email"));
});

test("colunas sem prefixo digitado saem em ordem alfabética", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT  FROM users";
  const cursor = "SELECT ".length;
  const out = autocompleteTier1(sql, cursor, meta);
  const colLabels = out.filter((s) => s.kind === "column").map((s) => s.label);
  assert.deepEqual(colLabels, ["email", "id", "name"]);
});

test("sugestão 'Todas as colunas' insere todas as colunas de uma vez", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT  FROM users";
  const cursor = "SELECT ".length;
  const out = autocompleteTier1(sql, cursor, meta);
  const allCols = out.find((s) => s.kind === "all-columns");
  assert.ok(allCols, "sugestão 'Todas as colunas' ausente");
  assert.equal(allCols!.insertText, "id, name, email");
  assert.ok(allCols!.relevance < (out.find((suggestion) => suggestion.kind === "column")?.relevance ?? 0));
  assert.ok(out.indexOf(allCols!) > out.findIndex((suggestion) => suggestion.kind === "column"));
});

test("'Todas as colunas' não aparece fora do select-list (ex: WHERE)", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT u.id FROM users u WHERE ";
  const cursor = sql.length;
  const out = autocompleteTier1(sql, cursor, meta);
  assert.ok(!out.some((s) => s.kind === "all-columns"));
});

test("coluna já digitada no SELECT some das sugestões individuais e da expansão", () => {
  const meta = metaOf(postgresDescriptor);
  const sql = "SELECT id,  FROM users";
  const cursor = "SELECT id, ".length;
  const out = autocompleteTier1(sql, cursor, meta);
  const colLabels = out.filter((s) => s.kind === "column").map((s) => s.label);
  assert.ok(!colLabels.includes("id"), "coluna já selecionada ainda aparece na lista individual");
  assert.ok(colLabels.includes("email"));
  assert.ok(colLabels.includes("name"));
  const allCols = out.find((s) => s.kind === "all-columns");
  assert.equal(allCols?.insertText, "name, email");
});

test("coluna qualificada selecionada só remove mesma relação", () => {
  const sql = "SELECT u.id,  FROM users u JOIN orders o ON u.id = o.user_id";
  const out = autocompleteTier1(sql, "SELECT u.id, ".length, metaOf(postgresDescriptor));
  const ids = out.filter((suggestion) => suggestion.label === "id");
  assert.deepEqual(ids.map((suggestion) => suggestion.insertText), ["o.id"]);
});

test("'Todas as colunas' some quando não há colunas faltantes", () => {
  const sql = "SELECT id, name, email,  FROM users";
  const cursor = "SELECT id, name, email, ".length;
  const out = autocompleteTier1(sql, cursor, metaOf(postgresDescriptor));
  assert.ok(!out.some((suggestion) => suggestion.kind === "all-columns"));
});

test("funções aparecem somente com prefixo case-insensitive", () => {
  const meta = metaOf(postgresDescriptor);
  assert.deepEqual(
    autocompleteTier1("SELECT ", 7, meta).filter((suggestion) => suggestion.kind === "function"),
    [],
  );
  assert.deepEqual(
    autocompleteTier1("SELECT co", 9, meta).filter((suggestion) => suggestion.kind === "function").map((suggestion) => suggestion.label),
    ["COALESCE"],
  );
});

test("identificadores só recebem quote quando necessário", () => {
  const quoted: Relation = { ...USERS, name: "select-table", columns: [{ ...USERS.columns[0]!, name: "order" }] };
  const meta = metaOf(postgresDescriptor);
  const quotedMeta: MetadataSource = {
    ...meta,
    listRelations: () => [quoted],
    resolveRelation: () => quoted,
  };
  const relationSql = "SELECT * FROM ";
  const relation = autocompleteTier1(relationSql, relationSql.length, quotedMeta).find((suggestion) => suggestion.label === "select-table");
  assert.equal(relation?.insertText, '"select-table"');
  const columnSql = 'SELECT  FROM "select-table"';
  const column = autocompleteTier1(columnSql, "SELECT ".length, quotedMeta).find((suggestion) => suggestion.label === "order");
  assert.equal(column?.insertText, '"order"');
  assert.equal(autocompleteTier1("SELECT  FROM users", 7, meta).find((suggestion) => suggestion.label === "id")?.insertText, undefined);
});

test("metadados Oracle mixed-case recebem quote", () => {
  const mixed: Relation = {
    ...USERS,
    name: "CamelTable",
    columns: [{ ...USERS.columns[0]!, name: "MixedColumn" }],
  };
  const base = metaOf(oracleDescriptor);
  const meta: MetadataSource = {
    ...base,
    listRelations: () => [mixed],
    resolveRelation: (ref) => ref.table === mixed.name ? mixed : null,
  };
  const fromSql = "SELECT * FROM ";
  assert.equal(autocompleteTier1(fromSql, fromSql.length, meta).find((suggestion) => suggestion.label === "CamelTable")?.insertText, '"CamelTable"');
  const selectSql = "SELECT  FROM CamelTable";
  assert.equal(autocompleteTier1(selectSql, "SELECT ".length, meta).find((suggestion) => suggestion.label === "MixedColumn")?.insertText, '"MixedColumn"');
});

test("metadados Oracle lowercase recebem quote, aliases não quoted não recebem folding", () => {
  const base = metaOf(oracleDescriptor);
  const fromSql = "SELECT * FROM ";
  const relation = autocompleteTier1(fromSql, fromSql.length, base).find((suggestion) => suggestion.label === "users");
  assert.equal(relation?.insertText, '"users"');

  const sql = "SELECT  FROM users x JOIN orders y ON x.id = y.id";
  const ids = autocompleteTier1(sql, "SELECT ".length, base).filter((suggestion) => suggestion.label === "id");
  assert.deepEqual(ids.map((suggestion) => suggestion.insertText), ['x."id"', 'y."id"']);
  assert.ok(ids.every((suggestion) => !suggestion.insertText?.startsWith('"x"') && !suggestion.insertText?.startsWith('"y"')));
});

test("ScopeRef preserva quotes de schema, tabela e alias", () => {
  const sql = 'SELECT * FROM "Sales"."Orders" "o"';
  const ctx = resolveContext(sql, sql.length, postgresDescriptor);
  assert.deepEqual(ctx.scope, [{
    schema: "Sales",
    table: "Orders",
    alias: "o",
    schemaQuoted: true,
    tableQuoted: true,
    aliasQuoted: true,
  }]);
});

test("expansão reconhece aliases AS e implícitos em colunas simples e qualificadas", () => {
  for (const sql of [
    "SELECT id AS user_id, name display_name,  FROM users",
    "SELECT u.id AS user_id, u.name display_name,  FROM users u",
  ]) {
    const out = autocompleteTier1(sql, sql.indexOf("FROM"), metaOf(postgresDescriptor));
    const allColumns = out.find((suggestion) => suggestion.kind === "all-columns");
    assert.equal(allColumns?.insertText, "email");
  }
});

test("alias quoted usa identifierText em Postgres e Oracle", () => {
  const sql = 'SELECT  FROM users "X" JOIN orders o ON true';
  const cases = [
    [postgresDescriptor, '"X".id', "o.id"],
    [{ ...postgresDescriptor, dialect: "oracle" as const }, '"X"."id"', 'o."id"'],
  ] as const;
  for (const [dialect, quotedAliasId, plainAliasId] of cases) {
    const ids = autocompleteTier1(sql, "SELECT ".length, metaOf(dialect)).filter((suggestion) => suggestion.label === "id");
    assert.ok(ids.some((suggestion) => suggestion.insertText === quotedAliasId));
    assert.ok(ids.some((suggestion) => suggestion.insertText === plainAliasId));
  }
});

test("caso 7: CTE WITH x AS (...) lista x no FROM externo", () => {
  const sql = "WITH x AS (SELECT id FROM users) SELECT id FROM x";
  const cursor = sql.length - "x".length; // logo após "FROM " externo
  const ctx = resolveContext(sql, cursor, postgresDescriptor);
  assert.deepEqual(ctx.scope, [{ schema: null, table: "x", alias: "x" }]);
});

test("caso 7b: colunas das tabelas internas do CTE não vazam pro escopo externo", () => {
  const meta = metaOf(postgresDescriptor);
  // O corpo do CTE referencia `users`/`orders` — essas NÃO podem aparecer
  // como sugestão no SELECT externo, só o próprio CTE (`x`, sem colunas
  // conhecidas aqui: o mock não resolve CTEs, isso é responsabilidade do
  // tier2/backend injetando uma Relation sintética em resolveRelation).
  const sql = "WITH x AS (SELECT id, total FROM orders JOIN users ON true) SELECT  FROM x";
  const cursor = sql.indexOf("SELECT  FROM x") + "SELECT ".length;
  const out = autocompleteTier1(sql, cursor, meta);
  const labels = out.map((s) => s.label);
  assert.ok(!labels.includes("total"), "coluna de `orders` (dentro do CTE) vazou pro escopo externo");
  assert.ok(!labels.includes("user_id"), "coluna de `users`/`orders` (dentro do CTE) vazou pro escopo externo");
  assert.ok(!labels.includes("email"), "coluna de `users` (dentro do CTE) vazou pro escopo externo");
});

test("CTE injetada pelo tier2 sugere colunas no SELECT externo e não usa insertText qualificado", () => {
  const meta = metaOf(postgresDescriptor);
  const cte: Relation = {
    schema: "",
    name: "cte",
    kind: "view",
    columns: [
      { name: "id", dataType: "integer", nullable: false, isPrimaryKey: false, ordinalPosition: 1 },
      { name: "nome", dataType: "text", nullable: true, isPrimaryKey: false, ordinalPosition: 2 },
    ],
    constraints: [],
  };
  const metaWithCte: MetadataSource = {
    ...meta,
    listRelations: () => [...meta.listRelations(), cte],
    resolveRelation: (ref: ScopeRef) => {
      if (ref.schema == null && ref.table.toLowerCase() === "cte") return cte;
      return meta.resolveRelation(ref);
    },
  };
  const sql = "WITH cte AS (SELECT id, nome FROM users) SELECT  FROM cte";
  const cursor = sql.indexOf("SELECT  FROM cte") + "SELECT ".length;
  const out = autocompleteTier1(sql, cursor, metaWithCte);
  const labels = out.map((s) => s.label);
  assert.ok(labels.includes("id"), "coluna id da CTE ausente");
  assert.ok(labels.includes("nome"), "coluna nome da CTE ausente");
  assert.ok(!labels.includes("email"), "coluna da tabela real vazou para CTE");
  const cteFrom = autocompleteTier1("WITH cte AS (SELECT id FROM users) SELECT * FROM ", 59, metaWithCte);
  const cteItem = cteFrom.find((s) => s.label === "cte");
  assert.ok(cteItem, "CTE não aparece na lista de relações do FROM");
  assert.equal(cteItem!.insertText, undefined, "CTE não deve ter insertText qualificado (schema vazio)");
});

test.todo("caso 8: subqueries correlacionadas herdam escopo externo");
