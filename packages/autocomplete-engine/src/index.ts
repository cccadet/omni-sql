export {
  tokenize,
  type Token,
  type TokenType,
} from "./lexer.ts";
export {
  resolveContext,
  type ResolvedContext,
  type ClauseId,
  type ScopeRef,
} from "./context.ts";
export {
  autocompleteTier1,
  type MetadataSource,
  type Suggestion,
  type SuggestionKind,
} from "./engine.ts";