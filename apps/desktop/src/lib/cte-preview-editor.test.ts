// @vitest-environment node
import { expect, test, vi } from "vitest";
import type * as monaco from "monaco-editor";
import type { DialectId } from "@omni-sql/ts-types";
import { registerCtePreview } from "./cte-preview-editor";

type LensProvider = Parameters<typeof monaco.languages.registerCodeLensProvider>[1];
type Action = { label: string; contextMenuGroupId?: string; run: (target: unknown) => void };

/** Minimal text model: offsets map to 1-based line/column like Monaco's. */
function fakeModel(text: string, cursorOffset = 0) {
  const positionAt = (offset: number) => {
    const before = text.slice(0, offset).split("\n");
    return { lineNumber: before.length, column: before.at(-1)!.length + 1 };
  };
  return {
    getValue: () => text,
    getPositionAt: positionAt,
    getOffsetAt: (position: { lineNumber: number; column: number }) => {
      const lines = text.split("\n").slice(0, position.lineNumber - 1);
      return lines.reduce((sum, line) => sum + line.length + 1, 0) + position.column - 1;
    },
    cursor: positionAt(cursorOffset),
  };
}

function setup(text: string, dialect: DialectId = "postgres", cursorOffset = 0) {
  const model = fakeModel(text, cursorOffset);
  let provider: LensProvider | undefined;
  let command: ((accessor: unknown, offset?: number) => void) | undefined;
  let action: Action | undefined;
  const monacoInstance = {
    KeyMod: { CtrlCmd: 1, Shift: 2, Alt: 4 },
    KeyCode: { Enter: 8 },
    languages: { registerCodeLensProvider: (_id: string, registered: LensProvider) => { provider = registered; return { dispose: vi.fn() }; } },
    editor: { registerCommand: (_id: string, handler: typeof command) => { command = handler; return { dispose: vi.fn() }; } },
  };
  const editor = {
    getModel: () => model,
    getPosition: () => model.cursor,
    addAction: (registered: Action) => { action = registered; return { dispose: vi.fn() }; },
  };
  const onPreview = vi.fn();
  const options = { languageId: "omni-sql", dialect: { current: dialect }, onPreview: { current: onPreview }, lensLabel: { current: "▶ Preview {name}" }, actionLabel: "Preview CTE results" };
  const disposables = registerCtePreview(monacoInstance as never, editor as never, options);
  const lenses = () => (provider!.provideCodeLenses(model as never, {} as never) as monaco.languages.CodeLensList).lenses;
  return { lenses, runLens: (lens: monaco.languages.CodeLens) => command!(undefined, ...(lens.command!.arguments as [number])), action: () => action!, editor, onPreview, options, disposables };
}

test("shows a lens above every CTE that previews it with the statement-relative offset", () => {
  const sql = "SELECT 1;\nWITH a AS (SELECT 1),\n  b AS (SELECT * FROM a)\nSELECT * FROM b";
  const { lenses, runLens, onPreview, disposables } = setup(sql);

  const found = lenses();
  expect(found.map((lens) => [lens.command?.title, lens.range.startLineNumber, lens.range.startColumn])).toEqual([
    ["▶ Preview a", 2, 6],
    ["▶ Preview b", 3, 3],
  ]);
  expect(disposables).toHaveLength(3);

  runLens(found[1]!);
  const statement = sql.slice(sql.indexOf("WITH"));
  expect(onPreview).toHaveBeenCalledWith(statement, statement.indexOf("b AS"));
});

test("the editor action previews the CTE under the cursor and is offered in the context menu", () => {
  const sql = "WITH a AS (SELECT 1) SELECT * FROM a";
  const { action, editor, onPreview } = setup(sql, "postgres", sql.indexOf("SELECT 1"));

  expect(action()).toMatchObject({ label: "Preview CTE results", contextMenuGroupId: "navigation" });
  action().run(editor);
  expect(onPreview).toHaveBeenCalledWith(sql, sql.indexOf("SELECT 1"));
});

test("no lenses for MongoDB or when nothing handles previews", () => {
  const sql = "WITH a AS (SELECT 1) SELECT * FROM a";
  expect(setup(sql, "mongodb").lenses()).toEqual([]);
  const { lenses, options } = setup(sql);
  (options.onPreview as { current: unknown }).current = undefined;
  expect(lenses()).toEqual([]);
});
