import * as monaco from "monaco-editor";
import { postgresDescriptor } from "@omni-sql/dialect-descriptors";
import type { Suggestion } from "@omni-sql/autocomplete-engine";
import type { DialectId } from "@omni-sql/ts-types";
import {
  formatSql,
  type FormatterSettings,
  parseKeybinding,
  formatKeybindingForDisplay,
} from "./format-sql";

const LANGUAGE_ID = "sql-omni";

export { LANGUAGE_ID };

export const OMNISQL_DARK = "omni-sql-dark";
export const OMNISQL_LIGHT = "omni-sql-light";

export function registerOmniThemes(monacoInstance: typeof monaco): void {
  monacoInstance.editor.defineTheme(OMNISQL_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "FECF78", fontStyle: "bold" },
      { token: "keyword.uppercase", foreground: "FECF78", fontStyle: "bold" },
      { token: "function", foreground: "FECF78" },
      { token: "type", foreground: "E9C46A" },
      { token: "number", foreground: "B388FF" },
      { token: "string", foreground: "7EE787" },
      { token: "string.sql", foreground: "7EE787" },
      { token: "comment", foreground: "6A9955" },
      { token: "operator", foreground: "E9C46A" },
      { token: "identifier", foreground: "D4D4D4" },
      { token: "table", foreground: "9CDCFE" },
      { token: "column", foreground: "D4D4D4" },
    ],
    colors: {
      "editor.background": "#1E1E1E",
      "editor.lineHighlightBackground": "#2D2D2D",
      "editorLineNumber.foreground": "#6E6E6E",
      "editorLineNumber.activeForeground": "#CCCCCC",
      "editor.selectionBackground": "#264F78",
      "editor.inactiveSelectionBackground": "#3A3D41",
    },
  });

  monacoInstance.editor.defineTheme(OMNISQL_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "D97706", fontStyle: "bold" },
      { token: "keyword.uppercase", foreground: "D97706", fontStyle: "bold" },
      { token: "function", foreground: "D97706" },
      { token: "type", foreground: "B45309" },
      { token: "number", foreground: "7C3AED" },
      { token: "string", foreground: "047857" },
      { token: "string.sql", foreground: "047857" },
      { token: "comment", foreground: "2E7D32" },
      { token: "operator", foreground: "B45309" },
      { token: "identifier", foreground: "1F2937" },
      { token: "table", foreground: "0369A1" },
      { token: "column", foreground: "1F2937" },
    ],
    colors: {
      "editor.background": "#FFFFFF",
      "editor.lineHighlightBackground": "#F3F4F6",
      "editorLineNumber.foreground": "#9CA3AF",
      "editorLineNumber.activeForeground": "#4B5563",
      "editor.selectionBackground": "#ADD6FF",
      "editor.inactiveSelectionBackground": "#E5E5E5",
    },
  });
}

export function getOmniThemeName(isDark: boolean): string {
  return isDark ? OMNISQL_DARK : OMNISQL_LIGHT;
}

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

const COMMON_FUNCTIONS = [
  "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "NVL", "DECODE",
  "LENGTH", "SUBSTRING", "SUBSTR", "TRIM", "UPPER", "LOWER", "REPLACE",
  "ROUND", "FLOOR", "CEIL", "ABS", "MOD", "POWER", "SQRT", "SIGN",
  "CURRENT_DATE", "CURRENT_TIMESTAMP", "NOW", "SYSDATE", "GETDATE",
  "TO_CHAR", "TO_DATE", "TO_NUMBER", "CAST", "CONVERT",
  "EXTRACT", "DATE_PART", "DATE_TRUNC",
  "ROW_NUMBER", "RANK", "DENSE_RANK", "LEAD", "LAG", "OVER",
  "STRING_AGG", "GROUP_CONCAT", "LISTAGG",
] as const;

export function registerSqlLanguage(): void {
  if (monaco.languages.getLanguages().some((l) => l.id === LANGUAGE_ID)) {
    return;
  }
  monaco.languages.register({ id: LANGUAGE_ID, extensions: [".sql"] });
  const kw = [...postgresDescriptor.keywords];
  const kwPattern = new RegExp(`\\b(?:${kw.join("|")})\\b`, "i");
  const fnPattern = new RegExp(`\\b(?:${COMMON_FUNCTIONS.join("|")})\\b(?=\\s*\\()`, "i");
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    defaultToken: "",
    ignoreCase: true,
    brackets: [
      { open: "(", close: ")", token: "delimiter.parenthesis" },
      { open: "[", close: "]", token: "delimiter.bracket" },
      { open: "{", close: "}", token: "delimiter.brace" },
    ],
    keywords: kw,
    functions: COMMON_FUNCTIONS,
    operators: [
      "+", "-", "*", "/", "%", "=", "!=", "<>", "<", ">", "<=", ">=",
      "&&", "||", "::", "|", "&", "^", "~", "<<", ">>",
    ],
    tokenizer: {
      root: [
        [/--.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/'/, "string", "@string"],
        [/"/, "string.identifier", "@quotedIdentifier"],
        [/`/, "string.identifier", "@backtickIdentifier"],
        [/\[/, "string.identifier", "@bracketIdentifier"],
        [fnPattern, "function"],
        [kwPattern, "keyword"],
        [/[+\-*/%=<>!&|^~:]+/, "operator"],
        [/[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/, "number"],
        [/[a-zA-Z_][\w$@#]*/, "identifier"],
      ],
      string: [
        [/[^']+/, "string"],
        [/''/, "string"],
        [/'/, "string", "@pop"],
      ],
      quotedIdentifier: [
        [/[^"]+/, "string.identifier"],
        [/""/, "string.identifier"],
        [/"/, "string.identifier", "@pop"],
      ],
      backtickIdentifier: [
        [/[^`]+/, "string.identifier"],
        [/`/, "string.identifier", "@pop"],
      ],
      bracketIdentifier: [
        [/[^\]]+/, "string.identifier"],
        [/\]\]/, "string.identifier"],
        [/\]/, "string.identifier", "@pop"],
      ],
      comment: [
        [/[^*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/./, "comment"],
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
  onRunAll?: () => void,
  onSave?: () => void,
  onFormat?: () => void,
  formatterSettings?: FormatterSettings,
): void {
  editor.addAction({
    id: "omni-run-query",
    label: "Executar instrução atual",
    keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter],
    run: () => onRun?.(),
  });
  editor.addAction({
    id: "omni-run-all",
    label: "Executar todas as instruções",
    keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.Enter],
    run: () => onRunAll?.(),
  });
  editor.addAction({
    id: "omni-save-tab",
    label: "Salvar aba",
    keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS],
    run: () => {
      onSave?.();
      return undefined;
    },
  });

  const keybinding = formatterSettings?.keybinding;
  if (keybinding) {
    const parsed = parseKeybinding(keybinding);
    const keyCode = monacoInstance.KeyCode[parsed.key as keyof typeof monacoInstance.KeyCode];
    if (keyCode !== undefined) {
      let mod = 0;
      if (parsed.ctrl) mod |= monacoInstance.KeyMod.CtrlCmd;
      if (parsed.alt) mod |= monacoInstance.KeyMod.Alt;
      if (parsed.shift) mod |= monacoInstance.KeyMod.Shift;
      editor.addAction({
        id: "omni-format-sql",
        label: `Formatar SQL (${formatKeybindingForDisplay(keybinding)})`,
        keybindings: [mod | keyCode],
        run: () => onFormat?.(),
      });
    } else {
      editor.addAction({
        id: "omni-format-sql",
        label: "Formatar SQL",
        run: () => onFormat?.(),
      });
    }
  } else {
    editor.addAction({
      id: "omni-format-sql",
      label: "Formatar SQL",
      run: () => onFormat?.(),
    });
  }
}
