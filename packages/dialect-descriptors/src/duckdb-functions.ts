import type { FunctionDef } from "@omni-sql/ts-types";

/** Built-ins useful when querying imported documents and lists. */
export const duckdbFunctions: readonly FunctionDef[] = [
  ["unnest", "ANY"], ["list_contains", "BOOLEAN"], ["list_extract", "ANY"],
  ["len", "BIGINT"], ["array_length", "BIGINT"], ["struct_extract", "ANY"],
  ["json_extract", "JSON"], ["json_extract_string", "VARCHAR"],
  ["count", "BIGINT"], ["sum", "NUMERIC"], ["avg", "DOUBLE"], ["min", "ANY"], ["max", "ANY"],
  ["coalesce", "ANY"], ["nullif", "ANY"], ["length", "BIGINT"], ["lower", "VARCHAR"],
  ["upper", "VARCHAR"], ["concat", "VARCHAR"], ["date_trunc", "TIMESTAMP"],
].map(([name, returnType]) => ({ name: name!, schema: "", overloads: [{ parameters: [], returnType: returnType! }] }));
