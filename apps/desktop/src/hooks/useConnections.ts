import { useCallback, useState } from "react";
import { backend, type ConnectionEntry } from "../lib/backend";
import { sortByName } from "../lib/sort-by-name";

export function useConnections() {
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await backend.call<{ configs: ConnectionEntry[] }>("connection.list", {});
      setConnections(sortByName(result.configs, (connection) => connection.label));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { connections, loading, error, loadConnections };
}
