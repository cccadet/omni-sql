import { useCallback, useEffect, useState } from "react";

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  queryLimit: number;
  connectionId: string | null;
  filePath: string | null;
  savedSql: string | null;
  error: string | null;
}

const SESSION_KEY = "omni-sql:session";

function makeId() {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function makeTab(partial?: Partial<QueryTab>): QueryTab {
  return {
    id: partial?.id ?? makeId(),
    title: partial?.title ?? "Query",
    sql: partial?.sql ?? "SELECT 1",
    queryLimit: partial?.queryLimit ?? 1000,
    connectionId: partial?.connectionId ?? null,
    filePath: partial?.filePath ?? null,
    savedSql: partial?.savedSql ?? null,
    error: null,
  };
}

interface StoredSession {
  tabs: QueryTab[];
  activeTabId: string;
  counter: number;
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // localStorage indisponível/cheio — sessão só não persiste.
  }
}

export function useSession() {
  const initial = loadSession();
  const [tabs, setTabs] = useState<QueryTab[]>(initial?.tabs ?? [makeTab({ title: "Query 1" })]);
  const [activeTabId, setActiveTabId] = useState<string>(initial?.activeTabId ?? tabs[0]!.id);
  const [counter, setCounter] = useState(initial?.counter ?? 1);

  useEffect(() => {
    saveSession({ tabs, activeTabId, counter });
  }, [tabs, activeTabId, counter]);

  const addTab = useCallback((connectionId?: string | null) => {
    setCounter((c) => c + 1);
    const newTab = makeTab({ title: `Query ${counter + 1}`, connectionId: connectionId ?? null });
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [counter]);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) {
          const fresh = makeTab({ title: "Query 1" });
          next.push(fresh);
          setActiveTabId(fresh.id);
        } else if (activeTabId === id) {
          setActiveTabId(next[0]!.id);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const selectTab = useCallback((id: string) => setActiveTabId(id), []);

  const updateTabSql = useCallback((id: string, sql: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, sql } : t)));
  }, []);

  const renameTab = useCallback((id: string, title: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  const updateTab = useCallback((id: string, partial: Partial<QueryTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...partial } : t)));
  }, []);

  return { tabs, activeTabId, setTabs, addTab, closeTab, selectTab, updateTabSql, renameTab, updateTab };
}
