import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  Text,
  tokens,
} from "@fluentui/react-components";
import { ArrowLeftRegular, CopyRegular, DismissRegular, DeleteRegular, SearchRegular } from "@fluentui/react-icons";

export interface HistoryEntry {
  id: string;
  sql: string;
  /** Missing for older SQL-only entries. */
  ok?: boolean;
}

export interface HistoryPanelProps {
  open: boolean;
  entries: HistoryEntry[];
  onClose: () => void;
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

export function HistoryPanel({ open, entries, onClose, onClear }: HistoryPanelProps) {
  const [searchText, setSearchText] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setSelectedEntry(null);
  }, [open]);

  const filteredEntries = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return entries.filter((e) => !q || e.sql.toLowerCase().includes(q));
  }, [entries, searchText]);

  if (!open) return null;

  const copySelected = async () => {
    if (!selectedEntry) return;
    try {
      await navigator.clipboard.writeText(selectedEntry.sql);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

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
          <Text weight="semibold">{selectedEntry ? "Detalhe da query" : "Histórico de queries"}</Text>
          <div style={{ display: "flex", gap: 4 }}>
            {!selectedEntry && <Button icon={<DeleteRegular />} appearance="subtle" size="small" onClick={onClear} disabled={entries.length === 0} aria-label="Limpar histórico" />}
            <Button icon={<DismissRegular />} appearance="subtle" size="small" onClick={onClose} aria-label="Fechar histórico" />
          </div>
        </div>

        {selectedEntry ? (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
            <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => setSelectedEntry(null)} style={{ alignSelf: "flex-start" }}>
              Voltar ao histórico
            </Button>
            <pre
              aria-label="Query selecionada"
              tabIndex={0}
              style={{ margin: 0, padding: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.5, background: tokens.colorNeutralBackground2, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: 4 }}
            >
              {selectedEntry.sql}
            </pre>
            <Button appearance="primary" icon={<CopyRegular />} onClick={() => void copySelected()}>
              {copied ? "Copiada" : "Copiar query"}
            </Button>
            <Text size={200} style={{ color: tokens.colorNeutralForeground2 }} aria-live="polite">
              A query copiada não altera a aba atual.
            </Text>
          </div>
        ) : <>
        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8, borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}>
          <Input
            placeholder="Buscar no histórico..."
            value={searchText}
            onChange={(_, data) => setSearchText(data.value)}
            contentBefore={<SearchRegular />}
            style={{ width: "100%" }}
          />
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
                onClick={() => setSelectedEntry(entry)}
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
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 10, color: tokens.colorNeutralForeground2 }}>
                  <span>SQL executado</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {entry.ok !== undefined && (
                      <span
                        aria-label={entry.ok ? "Sucesso" : "Falha"}
                        title={entry.ok ? "Sucesso" : "Falha"}
                        style={{ color: entry.ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1, fontWeight: 600 }}
                      >
                        {entry.ok ? "✓" : "✗"}
                      </span>
                    )}
                    <span>{entry.sql.split("\n").length} linha(s)</span>
                  </span>
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
        </>}
      </Card>
    </div>
  );
}
