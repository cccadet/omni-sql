import { assert, test, vi } from "vitest";
import { createEditorActions } from "./editor-actions";

test("editor actions invoke latest run callback", () => {
  const initialRun = vi.fn();
  const latestRun = vi.fn();
  const runRef = { current: initialRun as (() => void) | undefined };
  const editor = { addAction: vi.fn() };
  const monacoInstance = {
    KeyMod: { CtrlCmd: 1, Shift: 2, Alt: 4 },
    KeyCode: { Enter: 8, KeyS: 9 },
  } as never;

  createEditorActions(monacoInstance, editor as never, runRef, { current: undefined }, { current: undefined }, { current: undefined });
  runRef.current = latestRun;

  const runAction = editor.addAction.mock.calls[0]?.[0] as { run: () => void };
  runAction.run();
  assert.equal(initialRun.mock.calls.length, 0);
  assert.equal(latestRun.mock.calls.length, 1);
});
