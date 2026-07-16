import { test, assert } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSession } from "./useSession";

test("useSession: starts with one tab and can add/close tabs", () => {
  const { result } = renderHook(() => useSession());

  assert.equal(result.current.tabs.length, 1);
  assert.equal(result.current.activeTabId, result.current.tabs[0]!.id);

  act(() => {
    result.current.addTab();
  });

  assert.equal(result.current.tabs.length, 2);
  assert.equal(result.current.activeTabId, result.current.tabs[1]!.id);

  const firstId = result.current.tabs[0]!.id;
  act(() => {
    result.current.closeTab(firstId);
  });

  assert.equal(result.current.tabs.length, 1);
  assert.notEqual(result.current.activeTabId, firstId);
});

test("useSession: updateTabSql updates sql and preserves other fields", () => {
  const { result } = renderHook(() => useSession());
  const id = result.current.tabs[0]!.id;

  act(() => {
    result.current.updateTabSql(id, "SELECT 42");
  });

  assert.equal(result.current.tabs[0]!.sql, "SELECT 42");
  assert.equal(result.current.tabs[0]!.title, "Query 1");
});
