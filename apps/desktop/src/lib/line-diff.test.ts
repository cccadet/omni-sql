// @vitest-environment node
import { expect, it } from "vitest";
import { diffLines } from "./line-diff";

it("marks changed and appended lines while keeping shared context", () => {
  const diff = diffLines(
    "SELECT c.name\nFROM orders o\nWHERE o.created_at >= now() - interval '30 days'\nGROUP BY c.name;",
    "SELECT c.name\nFROM orders o\nWHERE o.created_at >= now() - interval '90 days'\n  AND o.status <> 'cancelled'\nGROUP BY c.name;",
  );
  expect(diff.filter((line) => line.kind === "removed").map((line) => line.text)).toEqual(["WHERE o.created_at >= now() - interval '30 days'"]);
  expect(diff.filter((line) => line.kind === "added").map((line) => line.text)).toEqual(["WHERE o.created_at >= now() - interval '90 days'", "  AND o.status <> 'cancelled'"]);
  expect(diff.filter((line) => line.kind === "same")).toHaveLength(3);
});

it("treats CRLF and LF input the same", () => {
  expect(diffLines("a\r\nb", "a\nb").every((line) => line.kind === "same")).toBe(true);
});
