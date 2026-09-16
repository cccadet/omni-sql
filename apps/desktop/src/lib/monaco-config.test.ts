import { assert, test, vi } from "vitest";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { createEditorActions } from "./editor-actions";
import { configureAutocomplete, registerSqlLanguage } from "./monaco-config";

test("SQL highlighting recognizes keywords from every supported dialect", () => {
  let provider: monaco.languages.IMonarchLanguage | undefined;
  const monacoInstance = {
    languages: {
      getLanguages: () => [],
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      setMonarchTokensProvider: vi.fn(
        (_languageId: string, registeredProvider: monaco.languages.IMonarchLanguage) => {
          provider = registeredProvider;
        },
      ),
    },
  } as never;

  registerSqlLanguage(monacoInstance);

  assert.ok(provider);
  assert.ok(provider.keywords.includes("SELECT"));
  assert.ok(provider.keywords.includes("GRANT"));
});

test("editor actions invoke latest run callback", () => {
  const initialRun = vi.fn();
  const latestRun = vi.fn();
  const runRef = { current: initialRun as (() => void) | undefined };
  const editor = { addAction: vi.fn() };
  const monacoInstance = {
    KeyMod: { CtrlCmd: 1, Shift: 2, Alt: 4 },
    KeyCode: { Enter: 8, KeyS: 9 },
  } as never;

  createEditorActions(monacoInstance, editor as never, runRef, { current: undefined }, { current: undefined }, { current: undefined });
  runRef.current = latestRun;

  const runAction = editor.addAction.mock.calls[0]?.[0] as { run: () => void };
  runAction.run();
  assert.equal(initialRun.mock.calls.length, 0);
  assert.equal(latestRun.mock.calls.length, 1);
});

test("autocomplete sortText ranks relevance descending and preserves ties", async () => {
  type CompletionProvider = Parameters<typeof monaco.languages.registerCompletionItemProvider>[1];
  let provider: CompletionProvider | undefined;
  const registerCompletionItemProvider = vi.fn(
    (_languageId: string, registeredProvider: CompletionProvider) => {
      provider = registeredProvider;
      return { dispose: vi.fn() };
    },
  );
  const monacoInstance = {
    languages: {
      registerCompletionItemProvider,
    },
  } as never;

  configureAutocomplete(monacoInstance, {
    current: async () => [
      { kind: "keyword", label: "low", relevance: 10 },
      { kind: "keyword", label: "high", insertText: "SELECT $1", relevance: 100 },
      { kind: "keyword", label: "same", relevance: 100 },
      { kind: "column", label: "CDUNMBENEFICIARIOCARTEIRA", filterText: "unm", relevance: 50 },
    ],
  });

  if (!provider) throw new Error("completion provider was not registered");
  const result = await provider.provideCompletionItems(
    {
      getOffsetAt: () => 0,
      getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
      getValue: () => "",
    } as never,
    { lineNumber: 1, column: 1 } as never,
    {} as never,
    {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: vi.fn() }),
    } as never,
  );

  if (!result) throw new Error("completion result was not returned");
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.label), [
    "low",
    "high",
    "same",
    "CDUNMBENEFICIARIOCARTEIRA",
  ]);
  assert.deepEqual(
    [...result.suggestions]
      .sort((a, b) => (a.sortText ?? "").localeCompare(b.sortText ?? ""))
      .map((suggestion) => suggestion.label),
    ["high", "same", "CDUNMBENEFICIARIOCARTEIRA", "low"],
  );
  assert.equal(result.suggestions[1]?.insertText, "SELECT $1");
  assert.equal(
    result.suggestions[1]?.insertTextRules,
    monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  );
  assert.equal(result.suggestions[0]?.insertText, "low");
  assert.equal(result.suggestions[3]?.filterText, "unm");
  assert.ok(result.suggestions.every((suggestion) => suggestion.sortText?.startsWith("!omni:")));
});

test("/catalog suggests existing examples and replaces the full command with SQL", async () => {
  type CompletionProvider = Parameters<typeof monaco.languages.registerCompletionItemProvider>[1];
  let provider: CompletionProvider | undefined;
  const backendCompletion = vi.fn();
  const monacoInstance = {
    languages: {
      registerCompletionItemProvider: (_language: string, registeredProvider: CompletionProvider) => {
        provider = registeredProvider;
        return { dispose: vi.fn() };
      },
    },
  } as never;
  const dialectRef = { current: "postgres" as const };
  configureAutocomplete(monacoInstance, { current: backendCompletion }, dialectRef);
  if (!provider) throw new Error("completion provider was not registered");
  const catalogProvider = provider;

  const complete = async (value: string) => catalogProvider.provideCompletionItems(
    {
      getOffsetAt: () => value.length,
      getValue: () => value,
      getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
    } as never,
    { lineNumber: 1, column: value.length + 1 } as never,
    {} as never,
    {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: vi.fn() }),
    } as never,
  );

  const all = await complete("/catalog");
  if (!all) throw new Error("catalog completion was not returned");
  assert.ok(all.suggestions.some((suggestion) => suggestion.label === "Create table"));
  assert.ok(all.suggestions.some((suggestion) => suggestion.label === "Add column"));
  assert.ok(all.suggestions.some((suggestion) => suggestion.label === "Upsert"));

  const partial = await complete("/cat");
  if (!partial) throw new Error("partial catalog completion was not returned");
  assert.deepEqual(partial.suggestions.map((suggestion) => suggestion.label), ["/catalog"]);
  assert.equal(partial.suggestions[0]?.insertText, "/catalog");
  assert.deepEqual(partial.suggestions[0]?.range, {
    startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 5,
  });

  const filtered = await complete("/catalog add col");
  if (!filtered) throw new Error("filtered catalog completion was not returned");
  assert.deepEqual(filtered.suggestions.map((suggestion) => suggestion.label), ["Add column"]);
  assert.equal(filtered.suggestions[0]?.insertText, "ALTER TABLE table_name\nADD COLUMN column_name VARCHAR(255);");
  assert.deepEqual(filtered.suggestions[0]?.range, {
    startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 17,
  });
  assert.equal(backendCompletion.mock.calls.length, 0);
});
