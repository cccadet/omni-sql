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
});
