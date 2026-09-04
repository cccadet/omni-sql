import type * as monaco from "monaco-editor";
import { formatKeybindingForDisplay, parseKeybinding, type FormatterSettings } from "./format-sql";

export type EditorActionCallback = { current: (() => void) | undefined };

export function createEditorActions(monacoInstance: typeof monaco, editor: monaco.editor.IStandaloneCodeEditor, onRun: EditorActionCallback, onRunAll: EditorActionCallback, onSave: EditorActionCallback, onFormat: EditorActionCallback, formatterSettings?: FormatterSettings): void {
  editor.addAction({ id: "omni-run-query", label: "Executar instrução SQL atual", keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter], run: () => onRun.current?.() });
  editor.addAction({ id: "omni-run-all", label: "Executar todas as instruções SQL", keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.Enter], run: () => onRunAll.current?.() });
  editor.addAction({ id: "omni-save-tab", label: "Salvar aba", keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS], run: () => onSave.current?.() });

  const keybinding = formatterSettings?.keybinding;
  if (keybinding) {
    const parsed = parseKeybinding(keybinding);
    const keyCodes = monacoInstance.KeyCode as unknown as Record<string, number | undefined>;
    const keyCode = keyCodes[parsed.key] ?? keyCodes[`Key${parsed.key}`];
    if (keyCode !== undefined) {
      let mod = 0;
      if (parsed.ctrl) mod |= monacoInstance.KeyMod.CtrlCmd;
      if (parsed.alt) mod |= monacoInstance.KeyMod.Alt;
      if (parsed.shift) mod |= monacoInstance.KeyMod.Shift;
      editor.addAction({ id: "omni-format-sql", label: `Formatar SQL (${formatKeybindingForDisplay(keybinding)})`, keybindings: [mod | keyCode], run: () => onFormat.current?.() });
      return;
    }
  }
  editor.addAction({ id: "omni-format-sql", label: "Formatar SQL", run: () => onFormat.current?.() });
}
