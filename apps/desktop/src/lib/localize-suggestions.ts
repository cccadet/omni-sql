import type { Suggestion } from "@omni-sql/autocomplete-engine";

export function localizeSuggestionLabels(
  suggestions: readonly Suggestion[],
  allColumnsLabel: string,
): Suggestion[] {
  return suggestions.map((suggestion) => suggestion.kind === "all-columns"
    ? { ...suggestion, label: allColumnsLabel }
    : suggestion);
}
