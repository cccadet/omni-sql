// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENTS, parseEnvironments } from "./environments";

describe("parseEnvironments", () => {
  it("falls back to the built-in environments when nothing valid is stored", () => {
    for (const raw of [null, "not json", "{}", "42"]) expect(parseEnvironments(raw)).toEqual(DEFAULT_ENVIRONMENTS);
  });

  it("keeps valid entries and drops duplicates, unknown colors and unnamed custom environments", () => {
    const stored = JSON.stringify([
      { id: "production", color: "red" },
      { id: "env-qa", name: "  QA  ", color: "teal" },
      { id: "env-qa", name: "Duplicate", color: "blue" },
      { id: "env-bad", name: "Bad", color: "neon" },
      { id: "env-empty", name: " ", color: "gray" },
      "garbage",
    ]);
    expect(parseEnvironments(stored)).toEqual([
      { id: "production", color: "red" },
      { id: "env-qa", name: "QA", color: "teal" },
    ]);
  });

  it("keeps an emptied list instead of restoring the defaults", () => {
    expect(parseEnvironments("[]")).toEqual([]);
  });
});
