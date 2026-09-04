import { describe, expect, it } from "vitest";
import type { Suggestion } from "@omni-sql/autocomplete-engine";
import { localizeSuggestionLabels } from "./localize-suggestions";

describe("localizeSuggestionLabels", () => {
  it("localizes the all-columns label without changing its SQL insertion text", () => {
    const suggestions: Suggestion[] = [
      { kind: "column", label: "email", relevance: 80 },
      { kind: "all-columns", label: "Todas as colunas", insertText: "id, email", relevance: 40 },
    ];

    expect(localizeSuggestionLabels(suggestions, "All columns")).toEqual([
      suggestions[0],
      { kind: "all-columns", label: "All columns", insertText: "id, email", relevance: 40 },
    ]);
  });
});
