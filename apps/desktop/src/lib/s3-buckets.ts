import type { ConnectionEntry } from "./backend";

export function s3Buckets(connection: Pick<ConnectionEntry, "endpoint" | "options">): string[] {
  const encoded = connection.options?.buckets;
  if (typeof encoded === "string") {
    try {
      const parsed: unknown = JSON.parse(encoded);
      if (Array.isArray(parsed)) {
        const buckets = parsed.filter((value): value is string => typeof value === "string" && /^s3:\/\/[^/]+\/?$/.test(value));
        if (buckets.length > 0) return [...new Set(buckets.map((value) => value.replace(/\/$/, "")))];
      }
    } catch { /* Legacy single-bucket config. */ }
  }
  return [connection.endpoint.replace(/\/$/, "")];
}
