export function formatDuration(elapsedMs: number): string {
  const [divisor, unit] = elapsedMs >= 3_600_000
    ? [3_600_000, "h"] as const
    : elapsedMs >= 60_000
      ? [60_000, "min"] as const
      : elapsedMs >= 1_000
        ? [1_000, "s"] as const
        : [1, "ms"] as const;
  return `${Number((elapsedMs / divisor).toFixed(2))} ${unit}`;
}
