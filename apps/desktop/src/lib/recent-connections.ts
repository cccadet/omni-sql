/** When each connection was last switched to, for the switcher's Recent list and the Manage dialog. */
const RECENT_CONNECTIONS_KEY = "omni-sql:connectionLastUsed";

export type ConnectionUsage = Readonly<Record<string, number>>;

export function loadConnectionUsage(): ConnectionUsage {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_CONNECTIONS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
  } catch {
    return {};
  }
}

export function recordConnectionUse(usage: ConnectionUsage, id: string, now = Date.now()): ConnectionUsage {
  const next = { ...usage, [id]: now };
  try {
    localStorage.setItem(RECENT_CONNECTIONS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable: recents only last for this session.
  }
  return next;
}

/** Most recently used first, limited to connections that still exist. */
export function recentConnectionIds(usage: ConnectionUsage, existingIds: readonly string[], limit = 3): string[] {
  const existing = new Set(existingIds);
  return Object.entries(usage)
    .filter(([id]) => existing.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/** Compact "5m", "3h", "2d", "4w" age; null for future or missing timestamps. */
export function formatUsageAge(at: number | undefined, now = Date.now()): string | null {
  if (at === undefined || at > now) return null;
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`;
}
