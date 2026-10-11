import type { Suggestion } from "@omni-sql/autocomplete-engine";
import type { RelationColumn, RelationInfo } from "./backend";

const operations = ["find", "aggregate", "insertOne", "updateOne", "updateMany", "deleteOne", "deleteMany"];
const stages = ["$match", "$project", "$sort", "$group", "$limit", "$skip", "$unwind", "$lookup", "$addFields", "$set", "$unset", "$count", "$facet", "$replaceRoot"];
const operators = ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$exists", "$regex", "$and", "$or", "$not", "$nor", "$elemMatch"];
const expressions = ["$sum", "$avg", "$min", "$max", "$first", "$last", "$push", "$addToSet", "$cond", "$ifNull", "$concat", "$add", "$subtract", "$multiply", "$divide"];
const updates = ["$set", "$unset", "$inc", "$mul", "$min", "$max", "$push", "$pull", "$pop", "$addToSet", "$rename", "$setOnInsert", "$currentDate"];

function fieldNames(columns: readonly RelationColumn[], prefix = ""): string[] {
  return columns.flatMap((column) => {
    const name = `${prefix}${column.name}`;
    return [name, ...fieldNames(column.fields ?? [], `${name}.`)];
  });
}

// Scan incomplete JSON rather than requiring a valid document while typing.
export function mongoCompletionContext(text: string, cursor: number) {
  const stack: { key: string; array: boolean; values: Record<string, string> }[] = [];
  const root: Record<string, string> = {};
  let key = "";
  let expectKey = false;
  const tokens = /"((?:\\.|[^"\\])*)("|$)|[{}[\]:,]/g;
  const prefix = text.slice(0, cursor);
  for (const token of prefix.matchAll(tokens)) {
    const value = token[0];
    if (value.startsWith('"')) {
      if (!token[2]) return { stack, root, key, expectKey, start: token.index + 1, partial: token[1] ?? "" };
      let decoded: string;
      try { decoded = JSON.parse(value) as string; } catch { return null; }
      if (expectKey) key = decoded;
      else if (stack.length === 1) root[key] = decoded;
      else if (stack.length) stack.at(-1)!.values[key] = decoded;
    } else if (value === "{" || value === "[") {
      stack.push({ key, array: value === "[", values: {} }); key = ""; expectKey = value === "{";
    } else if (value === "}" || value === "]") {
      key = stack.pop()?.key ?? ""; expectKey = false;
    } else if (value === ":") expectKey = false;
    else if (value === ",") { key = ""; expectKey = !stack.at(-1)?.array; }
  }
  return null;
}

export function mongoSuggestions(text: string, cursor: number, relations: readonly RelationInfo[]): Suggestion[] {
  const context = mongoCompletionContext(text, cursor);
  if (!context) return [];
  const { stack, root, key, expectKey, partial } = context;
  try {
    const query: unknown = JSON.parse(text);
    if (query && typeof query === "object") {
      for (const field of ["database", "collection"]) {
        const value: unknown = Reflect.get(query, field);
        if (typeof value === "string" && root[field] === undefined) root[field] = value;
      }
    }
  } catch { /* Incomplete JSON uses the values already scanned. */ }
  const relation = relations.find((r) => r.name === root.collection && (!root.database || r.schema === root.database));
  let fields = fieldNames(relation?.columns ?? []);
  const parent = stack.at(-1)?.key;
  const lookup = [...stack].reverse().find((frame) => frame.key === "$lookup");
  const foreignRelation = relations.find((r) => r.name === lookup?.values.from && (!root.database || r.schema === root.database));
  const foreignFields = fieldNames(foreignRelation?.columns ?? []);
  const foreignPipeline = lookup && stack.slice(stack.indexOf(lookup) + 1).some((frame) => frame.key === "pipeline");
  if (foreignPipeline) fields = foreignFields;
  const filterIndex = stack.findIndex((frame) => frame.key === "filter" || frame.key === "$match");
  let nestedColumns: readonly RelationColumn[] = (foreignPipeline ? foreignRelation : relation)?.columns ?? [];
  for (const frame of stack.slice(filterIndex < 0 ? stack.length : filterIndex + 1)) {
    if (frame.key && !frame.key.startsWith("$")) nestedColumns = nestedColumns.find((column) => column.name === frame.key)?.fields ?? [];
  }
  let names: string[] = [];
  if (stack.length === 1) {
    names = expectKey ? ["database", "collection", "operation", "filter", "projection", "sort", "pipeline", "document", "update"]
      : key === "database" ? [...new Set(relations.map((r) => r.schema))]
      : key === "collection" ? relations.filter((r) => !root.database || r.schema === root.database).map((r) => r.name)
      : key === "operation" ? operations : [];
  } else if (expectKey) {
    if (stack.at(-2)?.key === "pipeline" && stack.at(-2)?.array) names = stages;
    else if (parent === "$lookup") names = ["from", "localField", "foreignField", "as", "let", "pipeline"];
    else if (parent === "$unwind") names = ["path", "includeArrayIndex", "preserveNullAndEmptyArrays"];
    else if (parent === "$replaceRoot") names = ["newRoot"];
    else if (parent === "$facet" || parent === "let") names = [];
    else if (["filter", "$match", "$and", "$or", "$nor", "$elemMatch"].includes(parent || stack.at(-2)?.key || "")) names = [...(parent === "$elemMatch" ? fieldNames(nestedColumns) : fields), ...operators];
    else if (["projection", "sort", "$project", "$sort", "$set", "$addFields", "document"].includes(parent ?? "") || (stack.some((s) => s.key === "update") && updates.includes(parent ?? ""))) names = fields;
    else if (parent === "$group") names = ["_id", ...fields];
    else if (parent === "update") names = updates;
    else if (filterIndex >= 0 && nestedColumns.length) names = fieldNames(nestedColumns);
    else names = stack.some((s) => s.key === "pipeline") ? expressions : operators;
  } else if (parent === "$lookup") {
    if (key === "from") names = relations.filter((r) => !root.database || r.schema === root.database).map((r) => r.name);
    else if (key === "localField") names = fields;
    else if (key === "foreignField") names = foreignFields;
  } else if ((key === "$unset" || parent === "$unset") && stack.some((s) => s.key === "pipeline")) names = fields;
  else if (stack.some((s) => s.key === "pipeline") && partial.startsWith("$")) names = fields.map((f) => `$${f}`);
  return [...new Set(names)].filter((name) => name.toLowerCase().startsWith(partial.toLowerCase())).map((name) => ({
    label: name, insertText: JSON.stringify(name).slice(1, -1), kind: "keyword", relevance: 100,
  }));
}

export function initialMongoQuery(endpoint: string, relations: readonly RelationInfo[] = []): string {
  let database = "";
  try { database = decodeURIComponent(new URL(endpoint).pathname.slice(1)); } catch { /* Use metadata or an explicit placeholder. */ }
  database ||= relations[0]?.schema ?? "database";
  return JSON.stringify({ database, collection: relations.find((r) => r.schema === database)?.name ?? "collection", operation: "find", filter: {} }, null, 2);
}
