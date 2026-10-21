import { beforeEach, expect, test } from "vitest";
import { formatUsageAge, loadConnectionUsage, recentConnectionIds, recordConnectionUse } from "./recent-connections";

beforeEach(() => localStorage.clear());

test("keeps the most recently used existing connections first", () => {
  let usage = recordConnectionUse({}, "a", 1_000);
  usage = recordConnectionUse(usage, "b", 3_000);
  usage = recordConnectionUse(usage, "gone", 4_000);
  usage = recordConnectionUse(usage, "a", 5_000);
  expect(recentConnectionIds(usage, ["a", "b", "c"])).toEqual(["a", "b"]);
  expect(loadConnectionUsage()).toEqual({ a: 5_000, b: 3_000, gone: 4_000 });
});

test("ignores malformed stored usage", () => {
  localStorage.setItem("omni-sql:connectionLastUsed", JSON.stringify({ a: "yesterday", b: 7 }));
  expect(loadConnectionUsage()).toEqual({ b: 7 });
  localStorage.setItem("omni-sql:connectionLastUsed", "not json");
  expect(loadConnectionUsage()).toEqual({});
});

test("formats usage age compactly", () => {
  const now = 100 * 86_400_000;
  expect(formatUsageAge(undefined, now)).toBeNull();
  expect(formatUsageAge(now - 10_000, now)).toBe("now");
  expect(formatUsageAge(now - 5 * 60_000, now)).toBe("5m");
  expect(formatUsageAge(now - 3 * 3_600_000, now)).toBe("3h");
  expect(formatUsageAge(now - 2 * 86_400_000, now)).toBe("2d");
  expect(formatUsageAge(now - 21 * 86_400_000, now)).toBe("3w");
});
