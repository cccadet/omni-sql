// @vitest-environment node
import { expect, it } from "vitest";
import { formatLastSyncedAt, formatSyncAge, getMetadataFreshness } from "./metadata-freshness";

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

it("formats the sync age compactly for the sidebar header", () => {
  expect(formatSyncAge(undefined, now.getTime())).toBeNull();
  expect(formatSyncAge(now.getTime() - 30_000, now.getTime())).toBeNull();
  expect(formatSyncAge(now.getTime() - 5 * 60_000, now.getTime())).toBe("5m");
  expect(formatSyncAge(now.getTime() - 3 * 3_600_000, now.getTime())).toBe("3h");
  expect(formatSyncAge(now.getTime() - 50 * 3_600_000, now.getTime())).toBe("2d");
});
