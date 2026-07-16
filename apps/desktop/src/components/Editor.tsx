import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import MonacoEditor, { type BeforeMount } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import type { Suggestion } from "@omni-sql/autocomplete-engine";
import type { DialectId } from "@omni-sql/ts-types";
import { DEFAULT_FORMATTER_SETTINGS, type FormatterSettings } from "../lib/format-sql";
import { splitStatements, statementAt, type SqlStatement } from "../lib/sql-statements";
import {
  configureAutocomplete,
  configureFormatter,
  createEditorActions,
  LANGUAGE_ID,
  OMNISQL_DARK,
  registerOmniThemes,
  registerSqlLanguage,
} from "../lib/monaco-config";
import type { OMNISQL_LIGHT } from "../lib/monaco-config";

export interface EditorHandle {
  insertAtCursor: (text: string) => void;
  getRunTarget: () => { selectionText: string | null; cursorOffset: number; currentStatement: SqlStatement | null };
  getStatements: () => SqlStatement[];
  getCurrentStatement: () => SqlStatement | null;
  getAllText: () => string;
  getSelectionOrCurrent: () => { sql: string; start: number };
  formatDocument: () => void;
}

export interface EditorProps {
  value: string;
  onChange?: (value: string) => void;
  onRun?: () => void;
  onRunAll?: () => void;
  onSave?: () => void;
  onCursorChange?: (position: { line: number; column: number }) => void;
  onAutocomplete?: (cursor: number) => Promise<Suggestion[]>;
  dialect?: DialectId;
  theme?: typeof OMNISQL_DARK | typeof OMNISQL_LIGHT;
  fontFamily?: string;
  formatterSettings?: FormatterSettings;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    value,
    onChange,
    onRun,
    onRunAll,
    onSave,
    onCursorChange,
    onAutocomplete,
    dialect = "jdbc-generic",
    theme = OMNISQL_DARK,
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
        if (!editor) return { selectionText: null, cursorOffset: 0, currentStatement: null };
        const model = editor.getModel();
        const sel = editor.getSelection();
        const position = editor.getPosition();
        const cursorOffset = model && position ? model.getOffsetAt(position) : 0;
        const selectionText = model && sel && !sel.isEmpty() ? model.getValueInRange(sel) : null;
        const currentStatement = model ? statementAt(splitStatements(model.getValue()), cursorOffset) ?? null : null;
        return { selectionText, cursorOffset, currentStatement };
      },
      getStatements: () => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        return model ? splitStatements(model.getValue()) : [];
      },
      getCurrentStatement: () => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        const position = editor?.getPosition();
        if (!model || !position) return null;
        return statementAt(splitStatements(model.getValue()), model.getOffsetAt(position)) ?? null;
      },
      getAllText: () => editorRef.current?.getModel()?.getValue() ?? "",
      getSelectionOrCurrent: () => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        const sel = editor?.getSelection();
        if (!model) return { sql: "", start: 0 };
        if (sel && !sel.isEmpty()) {
          return { sql: model.getValueInRange(sel), start: model.getOffsetAt(sel.getStartPosition()) };
        }
        const position = editor?.getPosition();
        const offset = position ? model.getOffsetAt(position) : 0;
        const stmt = statementAt(splitStatements(model.getValue()), offset);
        return stmt ? { sql: stmt.text, start: stmt.start } : { sql: model.getValue(), start: 0 };
      },
      formatDocument: () => {
        const editor = editorRef.current;
        if (!editor) return;
        formatterRef.current?.formatCurrentDocument(editor);
      },
    }),
    [],
  );

  const handleFormat = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    formatterRef.current?.formatCurrentDocument(editor);
  }, []);

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(theme);
    }
  }, [theme]);

  const handleBeforeMount = useCallback<BeforeMount>((monacoInstance) => {
    registerSqlLanguage(monacoInstance);
    registerOmniThemes(monacoInstance);
  }, []);

  const handleMount = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: typeof monaco) => {
      editorRef.current = editor;
      monacoRef.current = monacoInstance;

      monacoInstance.editor.setTheme(theme);
      formatterRef.current = configureFormatter(monacoInstance, dialect, formatterSettings ?? DEFAULT_FORMATTER_SETTINGS);

      if (onAutocomplete) {
        configureAutocomplete(monacoInstance, onAutocomplete);
      }

      const settings = formatterSettings ?? DEFAULT_FORMATTER_SETTINGS;

      createEditorActions(monacoInstance, editor, onRun, onRunAll, onSave, handleFormat, settings);

      editor.onDidChangeCursorPosition((e) => {
        onCursorChange?.({ line: e.position.lineNumber, column: e.position.column });
      });

      editor.onKeyDown((e) => {
        if (settings.keybinding && formatterRef.current?.matchesKeybinding(settings.keybinding, e)) {
          e.preventDefault();
          e.stopPropagation();
          handleFormat();
        }
      });
    },
    [dialect, formatterSettings, onAutocomplete, onRun, onRunAll, onSave, onCursorChange, handleFormat, theme],
  );

  return (
    <MonacoEditor
      height="100%"
      language={LANGUAGE_ID}
      theme={theme}
      value={value}
      onChange={(v) => onChange?.(v ?? "")}
      beforeMount={handleBeforeMount}
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
