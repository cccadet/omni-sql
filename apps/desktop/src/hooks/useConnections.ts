import { useCallback, useState } from "react";
import type { ConnectionEntry } from "../lib/backend";

export function useConnections() {
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      // TODO: chamar backend.call("connection.list", {}) na Fase 2/3
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { connections, loading, loadConnections };
}
