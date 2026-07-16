import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import MonacoEditor from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import type { Suggestion } from "@omni-sql/autocomplete-engine";
import type { DialectId } from "@omni-sql/ts-types";
import { DEFAULT_FORMATTER_SETTINGS, type FormatterSettings } from "../lib/format-sql";
import {
  configureAutocomplete,
  configureFormatter,
  createEditorActions,
  LANGUAGE_ID,
  registerSqlLanguage,
} from "../lib/monaco-config";

export interface EditorHandle {
  insertAtCursor: (text: string) => void;
  getRunTarget: () => { selectionText: string | null; cursorOffset: number };
}

export interface EditorProps {
  value: string;
  onChange?: (value: string) => void;
  onRun?: () => void;
  onCursorChange?: (position: { line: number; column: number }) => void;
  onAutocomplete?: (cursor: number) => Promise<Suggestion[]>;
  dialect?: DialectId;
  theme?: "vs" | "vs-dark";
  fontFamily?: string;
  formatterSettings?: FormatterSettings;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    value,
    onChange,
    onRun,
    onCursorChange,
    onAutocomplete,
    dialect = "jdbc-generic",
    theme = "vs-dark",
    fontFamily = "ui-monospace, monospace",
    formatterSettings,
  },
  ref,
) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const formatterRef = useRef<ReturnType<typeof configureFormatter> | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor: (text: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        const sel = editor.getSelection();
        if (!sel) return;
        editor.executeEdits("sidebar-insert", [{ range: sel, text }]);
        editor.focus();
      },
      getRunTarget: () => {
        const editor = editorRef.current;
        if (!editor) return { selectionText: null, cursorOffset: 0 };
        const model = editor.getModel();
        const sel = editor.getSelection();
        const position = editor.getPosition();
        const cursorOffset = model && position ? model.getOffsetAt(position) : 0;
        const selectionText = model && sel && !sel.isEmpty() ? model.getValueInRange(sel) : null;
        return { selectionText, cursorOffset };
      },
    }),
    [],
  );

  const handleFormat = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    formatterRef.current?.formatCurrentDocument(editor);
  }, []);

  const handleMount = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: typeof monaco) => {
      editorRef.current = editor;
      monacoRef.current = monacoInstance;

      registerSqlLanguage();
      formatterRef.current = configureFormatter(monacoInstance, dialect, formatterSettings ?? DEFAULT_FORMATTER_SETTINGS);

      if (onAutocomplete) {
        configureAutocomplete(monacoInstance, onAutocomplete);
      }

      createEditorActions(monacoInstance, editor, onRun, handleFormat);

      editor.onDidChangeCursorPosition((e) => {
        onCursorChange?.({ line: e.position.lineNumber, column: e.position.column });
      });

      editor.onKeyDown((e) => {
        const settings = formatterSettings ?? DEFAULT_FORMATTER_SETTINGS;
        if (settings.keybinding && formatterRef.current?.matchesKeybinding(settings.keybinding, e)) {
          e.preventDefault();
          e.stopPropagation();
          handleFormat();
        }
      });
    },
    [dialect, formatterSettings, onAutocomplete, onRun, onCursorChange, handleFormat],
  );

  return (
    <MonacoEditor
      height="100%"
      language={LANGUAGE_ID}
      theme={theme}
      value={value}
      onChange={(v) => onChange?.(v ?? "")}
      onMount={handleMount}
      options={{
        automaticLayout: true,
        fontSize: 13,
        fontFamily,
        minimap: { enabled: true, scale: 1, showSlider: "mouseover" },
        glyphMargin: true,
        scrollBeyondLastLine: false,
        padding: { top: 8, bottom: 8 },
        tabSize: 2,
        lineNumbers: "on",
        matchBrackets: "always",
        bracketPairColorization: { enabled: true },
        autoClosingBrackets: "never",
        autoClosingQuotes: "never",
      }}
    />
  );
});
