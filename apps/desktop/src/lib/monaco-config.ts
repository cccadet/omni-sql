import * as monaco from "monaco-editor";
import { postgresDescriptor } from "@omni-sql/dialect-descriptors";
import type { Suggestion } from "@omni-sql/autocomplete-engine";
import type { DialectId } from "@omni-sql/ts-types";
import {
  formatSql,
  type FormatterSettings,
  parseKeybinding,
} from "./format-sql";

const LANGUAGE_ID = "sql-omni";

export { LANGUAGE_ID };

export function mapKind(k: Suggestion["kind"]): monaco.languages.CompletionItemKind {
  switch (k) {
    case "table":
      return monaco.languages.CompletionItemKind.Class;
    case "view":
      return monaco.languages.CompletionItemKind.Interface;
    case "column":
      return monaco.languages.CompletionItemKind.Field;
    case "function":
      return monaco.languages.CompletionItemKind.Function;
    case "keyword":
      return monaco.languages.CompletionItemKind.Keyword;
    case "star":
      return monaco.languages.CompletionItemKind.Value;
    case "all-columns":
      return monaco.languages.CompletionItemKind.Snippet;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}

export function registerSqlLanguage(): void {
  if (monaco.languages.getLanguages().some((l) => l.id === LANGUAGE_ID)) {
    return;
  }
  monaco.languages.register({ id: LANGUAGE_ID, extensions: [".sql"] });
  const kw = [...postgresDescriptor.keywords];
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    defaultToken: "",
    ignoreCase: true,
    tokenizer: {
      root: [
        [new RegExp(`\\b(?:${kw.join("|")})\\b`), "keyword"],
        [/--.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/'/, "string", "@string"],
        [/[a-zA-Z_][\w$]*/, "identifier"],
        [/[0-9]+(\.[0-9]+)?/, "number"],
      ],
      string: [
        [/[^']+/, "string"],
        [/''/, "string"],
        [/'/, "string", "@pop"],
      ],
      comment: [
        [/[^*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
      ],
    },
  });
}

export function configureFormatter(
  monacoInstance: typeof monaco,
  dialect: DialectId,
  formatterSettings: FormatterSettings,
) {
  function formatCurrentDocument(editor: monaco.editor.IStandaloneCodeEditor) {
    const action = editor.getAction("editor.action.formatDocument");
    void action?.run();
  }

  function matchesKeybinding(
    keybinding: string,
    e: monaco.IKeyboardEvent,
  ): boolean {
    const parsed = parseKeybinding(keybinding);
    const expectedKey = parsed.key.toUpperCase();
    const actualKey = e.browserEvent.key.toUpperCase();
    if (actualKey !== expectedKey) return false;
    const ctrl = e.ctrlKey || e.metaKey;
    if (parsed.ctrl !== ctrl) return false;
    if (parsed.alt !== e.altKey) return false;
    if (parsed.shift !== e.shiftKey) return false;
    return true;
  }

  monacoInstance.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, {
    provideDocumentFormattingEdits(model) {
      try {
        const formatted = formatSql(model.getValue(), dialect, formatterSettings);
        return [
          {
            range: model.getFullModelRange(),
            text: formatted,
          },
        ];
      } catch {
        return [];
      }
    },
  });

  return { formatCurrentDocument, matchesKeybinding };
}

export function configureAutocomplete(
  monacoInstance: typeof monaco,
  onAutocomplete: (cursor: number) => Promise<Suggestion[]>,
) {
  monacoInstance.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: [".", " "],
    async provideCompletionItems(model, position) {
      const cursor = model.getOffsetAt(position);
      const word = model.getWordUntilPosition(position);
      let suggestions: Suggestion[] = [];
      try {
        suggestions = await onAutocomplete(cursor);
      } catch {
        suggestions = [];
      }
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: suggestions.map((s, i) => ({
          label: s.label,
          kind: mapKind(s.kind),
          detail: s.detail,
          insertText: s.insertText ?? s.label,
          insertTextRules:
            s.insertText && (s.insertText.includes("$1") || s.insertText.includes("$2"))
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          sortText: String(i).padStart(5, "0"),
          range,
        })),
      };
    },
  });
}

export function createEditorActions(
  monacoInstance: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
  onRun?: () => void,
  onFormat?: () => void,
): void {
  editor.addAction({
    id: "omni-run-query",
    label: "Executar query",
    keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter],
    run: () => onRun?.(),
  });
  editor.addAction({
    id: "omni-format-sql",
    label: "Formatar SQL",
    run: () => onFormat?.(),
  });
}
