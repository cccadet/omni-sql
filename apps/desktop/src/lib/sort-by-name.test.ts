import { describe, expect, it } from "vitest";
import { sortByName } from "./sort-by-name";

describe("sortByName", () => {
  it("sorts case- and accent-insensitively with numeric ordering, without mutating the input", () => {
    const input = [{ label: "db10" }, { label: "Zeta" }, { label: "álvaro" }, { label: "db2" }, { label: "beta" }];
    const sorted = sortByName(input, (item) => item.label);
    expect(sorted.map((item) => item.label)).toEqual(["álvaro", "beta", "db2", "db10", "Zeta"]);
    expect(input[0]?.label).toBe("db10");
  });
});
