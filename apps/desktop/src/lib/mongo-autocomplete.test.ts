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

  it("only suggests fields in sort and projection keys, and expressions inside group outputs", () => {
    const query = '{"collection":"padronizacao","pipeline":[';
    expect(complete(query + '{"$sort":{"$')).toEqual([]);
    expect(complete(query + '{"$sort":{"id')).toEqual(["id_guia"]);
    expect(complete(query + '{"$project":{"$')).toEqual([]);
    expect(complete(query + '{"$group":{"total":{"$su')).toEqual(["$sum", "$subtract"]);
  });

  it("completes lookup properties, source collections and local/foreign fields", () => {
    const all = [...relations, { schema: "base_laudos", name: "guides", kind: "table" as const,
      columns: [{ name: "code", dataType: "VARCHAR", nullable: false, isPrimaryKey: false }] }];
    const query = '{"database":"base_laudos","collection":"padronizacao","pipeline":[{"$lookup":{';
    const labels = (suffix: string) => mongoSuggestions(query + suffix, query.length + suffix.length, all).map((s) => s.label);
    expect(labels('"fr')).toEqual(["from"]);
    expect(labels('"from":"gu')).toEqual(["guides"]);
    expect(labels('"from":"guides","localField":"id')).toEqual(["id_guia"]);
    expect(labels('"from":"guides","foreignField":"co')).toEqual(["code"]);
    expect(labels('"from":"guides","pipeline":[{"$match":{"co')).toEqual(["code"]);
    expect(labels('"as":"id')).toEqual([]);
  });

  it("completes fields for every offered update operator without aggregation expressions", () => {
    for (const operator of ["$push", "$pull", "$addToSet", "$inc", "$unset", "$rename", "$set", "$setOnInsert", "$currentDate"]) {
      expect(complete(`{"collection":"padronizacao","update":{"${operator}":{"id`)).toEqual(["id_guia"]);
      expect(complete(`{"collection":"padronizacao","update":{"${operator}":{"$`)).toEqual([]);
    }
  });

  it("suggests sampled document and array element paths", () => {
    const all = [{ ...relations[0]!, columns: [{ name: "profile", dataType: "JSON", nullable: true, isPrimaryKey: false,
      fields: [{ name: "city", dataType: "VARCHAR", nullable: true, isPrimaryKey: false }] }] }];
    for (const suffix of ['"filter":{"profile.c', '"projection":{"profile.c', '"pipeline":[{"$group":{"_id":"$profile.c']) {
      const text = '{"collection":"padronizacao",' + suffix;
      expect(mongoSuggestions(text, text.length, all).map((s) => s.label)).toEqual([suffix.includes('"$profile') ? "$profile.city" : "profile.city"]);
    }
    const text = '{"collection":"padronizacao","filter":{"profile":{"ci';
    expect(mongoSuggestions(text, text.length, all).map((s) => s.label)).toEqual(["city"]);
    const element = '{"collection":"padronizacao","filter":{"profile":{"$elemMatch":{"ci';
    expect(mongoSuggestions(element, element.length, all).map((s) => s.label)).toEqual(["city"]);
  });
});
