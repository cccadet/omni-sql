import { Dialect, generate, isSelect, parse } from "@polyglot-sql/sdk";
import { mongoSqlToNative } from "./mongo-sql.ts";
import { RpcValidationError } from "./rpc-errors.ts";

type Expression = Parameters<typeof isSelect>[0];
export interface MongoSqlSourcePlan {
  query: string;
  sql: string;
  fields: string[];
}

function visit(value: unknown, action: (node: Expression) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const child of value) visit(child, action); return; }
  action(value as Expression);
  for (const child of Object.values(value)) visit(child, action);
}

/** Only a single scan followed by a linear CTE chain can share a prefiltered snapshot. */
export function mongoSqlSourcePlan(sql: string, defaultDatabase?: string): MongoSqlSourcePlan | null {
  if (typeof sql !== "string" || !sql.trim() || sql.length > 100_000) return null;
  const parsed = parse(sql, Dialect.Generic);
  if (!parsed.success || parsed.ast?.length !== 1 || !parsed.ast[0] || !isSelect(parsed.ast[0])) return null;
  const root = parsed.ast[0];
  const ctes = root.select.with?.ctes ?? [];
  if (root.select.with?.recursive || ctes.some((cte) => !isSelect(cte.this) || cte.columns.length)) return null;
  const chain = [...ctes.map((cte) => cte.this), root];
  const selections: Expression[] = [];
  visit(root, (node) => { if (isSelect(node)) selections.push(node); });
  if (selections.length !== chain.length) return null; // Subqueries need their own scan and predicate scope.
  for (const [index, node] of chain.entries()) {
    if (!isSelect(node)) return null;
    const select = node.select;
    if (select.joins.length || select.lateral_views.length || select.into || select.locks.length || select.connect
      || (index < chain.length - 1 && select.with) || select.from?.expressions.length !== 1) return null;
    const source = select.from.expressions[0];
    if (!source || !("table" in source)) return null;
    const table = source.table;
    if (table.catalog || table.column_aliases.length || table.hints.length || table.when || table.only || table.final_) return null;
    if (index > 0 && (table.schema || table.name.name.toLowerCase() !== ctes[index - 1]?.alias.name.toLowerCase())) return null;
  }
  const base = chain[0]!;
  if (!isSelect(base)) return null;
  const source = base.select.from!.expressions[0]!;
  if (!("table" in source) || !base.select.where_clause || base.select.sample) return null;
  const alias = source.table.alias?.name ?? source.table.name.name;
  const outputAliases = new Set(base.select.expressions.flatMap((node) => "alias" in node ? [node.alias.alias.name.toLowerCase()] : []));
  let ambiguousAlias = false;
  visit({ ...base.select, expressions: [], from: null, with: null }, (node) => {
    if ("column" in node && (node.column.table ? node.column.table.name !== alias && outputAliases.has(node.column.table.name.toLowerCase())
      : outputAliases.has(node.column.name.name.toLowerCase()))) ambiguousAlias = true;
  });
  if (ambiguousAlias) return null; // SELECT aliases cannot be interpreted as Mongo field names.
  const template = parse('SELECT * FROM "__omni_mongo_source"', Dialect.Generic).ast![0]!;
  if (!isSelect(template)) return null;
  const replacement = template.select.from!.expressions[0]!;
  if (!("table" in replacement)) return null;
  const translate = (expression: Expression): Record<string, unknown> | null => {
    if ("paren" in expression) return translate(expression.paren.this);
    if (!("eq" in expression) && !("function" in expression && expression.function.name.toLowerCase() === "list_contains")
      && !("and" in expression) && !("or" in expression)) return null;
    if ("and" in expression || "or" in expression) {
      const kind = "and" in expression ? "and" : "or";
      const operands = Reflect.get(expression, kind) as { left: Expression; right: Expression };
      const left = translate(operands.left), right = translate(operands.right);
      return left && right ? { [`$${kind}`]: [left, right] } : null;
    }
    try {
      const generated = generate([{ select: { ...template.select, from: base.select.from, where_clause: { this: expression } } }], Dialect.Generic);
      if (!generated.success || !generated.sql?.[0]) return null;
      const query = JSON.parse(mongoSqlToNative(generated.sql[0], defaultDatabase, true)) as { filter: Record<string, unknown> };
      // Only literal equality and array membership are moved. Other SQL predicates stay in DuckDB.
      return Object.keys(query.filter).some((key) => key !== "$expr") ? query.filter : null;
    } catch (error) {
      if (error instanceof RpcValidationError) return null;
      throw error;
    }
  };
  const filters: Record<string, unknown>[] = [];
  const remaining = (expression: Expression): Expression | null => {
    const filter = translate(expression);
    if (filter) { filters.push(filter); return null; }
    if ("paren" in expression) {
      const child = remaining(expression.paren.this);
      return child ? { paren: { ...expression.paren, this: child } } : null;
    }
    if ("and" in expression) {
      const left = remaining(expression.and.left), right = remaining(expression.and.right);
      return left && right ? { and: { ...expression.and, left, right } } : left ?? right;
    }
    return expression;
  };
  const predicate = remaining(base.select.where_clause.this);
  if (!filters.length) return null;
  base.select.where_clause = predicate ? { this: predicate } : null;
  const fields = new Set<string>();
  let star = false;
  // Only inspect the base SELECT: downstream names refer to CTE outputs, not Mongo fields.
  visit({ ...base.select, from: null, with: null }, (node) => {
    if ("star" in node) star = true;
    if ("column" in node) fields.add(node.column.table && node.column.table.name !== alias
      ? node.column.table.name : node.column.name.name);
  });
  const database = source.table.schema?.name ?? defaultDatabase;
  if (!database || !fields.size && !star) return null;
  const projection = star ? undefined : Object.fromEntries([...fields].map((field) => [field, 1]));
  if (projection && !fields.has("_id")) projection._id = 0;
  const query = JSON.stringify({ database, collection: source.table.name.name, operation: "find",
    filter: filters.length === 1 ? filters[0] : { $and: filters }, ...(projection ? { projection } : {}) });
  source.table = { ...replacement.table,
    alias: source.table.alias ?? source.table.name, alias_explicit_as: true };
  const rewritten = generate([root], Dialect.DuckDB);
  return rewritten.success && rewritten.sql?.[0] ? { query, sql: rewritten.sql[0], fields: [...fields] } : null;
}
