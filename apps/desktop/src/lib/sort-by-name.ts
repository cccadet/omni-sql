const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Returns a copy sorted alphabetically (case/accent-insensitive, numeric-aware) by the given key. */
export function sortByName<T>(items: readonly T[], name: (item: T) => string): T[] {
  return [...items].sort((left, right) => collator.compare(name(left), name(right)));
}
