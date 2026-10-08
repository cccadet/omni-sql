import { expect, test } from "vitest";
import { formatDuration } from "./format-duration";

test.each([
  [0, "0 ms"],
  [12.3456, "12.35 ms"],
  [999, "999 ms"],
  [1_000, "1 s"],
  [1_234, "1.23 s"],
  [59_000, "59 s"],
  [60_000, "1 min"],
  [228_655.29999995232, "3.81 min"],
  [3_599_000, "59.98 min"],
  [3_600_000, "1 h"],
  [5_400_000, "1.5 h"],
])("formats %s milliseconds as %s", (elapsedMs, expected) => {
  expect(formatDuration(elapsedMs)).toBe(expected);
});
