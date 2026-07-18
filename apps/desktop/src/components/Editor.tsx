import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import MonacoEditor, { type BeforeMount } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import type { Suggestion } from "@omni-sql/autocomplete-engine";
import type { DialectId, SqlDiagnostic } from "@omni-sql/ts-types";
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
  replaceTextRange: (start: number, end: number, text: string) => void;
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
  diagnostics?: readonly SqlDiagnostic[];
  onApplyTranspiled?: (diagnostic: SqlDiagnostic) => void;
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
    diagnostics = [],
    onApplyTranspiled,
  },
  ref,
) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const formatterRef = useRef<ReturnType<typeof configureFormatter> | null>(null);
  const autocompleteRef = useRef<((cursor: number) => Promise<Suggestion[]>) | null>(onAutocomplete ?? null);
  const diagnosticsRef = useRef<readonly SqlDiagnostic[]>(diagnostics);
  const applyTranspiledRef = useRef<((diagnostic: SqlDiagnostic) => void) | undefined>(onApplyTranspiled);

  useEffect(() => {
    autocompleteRef.current = onAutocomplete ?? null;
  }, [onAutocomplete]);

  useEffect(() => {
    diagnosticsRef.current = diagnostics;
    applyTranspiledRef.current = onApplyTranspiled;
  }, [diagnostics, onApplyTranspiled]);

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
      replaceTextRange: (start, end, text) => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model) return;
        editor.executeEdits("transpile-sql", [{
          range: {
            startLineNumber: model.getPositionAt(start).lineNumber,
            startColumn: model.getPositionAt(start).column,
            endLineNumber: model.getPositionAt(end).lineNumber,
            endColumn: model.getPositionAt(end).column,
          },
          text,
        }]);
        editor.focus();
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

  useEffect(() => {
    const monacoInstance = monacoRef.current;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!monacoInstance || !model) return;
    monacoInstance.editor.setModelMarkers(
      model,
      "omni-sql-diagnostics",
      diagnostics.map((d) => {
        const start = model.getPositionAt(Math.max(0, d.start));
        const end = model.getPositionAt(Math.max(d.start + 1, d.end));
        return {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
          message: d.transpileMessage ? `${d.message} ${d.transpileMessage}` : d.message,
          severity: d.severity === "error"
            ? monacoInstance.MarkerSeverity.Error
            : d.severity === "warning"
              ? monacoInstance.MarkerSeverity.Warning
              : monacoInstance.MarkerSeverity.Info,
          source: d.source,
        };
      }),
    );
  }, [diagnostics]);

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

      configureAutocomplete(monacoInstance, autocompleteRef);

      monacoInstance.languages.registerHoverProvider(LANGUAGE_ID, {
        provideHover(model, position) {
          const offset = model.getOffsetAt(position);
          const diagnostic = diagnosticsRef.current.find((d) => offset >= d.start && offset <= d.end);
          if (!diagnostic) return null;
          const contents: monaco.IMarkdownString[] = [
            { value: `**${diagnostic.severity === "error" ? "Erro" : "Aviso"}**: ${diagnostic.message}` },
          ];
          if (diagnostic.transpileMessage) contents.push({ value: diagnostic.transpileMessage });
          return { contents };
        },
      });

      monacoInstance.languages.registerCodeActionProvider(LANGUAGE_ID, {
        provideCodeActions(model, range) {
          const start = model.getOffsetAt(range.getStartPosition());
          const diagnostic = diagnosticsRef.current.find((item) =>
            item.transpiledSql && start >= item.start && start <= item.end,
          );
          if (!diagnostic?.transpiledSql) return { actions: [], dispose: () => undefined };
          return {
            actions: [{
              title: `⚡ Transpilar para ${diagnostic.targetDialect}`,
              kind: "quickfix",
              isPreferred: true,
              diagnostics: [],
              command: {
                id: "omni-apply-transpile",
                title: "Aplicar transpilation",
                arguments: [diagnostic],
              },
            }],
            dispose: () => undefined,
          };
        },
      });
      monacoInstance.editor.registerCommand("omni-apply-transpile", (_accessor, suppliedDiagnostic?: SqlDiagnostic) => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        const position = editor?.getPosition();
        if (!model || !position) return;
        if (suppliedDiagnostic) {
          applyTranspiledRef.current?.(suppliedDiagnostic);
          return;
        }
        const offset = model.getOffsetAt(position);
        const diagnostic = diagnosticsRef.current.find((item) =>
          item.transpiledSql && offset >= item.start && offset <= item.end,
        );
        if (diagnostic) applyTranspiledRef.current?.(diagnostic);
      });

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
    [dialect, formatterSettings, onRun, onRunAll, onSave, onCursorChange, handleFormat, theme, diagnostics, onApplyTranspiled],
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
