import { expect, it } from "vitest";
import { formatLastSyncedAt, getMetadataFreshness } from "./metadata-freshness";

const now = new Date(2026, 7, 12, 15, 30);

it("classifies absent, invalid, same-day, and stale metadata timestamps", () => {
  expect(getMetadataFreshness(undefined, now)).toBe("unsynced");
  expect(getMetadataFreshness(Number.NaN, now)).toBe("unsynced");
  expect(getMetadataFreshness(now.getTime(), now)).toBe("today");
  expect(getMetadataFreshness(new Date(2026, 7, 11, 23, 59).getTime(), now)).toBe("stale");
});

it("formats only finite valid metadata timestamps", () => {
  expect(formatLastSyncedAt(undefined)).toBeNull();
  expect(formatLastSyncedAt(Number.POSITIVE_INFINITY)).toBeNull();
  expect(formatLastSyncedAt(now.getTime())).toBeTruthy();
});
