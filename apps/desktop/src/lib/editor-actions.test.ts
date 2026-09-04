import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FORMATTER_SETTINGS } from "./format-sql";
import { createEditorActions } from "./editor-actions";

type Action = { id: string; label: string; keybindings?: number[]; run: () => void };

function registerActions(keybinding?: string) {
  const actions: Action[] = [];
  const monaco = {
    KeyMod: { CtrlCmd: 1, Shift: 2, Alt: 4 },
    KeyCode: { Enter: 8, KeyS: 16, KeyF: 32 },
  };
  const editor = { addAction: (action: Action) => actions.push(action) };
  const callbacks = [vi.fn(), vi.fn(), vi.fn(), vi.fn()].map((current) => ({ current }));

  createEditorActions(
    monaco as never,
    editor as never,
    callbacks[0]!,
    callbacks[1]!,
    callbacks[2]!,
    callbacks[3]!,
    keybinding === undefined ? undefined : { ...DEFAULT_FORMATTER_SETTINGS, keybinding },
  );
  return { actions, callbacks };
}

describe("createEditorActions", () => {
  it("registers executable run, save, and default format actions", () => {
    const { actions, callbacks } = registerActions();

    expect(actions.map(({ id }) => id)).toEqual(["omni-run-query", "omni-run-all", "omni-save-tab", "omni-format-sql"]);
    expect(actions.slice(0, 2).map(({ label }) => label)).toEqual([
      "Executar instrução SQL atual",
      "Executar todas as instruções SQL",
    ]);
    expect(actions.at(-1)).toMatchObject({ label: "Formatar SQL" });
    actions.forEach(({ run }) => run());
    expect(callbacks.map(({ current }) => current)).toEqual([expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function)]);
    expect(callbacks.map(({ current }) => current.mock.calls)).toEqual([[[]], [[]], [[]], [[]]]);
  });

  it("uses configured modifier and key code only when the key is supported", () => {
    const configured = registerActions("Ctrl+Alt+Shift+F");
    expect(configured.actions.at(-1)).toMatchObject({
      label: "Formatar SQL (Ctrl+Alt+Shift+F)",
      keybindings: [39],
    });
    configured.actions.at(-1)?.run();
    expect(configured.callbacks[3]?.current).toHaveBeenCalledOnce();

    const unsupported = registerActions("Ctrl+Unknown");
    expect(unsupported.actions.at(-1)).toMatchObject({ label: "Formatar SQL" });
  });
});
