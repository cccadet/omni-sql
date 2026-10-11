// @vitest-environment node
import { describe, expect, it } from "vitest";
import { s3ReferencedRelations, s3Suggestions } from "./s3-autocomplete";

const relations = [{ schema: "omni-test", name: "delta__orders", kind: "table" as const,
  columns: [{ name: "amount", dataType: "INTEGER", nullable: true, isPrimaryKey: false }] }];

describe("S3 autocomplete", () => {
  it("suggests tables in a quoted bucket schema", () => {
    const sql = 'SELECT * FROM "omni-test".';
    expect(s3Suggestions(sql, sql.length, relations).some((item) => item.label === "delta__orders")).toBe(true);
  });

  it("finds the referenced table and suggests its columns", () => {
    const sql = 'SELECT  FROM "omni-test"."delta__orders"';
    expect(s3ReferencedRelations(sql, relations)).toEqual(relations);
    expect(s3Suggestions(sql, 7, relations).some((item) => item.label === "amount")).toBe(true);
  });

  it("suggests document/list and aggregate functions in SQL expressions", () => {
    for (const [prefix, name] of [["unn", "unnest"], ["list_c", "list_contains"], ["json_ext", "json_extract"], ["coa", "coalesce"], ["cou", "count"]]) {
      const sql = `SELECT ${prefix}`;
      expect(s3Suggestions(sql, sql.length, relations).some((item) => item.label === name && item.kind === "function")).toBe(true);
    }
  });

  it("completes nested document fields, including quoted names and table aliases", () => {
    const nested = [{ ...relations[0]!, columns: [{ name: "profile", dataType: "JSON", nullable: true, isPrimaryKey: false,
      fields: [{ name: "city name", dataType: "VARCHAR", nullable: true, isPrimaryKey: false }] }] }];
    for (const expression of ["profile.", "p.profile.", 'p."profile".ci']) {
      const sql = `SELECT ${expression} FROM "omni-test"."delta__orders" p`;
      const items = s3Suggestions(sql, sql.indexOf(" FROM"), nested);
      expect(items.find((item) => item.label === "city name")?.insertText).toBe('"city name"');
    }
    const sql = 'SELECT other.profile. FROM "omni-test"."delta__orders" p';
    expect(s3Suggestions(sql, sql.indexOf(" FROM"), nested)).toEqual([]);
  });
});
