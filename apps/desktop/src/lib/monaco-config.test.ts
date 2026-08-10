import { assert, test, vi } from "vitest";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { createEditorActions } from "./editor-actions";
import { configureAutocomplete } from "./monaco-config";

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
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.label), ["low", "high", "same"]);
  assert.deepEqual(
    [...result.suggestions]
      .sort((a, b) => (a.sortText ?? "").localeCompare(b.sortText ?? ""))
      .map((suggestion) => suggestion.label),
    ["high", "same", "low"],
  );
  assert.equal(result.suggestions[1]?.insertText, "SELECT $1");
  assert.equal(
    result.suggestions[1]?.insertTextRules,
    monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  );
  assert.equal(result.suggestions[0]?.insertText, "low");
});
