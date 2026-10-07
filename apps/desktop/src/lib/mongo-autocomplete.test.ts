import { describe, expect, it } from "vitest";
import { initialMongoQuery, mongoCompletionContext, mongoSuggestions } from "./mongo-autocomplete";

const relations = [{ schema: "base_laudos", name: "padronizacao", kind: "table" as const, columns: [{ name: "id_guia", dataType: "JSON", nullable: true, isPrimaryKey: false }] }];
const complete = (text: string) => mongoSuggestions(text, text.length, relations).map((s) => s.label);

describe("native MongoDB completion", () => {
  it("suggests operations, databases, collections and fields while JSON is incomplete", () => {
    expect(complete('{"operation":"agg')).toEqual(["aggregate"]);
    expect(complete('{"database":"base')).toEqual(["base_laudos"]);
    expect(complete('{"database":"base_laudos","collection":"pad')).toEqual(["padronizacao"]);
    expect(complete('{"database":"other","collection":"pad')).toEqual([]);
    expect(complete('{"database":"base_laudos","collection":"padronizacao","filter":{"id')).toEqual(["id_guia"]);
    expect(complete('{"filter":{"id_guia":{"$g')).toEqual(["$gt", "$gte"]);
    expect(complete('{"filter":{"id_guia":"value')).toEqual([]);
  });
  it("completes stages, match fields and aggregation field references", () => {
    const query = '{"database":"base_laudos","collection":"padronizacao","operation":"aggregate","pipeline":[';
    expect(complete(query + '{"$ma')).toEqual(["$match"]);
    expect(complete(query + '{"$match":{"id')).toEqual(["id_guia"]);
    expect(complete(query + '{"$group":{"_id":"$id')).toEqual(["$id_guia"]);
    expect(complete(query + '{"$match":{}},{"$so')).toEqual(["$sort"]);
    expect(complete(query + '{"$ou')).toEqual([]);
  });
  it("keeps dotted collection names and separates database in the initial query", () => {
    expect(JSON.parse(initialMongoQuery("mongodb://localhost/base_laudos"))).toEqual({ database: "base_laudos", collection: "collection", operation: "find", filter: {} });
    expect(JSON.parse(initialMongoQuery("mongodb://localhost", relations)).collection).toBe("padronizacao");
    expect(mongoCompletionContext('{"operation":"ag', 16)?.start).toBe(14);
  });
});
