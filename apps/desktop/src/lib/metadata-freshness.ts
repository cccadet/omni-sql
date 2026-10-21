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

/** Compact age of the last sync ("5m", "3h", "2d"); null when unsynced or under a minute. */
export function formatSyncAge(lastSyncedAt: number | undefined, now = Date.now()): string | null {
  if (lastSyncedAt == null || !Number.isFinite(lastSyncedAt)) return null;
  const minutes = Math.floor((now - lastSyncedAt) / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
