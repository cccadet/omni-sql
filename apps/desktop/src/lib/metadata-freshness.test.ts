import { test, assert } from "vitest";
import { getMetadataFreshness } from "./metadata-freshness";

test("metadata freshness uses the local calendar date", () => {
  const now = new Date(2026, 6, 18, 10, 30);
  assert.equal(getMetadataFreshness(new Date(2026, 6, 18, 1).getTime(), now), "today");
  assert.equal(getMetadataFreshness(new Date(2026, 6, 17, 23).getTime(), now), "stale");
  assert.equal(getMetadataFreshness(undefined, now), "unsynced");
});
