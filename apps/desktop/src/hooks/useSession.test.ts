import { afterEach, beforeEach, test, assert, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSession } from "./useSession";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("localStorage", window.localStorage);
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

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

test("useSession: CAS accepts one revision and rejects concurrent edit", () => {
  const { result } = renderHook(() => useSession());
  const id = result.current.tabs[0]!.id;
  const revision = result.current.getTabRevision(id);
  let first = false;
  let second = false;

  act(() => {
    first = result.current.compareAndSwapTabSql(id, revision, "SELECT 1", "SELECT first");
    second = result.current.compareAndSwapTabSql(id, revision, "SELECT 1", "SELECT second");
  });

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(result.current.tabs[0]!.sql, "SELECT first");
});

test("useSession: failed CAS guard never mutates tab", () => {
  const { result } = renderHook(() => useSession());
  const id = result.current.tabs[0]!.id;
  const revision = result.current.getTabRevision(id);

  let applied = true;
  act(() => {
    applied = result.current.compareAndSwapTabSql(id, revision, "SELECT 1", "SELECT blocked", () => false);
  });

  assert.equal(applied, false);
  assert.equal(result.current.tabs[0]!.sql, "SELECT 1");
});
