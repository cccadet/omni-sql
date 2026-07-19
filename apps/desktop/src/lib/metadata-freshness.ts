export type MetadataFreshness = "today" | "stale" | "unsynced";

export function getMetadataFreshness(lastSyncedAt: number | undefined, now = new Date()): MetadataFreshness {
  if (lastSyncedAt == null || !Number.isFinite(lastSyncedAt)) return "unsynced";
  const synced = new Date(lastSyncedAt);
  if (Number.isNaN(synced.getTime())) return "unsynced";
  return synced.getFullYear() === now.getFullYear() && synced.getMonth() === now.getMonth() && synced.getDate() === now.getDate()
    ? "today" : "stale";
}

export function formatLastSyncedAt(lastSyncedAt: number | undefined): string | null {
  if (lastSyncedAt == null || !Number.isFinite(lastSyncedAt)) return null;
  const date = new Date(lastSyncedAt);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
