import { useCallback, useState } from "react";

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
}

function makeId() {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useSession() {
  const [tabs, setTabs] = useState<QueryTab[]>([{ id: makeId(), title: "Query 1", sql: "SELECT 1" }]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0]!.id);
  const [counter, setCounter] = useState(1);

  const addTab = useCallback(() => {
    setCounter((c) => c + 1);
    const newTab: QueryTab = { id: makeId(), title: `Query ${counter + 1}`, sql: "SELECT 1" };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [counter]);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) {
          const fresh: QueryTab = { id: makeId(), title: "Query 1", sql: "SELECT 1" };
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

  return { tabs, activeTabId, addTab, closeTab, selectTab, updateTabSql };
}
