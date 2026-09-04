import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Text, tokens } from "@fluentui/react-components";
import { ArrowLeftRegular, CopyRegular, DismissRegular, DeleteRegular, SearchRegular } from "@fluentui/react-icons";
import { useLanguage } from "../i18n";

export interface HistoryEntry {
  id: string;
  sql: string;
  ok?: boolean;
  executedAt?: string;
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
  return <>{text.slice(0, idx)}<mark style={{ backgroundColor: "#264f78", color: "#fff", borderRadius: 2, padding: "0 2px" }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
}

export function HistoryPanel({ open, entries, onClose, onClear }: HistoryPanelProps) {
  const { language, t } = useLanguage();
  const [searchText, setSearchText] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!open) setSelectedEntry(null); }, [open]);
  const filteredEntries = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return entries.filter((entry) => !q || entry.sql.toLowerCase().includes(q));
  }, [entries, searchText]);
  if (!open) return null;

  const copySql = async (sql: string, showConfirmation = false) => {
    try {
      await navigator.clipboard.writeText(sql);
      if (showConfirmation) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch { setCopied(false); }
  };
  const formatExecutionTime = (value?: string) => value
    ? new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : t("executionTimeUnknown");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 50, display: "flex", justifyContent: "flex-end" }} onClick={onClose} role="presentation">
      <Card style={{ width: "min(520px, 94vw)", height: "100%", borderRadius: 0, background: tokens.colorNeutralBackground1, borderLeft: `1px solid ${tokens.colorNeutralStroke1}`, display: "flex", flexDirection: "column", boxShadow: "-4px 0 12px rgba(0,0,0,.4)" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}>
          <Text weight="semibold">{selectedEntry ? t("selectedSql") : t("history")}</Text>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {!selectedEntry && <Button icon={<DeleteRegular />} appearance="subtle" size="small" onClick={onClear} disabled={entries.length === 0} aria-label={t("clearHistory")} title={t("clearHistory")} />}
            <Button icon={<DismissRegular />} appearance="subtle" size="small" onClick={onClose} aria-label={t("closeHistory")} title={t("closeHistory")} />
          </div>
        </div>
        {selectedEntry ? (
          <div style={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", gap: 8, borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}>
              <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => setSelectedEntry(null)}>{t("backToHistory")}</Button>
              <Button appearance="primary" icon={<CopyRegular />} onClick={() => void copySql(selectedEntry.sql, true)}>{copied ? t("copied") : t("copySql")}</Button>
            </div>
            <div style={{ padding: 12, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{formatExecutionTime(selectedEntry.executedAt)} · {selectedEntry.ok === undefined ? t("statusUnknown") : selectedEntry.ok ? t("success") : t("failure")}</Text>
              <pre aria-label={t("selectedSql")} tabIndex={0} style={{ margin: 0, padding: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.55, background: tokens.colorNeutralBackground2, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: 4 }}>{selectedEntry.sql}</pre>
              <Text size={200} style={{ color: tokens.colorNeutralForeground2 }} aria-live="polite">{t("copiedQueryHint")}</Text>
            </div>
          </div>
        ) : <>
          <div style={{ padding: 8, borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}><Input placeholder={t("searchHistory")} aria-label={t("searchHistory")} value={searchText} onChange={(_, data) => setSearchText(data.value)} contentBefore={<SearchRegular />} style={{ width: "100%" }} /></div>
          <div style={{ flex: 1, overflow: "auto", padding: 6 }}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground2, padding: "2px 4px 6px" }}>{filteredEntries.length} {t("resultCount")}</Text>
            {filteredEntries.length === 0 ? <div style={{ padding: "32px 16px", textAlign: "center" }}><Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{entries.length === 0 ? t("noQueries") : t("noMatchingHistory")}</Text></div> : filteredEntries.map((entry) => (
              <div key={entry.id} style={{ width: "100%", background: tokens.colorNeutralBackground2, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: 4, marginBottom: 6, color: tokens.colorNeutralForeground1, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                <button onClick={() => setSelectedEntry(entry)} aria-label={`${t("executedSql")}: ${entry.sql}`} style={{ minWidth: 0, border: 0, padding: "8px 4px 8px 8px", textAlign: "left", cursor: "pointer", color: "inherit", background: "transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: tokens.colorNeutralForeground2 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatExecutionTime(entry.executedAt)}</span>
                    {entry.ok !== undefined && <span aria-label={entry.ok ? t("success") : t("failure")} title={entry.ok ? t("success") : t("failure")} style={{ flexShrink: 0, color: entry.ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1, fontWeight: 600 }}>{entry.ok ? "✓" : "✗"}</span>}
                    <span style={{ flexShrink: 0 }}>{entry.sql.split("\n").length} {t("lineCount")}</span>
                  </div>
                  <pre style={{ margin: "4px 0 0", fontFamily: "ui-monospace, monospace", fontSize: 11, overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, lineHeight: 1.4, maxHeight: "4.2em" }}><Highlight text={entry.sql} query={searchText} /></pre>
                </button>
                <Button appearance="subtle" size="small" icon={<CopyRegular />} aria-label={t("copySql")} title={t("copySql")} onClick={() => void copySql(entry.sql)} style={{ alignSelf: "start", margin: 4, flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </>}
      </Card>
    </div>
  );
}
