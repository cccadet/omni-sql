import { Dialect, isSelect, parse } from "@polyglot-sql/sdk";
import { RpcValidationError } from "./rpc-errors.ts";

type Expression = Parameters<typeof isSelect>[0];
type Document = Record<string, unknown>;
function fail(reason: string): never { throw new RpcValidationError(`SQL → MongoDB: ${reason}`); }
const aggregateKinds = ["count", "sum", "avg", "min", "max"] as const;

function identifier(name: string): string {
  if (!name || name.split(".").some((part) => !part || part.startsWith("$")) || name.includes("\0")) fail("nome de campo não suportado");
  return name;
}

function literal(expression: Expression): string | number | boolean | null {
  if ("null" in expression) return null;
  if ("boolean" in expression) return expression.boolean.value;
  if ("neg" in expression) {
    const value = literal(expression.neg.this);
    if (typeof value !== "number") fail("literal negativo deve ser numérico");
    return -value;
  }
  if ("literal" in expression) {
    if (expression.literal.literal_type === "string") return expression.literal.value;
    if (expression.literal.literal_type === "number") {
      const number = Number(expression.literal.value);
      if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) fail("literal numérico fora da precisão suportada");
      return number;
    }
  }
  return fail("use literais de texto, número, booleano ou NULL");
}

/** Convert a bounded SELECT subset using the installed SQL parser; never execute SQL. */
export function mongoSqlToNative(sql: string, defaultDatabase?: string, mongoMatch = false): string {
  if (typeof sql !== "string" || !sql.trim() || sql.length > 100_000) fail("informe um SELECT de até 100 KB");
  const result = parse(sql, Dialect.Generic);
  const ast: Expression[] | undefined = result.ast;
  if (!result.success || !Array.isArray(ast) || ast.length !== 1 || !ast[0] || !isSelect(ast[0])) fail("informe um único SELECT válido");
  const select = ast[0].select;
  const allowed = new Set(["expressions", "from", "where_clause", "group_by", "having", "order_by", "limit", "leading_comments", "post_select_comments"]);
  for (const [key, value] of Object.entries(select)) {
    if (!allowed.has(key) && value !== null && value !== undefined && value !== false && !(Array.isArray(value) && value.length === 0)) fail(`cláusula ${key} não suportada`);
  }
  const sources = select.from?.expressions;
  if (sources?.length !== 1 || !sources[0] || !("table" in sources[0])) fail("FROM deve conter uma única coleção, sem joins ou subconsultas");
  const table = sources[0].table;
  if (table.catalog || table.when || table.only || table.final_ || table.column_aliases.length || table.hints.length) fail("origem de dados não suportada");
  const database = table.schema?.name ?? defaultDatabase;
  if (!database) fail("informe o banco em FROM banco.colecao ou na conexão");
  const target = { database, collection: table.name.name };
  const column = (expression: Expression): string => {
    if (!("column" in expression) || expression.column.join_mark) return fail("somente referências a campos são suportadas neste contexto");
    const qualifier = expression.column.table?.name;
    if (qualifier && qualifier !== (table.alias?.name ?? table.name.name)) fail("qualificador de campo diferente da coleção");
    return identifier(expression.column.name.name);
  };
  const aggregate = (expression: Expression) => {
    for (const kind of aggregateKinds) {
      if (!(kind in expression)) continue;
      // The parser's variants share these aggregate options.
      const value = Reflect.get(expression, kind) as { this: Expression | null; distinct: boolean; filter: Expression | null; star?: boolean; order_by?: unknown[] };
      if (value.distinct || value.filter || value.order_by?.length) fail("DISTINCT, FILTER e ORDER BY dentro de agregações não são suportados");
      const field = kind === "count" && value.star ? null : value.this ? column(value.this) : fail("agregação requer um campo");
      return { kind, field, signature: `${kind}:${field ?? "*"}` };
    }
    return null;
  };
  const outputs = select.expressions.map((expression) => {
    const aliased = "alias" in expression;
    if (aliased && expression.alias.column_aliases.length) fail("alias de múltiplas colunas não suportado");
    const source = aliased ? expression.alias.this : expression;
    const agg = aggregate(source);
    const name = aliased ? identifier(expression.alias.alias.name) : "column" in source ? column(source) : agg ? `${agg.kind.toUpperCase()}(${agg.field ?? "*"})` : "*";
    if (name.includes(".") && aliased) fail("alias de saída não pode conter ponto");
    return { source, agg, name };
  });
  if (!outputs.length || new Set(outputs.map((o) => o.name)).size !== outputs.length) fail("campos de saída vazios ou duplicados");
  const star = outputs.length === 1 && outputs[0] && "star" in outputs[0].source;
  if (star) {
    if (outputs[0]!.name !== "*") fail("SELECT * não aceita alias de saída");
    const options = outputs[0]!.source;
    if ("star" in options && (options.star.except || options.star.replace || options.star.rename || (options.star.table && options.star.table.name !== (table.alias?.name ?? table.name.name)))) fail("SELECT * com modificadores não é suportado");
  } else if (outputs.some((o) => "star" in o.source || (!o.agg && !("column" in o.source)))) fail("selecione campos ou agregações COUNT/SUM/AVG/MIN/MAX");
  const groups = select.group_by?.expressions.map(column) ?? [];
  if ((select.group_by?.all !== null && select.group_by?.all !== undefined) || select.group_by?.totals) fail("GROUP BY ALL/TOTALS não é suportado");
  const grouped = groups.length > 0 || outputs.some((o) => o.agg) || Boolean(select.having);
  if (grouped && star) fail("SELECT * não pode ser usado com agregações");
  const pipeline: Document[] = [];
  const group: Document = { _id: groups.length ? Object.fromEntries(groups.map((field, i) => [`g${i}`, { $ifNull: [`$${field}`, null] }])) : null };
  const aggregates = new Map<string, { reference: unknown; defaults: Document }>();
  const nonNull = (value: unknown) => ({ $ne: [{ $ifNull: [value, null] }, null] });
  const groupValue = (expression: Expression): unknown => {
    const agg = aggregate(expression);
    if (agg) {
      let entry = aggregates.get(agg.signature);
      if (!entry) {
        const slot = `a${aggregates.size}`;
        const ref = agg.field === null ? null : `$${agg.field}`;
        const defaults: Document = { [slot]: agg.kind === "count" ? 0 : null };
        let reference: unknown = `$${slot}`;
        if (agg.kind === "count") group[slot] = { $sum: ref === null ? 1 : { $cond: [nonNull(ref), 1, 0] } };
        else {
          group[slot] = { [`$${agg.kind}`]: { $ifNull: [ref, null] } };
          if (agg.kind === "sum") {
            group[`${slot}n`] = { $sum: { $cond: [nonNull(ref), 1, 0] } };
            defaults[`${slot}n`] = 0;
            reference = { $cond: [{ $gt: [`$${slot}n`, 0] }, `$${slot}`, null] };
          }
        }
        entry = { reference, defaults }; aggregates.set(agg.signature, entry);
      }
      return entry.reference;
    }
    const field = column(expression);
    const index = groups.indexOf(field);
    if (index < 0) fail(`campo ${field} deve estar no GROUP BY`);
    return `$_id.g${index}`;
  };
  const value = (expression: Expression, afterGroup: boolean): unknown => {
    if ("column" in expression || aggregateKinds.some((k) => k in expression)) {
      if (afterGroup) {
        if ("column" in expression && !expression.column.table) {
          const output = outputs.find((o) => o.name === expression.column.name.name);
          if (output) return groupValue(output.source);
        }
        return groupValue(expression);
      }
      return `$${column(expression)}`;
    }
    return { $literal: literal(expression) };
  };
  const predicate = (expression: Expression, afterGroup = false, negated = false): unknown => {
    if ("paren" in expression) return predicate(expression.paren.this, afterGroup, negated);
    if ("not" in expression) return predicate(expression.not.this, afterGroup, !negated);
    for (const kind of ["and", "or"] as const) {
      if (kind in expression) {
        const operands = Reflect.get(expression, kind) as { left: Expression; right: Expression };
        return { [negated ? kind === "and" ? "$or" : "$and" : `$${kind}`]: [predicate(operands.left, afterGroup, negated), predicate(operands.right, afterGroup, negated)] };
      }
    }
    if ("is_null" in expression) {
      return { [(expression.is_null.not !== negated) ? "$ne" : "$eq"]: [{ $ifNull: [value(expression.is_null.this, afterGroup), null] }, null] };
    }
    if ("in" in expression) {
      const node = expression.in;
      if (node.query || node.unnest || node.global || !node.expressions.length) fail("IN requer uma lista de literais");
      const list = node.expressions.map(literal);
      const invert = node.not !== negated;
      if (invert && list.includes(null)) return false;
      const ref = value(node.this, afterGroup);
      const membership = { $in: [ref, { $literal: list.filter((item) => item !== null) }] };
      return { $and: [nonNull(ref), invert ? { $not: [membership] } : membership] };
    }
    const inverses: Record<string, string> = { eq: "ne", neq: "eq", gt: "lte", gte: "lt", lt: "gte", lte: "gt" };
    for (const [kind, inverse] of Object.entries(inverses)) {
      if (!(kind in expression)) continue;
      const node = Reflect.get(expression, kind) as { left: Expression; right: Expression };
      const left = value(node.left, afterGroup); const right = value(node.right, afterGroup);
      return { $and: [nonNull(left), nonNull(right), { [`$${negated ? inverse : kind === "neq" ? "ne" : kind}`]: [left, right] }] };
    }
    return fail("predicado não suportado; use comparações, AND/OR/NOT, IN ou IS NULL");
  };
  // Mongo SQL equality follows MongoDB array membership semantics and remains indexable.
  const match = (expression: Expression): Document => {
    if ("paren" in expression) return match(expression.paren.this);
    for (const kind of ["and", "or"] as const) {
      if (kind in expression) {
        const node = Reflect.get(expression, kind) as { left: Expression; right: Expression };
        return { [`$${kind}`]: [match(node.left), match(node.right)] };
      }
    }
    if ("eq" in expression) {
      const { left, right } = expression.eq;
      const field = "column" in left ? left : "column" in right ? right : null;
      const constant = field === left ? right : left;
      if (field && !("column" in constant)) {
        const item = literal(constant);
        if (item !== null) return { [column(field)]: { $eq: item } };
      }
    }
    if ("function" in expression && expression.function.name.toLowerCase() === "list_contains") {
      const node = expression.function;
      if (node.args.length !== 2 || node.distinct) fail("list_contains requer um campo e um literal");
      const field = column(node.args[0]!);
      const item = literal(node.args[1]!);
      if (item === null) return { $expr: false };
      return { [field]: { $elemMatch: { $eq: item } } };
    }
    return { $expr: predicate(expression) };
  };
  const filter = select.where_clause ? mongoMatch ? match(select.where_clause.this) : { $expr: predicate(select.where_clause.this) } : {};
  if (select.where_clause) pipeline.push({ $match: filter });
  const projection: Document = Object.assign(Object.create(null) as Document, { _id: 0 });
  if (!star) for (const output of outputs) {
    projection[output.name] = grouped ? groupValue(output.source) : { $ifNull: [`$${column(output.source)}`, null] };
  }
  const having = select.having ? { $expr: predicate(select.having.this, true) } : null;
  const sort: Document = Object.create(null) as Document;
  const sortStages: Document[] = [];
  for (const [i, ordered] of (select.order_by?.expressions ?? []).entries()) {
    if (ordered.nulls_first !== null && ordered.nulls_first !== undefined) fail("NULLS FIRST/LAST explícito não é suportado");
    let expression = ordered.this;
    if ("column" in expression && !expression.column.table) {
      const name = expression.column.name.name;
      expression = outputs.find((o) => o.name === name)?.source ?? expression;
    }
    if (grouped) {
      const slot = `s${i}`;
      sortStages.push({ $set: { [slot]: groupValue(expression) } }); sort[slot] = ordered.desc ? -1 : 1;
    } else sort[column(expression)] = ordered.desc ? -1 : 1;
  }
  if (grouped) {
    // A global SQL aggregate returns one row even when the input is empty.
    if (groups.length) pipeline.push({ $group: group });
    else {
      const defaults = Object.assign({ _id: null }, ...[...aggregates.values()].map((a) => a.defaults));
      pipeline.push({ $facet: { rows: [{ $group: group }] } }, { $replaceRoot: { newRoot: { $ifNull: [{ $arrayElemAt: ["$rows", 0] }, { $literal: defaults }] } } });
    }
    if (having) pipeline.push({ $match: having });
  }
  pipeline.push(...sortStages);
  if (Object.keys(sort).length) pipeline.push({ $sort: sort });
  let limit: number | undefined;
  if (select.limit) {
    const number = literal(select.limit.this);
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) fail("LIMIT deve ser um inteiro não negativo");
    limit = number;
    pipeline.push(number === 0 ? { $match: { $expr: false } } : { $limit: number });
  }
  if (!star) pipeline.push({ $project: projection });
  const plain = !grouped && limit === undefined && outputs.every((o) => "column" in o.source && o.name === column(o.source));
  if (plain || (star && !grouped && limit === undefined)) {
    const fields = star ? undefined : Object.fromEntries(outputs.map((o) => [o.name, 1]));
    // Preserve an explicitly selected _id instead of mixing inclusion/exclusion.
    if (fields && !Object.hasOwn(fields, "_id")) fields._id = 0;
    return JSON.stringify({ ...target, operation: "find", filter, ...(fields ? { projection: fields } : {}), ...(Object.keys(sort).length ? { sort } : {}) }, null, 2);
  }
  return JSON.stringify({ ...target, operation: "aggregate", pipeline }, null, 2);
}
