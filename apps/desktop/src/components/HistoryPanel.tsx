import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  Text,
  tokens,
} from "@fluentui/react-components";
import { DismissRegular, DeleteRegular, SearchRegular } from "@fluentui/react-icons";

export interface HistoryEntry {
  id: string;
  sql: string;
  connectionId: string | null;
  connectionLabel: string;
  dialect: string | null;
  ranAt: number;
  ok: boolean;
  elapsedMs?: number;
  errorMessage?: string;
}

export interface HistoryPanelProps {
  open: boolean;
  entries: HistoryEntry[];
  onClose: () => void;
  onSelect: (entry: HistoryEntry) => void;
  onClear: () => void;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ backgroundColor: "#264f78", color: "#ffffff", borderRadius: 2, padding: "0 2px" }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function HistoryPanel({ open, entries, onClose, onSelect, onClear }: HistoryPanelProps) {
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "err">("all");
  const [connectionFilter, setConnectionFilter] = useState<string>("__all__");

  const uniqueConnections = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      const key = e.connectionId ?? e.connectionLabel;
      if (!map.has(key)) map.set(key, e.connectionLabel);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter === "ok" && !e.ok) return false;
      if (statusFilter === "err" && e.ok) return false;
      if (connectionFilter !== "__all__") {
        const key = e.connectionId ?? e.connectionLabel;
        if (key !== connectionFilter) return false;
      }
      if (q) {
        const haystack = `${e.sql}\n${e.connectionLabel}\n${e.dialect ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [entries, statusFilter, connectionFilter, searchText]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        zIndex: 50,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
      role="presentation"
    >
      <Card
        style={{
          width: 380,
          maxWidth: "90vw",
          height: "100%",
          borderRadius: 0,
          background: tokens.colorNeutralBackground1,
          borderLeft: `1px solid ${tokens.colorNeutralStroke1}`,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 12px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          }}
        >
          <Text weight="semibold">Histórico de queries</Text>
          <div style={{ display: "flex", gap: 4 }}>
            <Button icon={<DeleteRegular />} appearance="subtle" size="small" onClick={onClear} disabled={entries.length === 0} aria-label="Limpar histórico" />
            <Button icon={<DismissRegular />} appearance="subtle" size="small" onClick={onClose} aria-label="Fechar histórico" />
          </div>
        </div>

        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8, borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}>
          <Input
            placeholder="Buscar no histórico..."
            value={searchText}
            onChange={(_, data) => setSearchText(data.value)}
            contentBefore={<SearchRegular />}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={connectionFilter}
              onChange={(e) => setConnectionFilter(e.target.value)}
              style={{ flex: 1, padding: 4, borderRadius: 4, background: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1 }}
            >
              <option value="__all__">Todas as conexões</option>
              {uniqueConnections.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 4 }}>
              {(["all", "ok", "err"] as const).map((f) => (
                <Button
                  key={f}
                  size="small"
                  appearance={statusFilter === f ? "primary" : "subtle"}
                  onClick={() => setStatusFilter(f)}
                >
                  {f === "all" ? "Todas" : f === "ok" ? "Sucesso" : "Erro"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 6 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground2, padding: "2px 4px 6px" }}>
            {filteredEntries.length} resultado(s)
          </Text>
          {filteredEntries.length === 0 ? (
            <Text size={200} style={{ color: tokens.colorNeutralForeground2, padding: 10 }}>
              {entries.length === 0 ? "Nenhuma query executada ainda." : "Nenhuma entrada corresponde aos filtros."}
            </Text>
          ) : (
            filteredEntries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onSelect(entry)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: tokens.colorNeutralBackground2,
                  border: `1px solid ${tokens.colorNeutralStroke1}`,
                  borderRadius: 4,
                  padding: "6px 8px",
                  marginBottom: 6,
                  cursor: "pointer",
                  color: tokens.colorNeutralForeground1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: tokens.colorNeutralForeground2 }}>
                  <span>{entry.connectionLabel}</span>
                  <span style={{ color: entry.ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>
                    {entry.ok ? "✓" : "✗"}
                  </span>
                  <span>{new Date(entry.ranAt).toLocaleString()}</span>
                </div>
                <pre
                  style={{
                    margin: 0,
                    marginTop: 4,
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 11,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Highlight text={entry.sql.split("\n")[0] ?? ""} query={searchText} />
                </pre>
              </button>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
