import type * as monaco from "monaco-editor";
import type { DialectId } from "@omni-sql/ts-types";
import { findCteClause } from "./cte-preview";
import { splitStatements, statementAt } from "./sql-statements";

export interface CtePreviewEditorOptions {
  readonly languageId: string;
  readonly dialect: { readonly current: DialectId };
  /** Receives the statement text that contains the CTE and the offset relative to it. */
  readonly onPreview: { readonly current: ((statement: string, offset: number) => void) | undefined };
  /** "▶ Preview {name}"; read on every lens refresh so a language switch applies. */
  readonly lensLabel: { readonly current: string };
  readonly actionLabel: string;
}

const PREVIEW_COMMAND = "omni-preview-cte";

/** Registers the "▶ Preview" CodeLens above each CTE and the "preview CTE at cursor" editor action. */
export function registerCtePreview(
  monacoInstance: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
  options: CtePreviewEditorOptions,
): monaco.IDisposable[] {
  const previewAt = (model: monaco.editor.ITextModel, offset: number) => {
    const statement = statementAt(splitStatements(model.getValue(), options.dialect.current), offset);
    if (statement) options.onPreview.current?.(statement.text, offset - statement.start);
  };

  const codeLens = monacoInstance.languages.registerCodeLensProvider(options.languageId, {
    provideCodeLenses(model) {
      const lenses: monaco.languages.CodeLens[] = [];
      const dialect = options.dialect.current;
      if (options.onPreview.current && dialect !== "mongodb") {
        for (const statement of splitStatements(model.getValue(), dialect)) {
          for (const cte of findCteClause(statement.text, dialect)?.ctes ?? []) {
            const offset = statement.start + cte.nameStart;
            const { lineNumber, column } = model.getPositionAt(offset);
            lenses.push({
              range: { startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column },
              command: { id: PREVIEW_COMMAND, title: options.lensLabel.current.replace("{name}", cte.name), arguments: [offset] },
            });
          }
        }
      }
      return { lenses, dispose: () => undefined };
    },
  });

  const command = monacoInstance.editor.registerCommand(PREVIEW_COMMAND, (_accessor, offset?: number) => {
    const model = editor.getModel();
    if (model && typeof offset === "number") previewAt(model, offset);
  });

  const action = editor.addAction({
    id: "omni-preview-cte-at-cursor",
    label: options.actionLabel,
    keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.Enter],
    contextMenuGroupId: "navigation",
    run: (target) => {
      const model = target.getModel();
      const position = target.getPosition();
      if (model && position) previewAt(model, model.getOffsetAt(position));
    },
  });

  return [codeLens, command, action];
}
