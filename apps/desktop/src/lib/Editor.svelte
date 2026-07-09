<script lang="ts">
  import { onMount } from "svelte";
  import * as monaco from "monaco-editor";
  import { postgresDescriptor } from "@omni-sql/dialect-descriptors";
  import type { Suggestion } from "@omni-sql/autocomplete-engine";

  interface Props {
    value: string;
    fontFamily?: string;
    onAutocomplete?: (cursor: number) => Promise<Suggestion[]>;
    onRun?: () => void;
  }
  let {
    value = $bindable(),
    fontFamily = "ui-monospace, monospace",
    onAutocomplete,
    onRun,
  }: Props = $props();

  let container: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let dispose: (() => void) | null = null;

  export function insertAtCursor(text: string) {
    if (!editor) return;
    const sel = editor.getSelection();
    if (!sel) return;
    editor.executeEdits("sidebar-insert", [{ range: sel, text }]);
    editor.focus();
  }

  /** Seleção atual (se houver) e offset do cursor — usado para decidir o que rodar. */
  export function getRunTarget(): { selectionText: string | null; cursorOffset: number } {
    if (!editor) return { selectionText: null, cursorOffset: 0 };
    const model = editor.getModel();
    const sel = editor.getSelection();
    const position = editor.getPosition();
    const cursorOffset = model && position ? model.getOffsetAt(position) : 0;
    const selectionText = model && sel && !sel.isEmpty() ? model.getValueInRange(sel) : null;
    return { selectionText, cursorOffset };
  }

  function mapKind(k: Suggestion["kind"]): monaco.languages.CompletionItemKind {
    switch (k) {
      case "table": return monaco.languages.CompletionItemKind.Class;
      case "view": return monaco.languages.CompletionItemKind.Interface;
      case "column": return monaco.languages.CompletionItemKind.Field;
      case "function": return monaco.languages.CompletionItemKind.Function;
      case "keyword": return monaco.languages.CompletionItemKind.Keyword;
      case "star": return monaco.languages.CompletionItemKind.Value;
      case "all-columns": return monaco.languages.CompletionItemKind.Snippet;
      default: return monaco.languages.CompletionItemKind.Text;
    }
  }

  onMount(() => {
    monaco.languages.register({ id: "sql-omni", extensions: [".sql"] });
    const kw = [...postgresDescriptor.keywords];
    monaco.languages.setMonarchTokensProvider("sql-omni", {
      defaultToken: "",
      tokenizer: {
        root: [
          [new RegExp(`\\b(?:${kw.join("|")})\\b`, "i"), "keyword"],
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

    editor = monaco.editor.create(container, {
      value,
      language: "sql-omni",
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 13,
      fontFamily,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 8, bottom: 8 },
      tabSize: 2,
      lineNumbers: "on",
      matchBrackets: "always",
      bracketPairColorization: { enabled: true },
    });

    editor.onDidChangeModelContent(() => {
      value = editor!.getValue();
    });

    editor.addAction({
      id: "omni-run-query",
      label: "Executar query",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => onRun?.(),
    });

    monaco.languages.registerCompletionItemProvider("sql-omni", {
      triggerCharacters: [".", " "],
      async provideCompletionItems(model, position) {
        const cursor = model.getOffsetAt(position);
        const word = model.getWordUntilPosition(position);
        let suggestions: Suggestion[] = [];
        try {
          suggestions = (await onAutocomplete?.(cursor)) ?? [];
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
            // O engine já calcula a ordem correta (bulk-insert primeiro,
            // colunas em ordem alfabética, depois funções) — sortText força
            // o Monaco a respeitá-la em vez de aplicar sua própria heurística
            // quando não há texto digitado ainda.
            sortText: String(i).padStart(5, "0"),
            range,
          })),
        };
      },
    });

    return () => {
      editor?.dispose();
    };
  });

  // Sincroniza valor externo -> editor quando `value` muda por fora.
  $effect(() => {
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  });

  $effect(() => {
    editor?.updateOptions({ fontFamily });
  });
</script>

<div class="editor" bind:this={container}></div>

<style>
  .editor {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
</style>