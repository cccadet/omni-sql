import { useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Text,
  tokens,
} from "@fluentui/react-components";
import { backend, type ConnectionEntry, type ConnectionGroup } from "../lib/backend";
import { ConnectionImportError, parseConnectionImport, relinkDucklakeCatalogs, type ImportCandidate, type ImportSource } from "../lib/connection-import";
import { DIALECT_LABELS } from "../lib/dialect-labels";
import { useLanguage, type TranslationKey } from "../i18n";

const SOURCES: readonly { value: ImportSource; label: TranslationKey; hint: TranslationKey; location: TranslationKey; file: TranslationKey }[] = [
  { value: "omni-sql", label: "importSourceOmniSql", hint: "importOmniSqlHint", location: "importOmniSqlLocation", file: "importChooseOmniSqlFile" },
  { value: "dbeaver", label: "importSourceDbeaver", hint: "dbeaverImportHint", location: "dbeaverImportLocation", file: "dbeaverChooseFile" },
];

export interface ConnectionImportDialogProps {
  open: boolean;
  connections: readonly ConnectionEntry[];
  groups: readonly ConnectionGroup[];
  onClose: () => void;
  onImported: () => Promise<void>;
}

export function ConnectionImportDialog({ open, connections, groups, onClose, onImported }: ConnectionImportDialogProps) {
  const { t } = useLanguage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource>("omni-sql");
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const sourceInfo = SOURCES.find((option) => option.value === source)!;

  useEffect(() => {
    if (!open) return;
    setCandidates(null);
    setSelected(new Set());
    setBusy(false);
    setError(null);
    setImportedCount(null);
  }, [open]);

  const chooseSource = (next: ImportSource) => {
    setSource(next);
    setCandidates(null);
    setSelected(new Set());
    setError(null);
    setImportedCount(null);
  };

  const loadFile = async (file: File) => {
    setError(null);
    setImportedCount(null);
    try {
      const parsed = parseConnectionImport(source, await file.text(), connections);
      setCandidates(parsed);
      // Duplicates stay visible but unchecked so re-importing the same file is a no-op by default.
      setSelected(new Set(parsed.filter((candidate) => candidate.status === "ready").map((candidate) => candidate.sourceId)));
    } catch (failure) {
      setCandidates(null);
      if (!(failure instanceof ConnectionImportError)) setError(String(failure));
      else setError(failure.code === "newer-version" ? t("importNewerVersion") : t(source === "dbeaver" ? "dbeaverInvalidFile" : "importInvalidOmniSqlFile"));
    }
  };

  const toggle = (sourceId: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(sourceId); else next.delete(sourceId);
    return next;
  });

  const runImport = async () => {
    if (!candidates) return;
    setBusy(true);
    setError(null);
    let count = 0;
    try {
      const groupIds = new Map(groups.map((group) => [group.name.toLocaleLowerCase(), group.id]));
      const newIds = new Map<string, string>();
      // S3 connections go last so their DuckLake catalogs can point at PostgreSQL connections from the same file.
      const chosen = candidates.filter((candidate) => candidate.config && selected.has(candidate.sourceId))
        .sort((left, right) => Number(left.config!.dialect === "s3") - Number(right.config!.dialect === "s3"));
      for (const candidate of chosen) {
        const id = `conn-${crypto.randomUUID()}`;
        const { connectionId } = await backend.call<{ connectionId: string }>("connection.add", {
          config: { ...relinkDucklakeCatalogs(candidate.config!, newIds), id },
        });
        newIds.set(candidate.sourceId, connectionId);
        if (candidate.folder) {
          let groupId = groupIds.get(candidate.folder.toLocaleLowerCase());
          if (!groupId) {
            const { group } = await backend.call<{ group: ConnectionGroup }>("connectionGroup.create", { name: candidate.folder });
            groupId = group.id;
            groupIds.set(candidate.folder.toLocaleLowerCase(), groupId);
          }
          await backend.call("connection.move", { connectionId, groupId });
        }
        count += 1;
      }
      setImportedCount(count);
      setCandidates(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      if (count > 0) setImportedCount(count);
    } finally {
      setBusy(false);
      if (count > 0) await onImported().catch(() => undefined);
    }
  };

  const statusText = (candidate: ImportCandidate) => {
    if (candidate.status === "duplicate") return t("importAlreadyExists");
    if (candidate.status === "unsupported") {
      if (candidate.unsupportedReason === "address") return t("dbeaverMissingAddress");
      if (candidate.unsupportedReason === "invalid") return t("importInvalidEntry");
      return t("importUnsupportedType").replace("{driver}", candidate.driver);
    }
    const dialect = candidate.config?.dialect;
    return dialect && dialect !== "s3" && dialect !== "odbc" && dialect !== "mongodb" && !candidate.config?.user ? t("importNeedsUser") : "";
  };

  const selectedCount = candidates?.filter((candidate) => candidate.config && selected.has(candidate.sourceId)).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}>
      <DialogSurface className="omni-standard-dialog">
        <DialogBody className="omni-dialog-body">
          <DialogTitle>{t("importConnectionsTitle")}</DialogTitle>
          <div role="radiogroup" aria-label={t("importSource")} className="omni-segmented" style={{ justifySelf: "start", alignSelf: "flex-start" }}>
            {SOURCES.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={source === option.value} disabled={busy} onClick={() => chooseSource(option.value)}>
                {t(option.label)}
              </button>
            ))}
          </div>
          <Text>{t(sourceInfo.hint)}</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground2, overflowWrap: "anywhere" }}>{t(sourceInfo.location)}</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("importPasswordsHint")}</Text>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label={t(sourceInfo.file)}
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void loadFile(file);
            }}
          />
          <div>
            <Button onClick={() => fileInput.current?.click()} disabled={busy}>{t(sourceInfo.file)}</Button>
          </div>
          {candidates && (candidates.length === 0 ? <Text>{t("importNoConnections")}</Text> : (
            <div className="connection-schema-list" style={{ maxHeight: 280 }}>
              {candidates.map((candidate) => {
                const note = statusText(candidate);
                const description = [candidate.config ? DIALECT_LABELS[candidate.config.dialect] ?? candidate.config.dialect : undefined, candidate.folder].filter(Boolean).join(" · ");
                return (
                  <div className={`connection-schema-row${selected.has(candidate.sourceId) ? " is-selected" : ""}`} key={candidate.sourceId}>
                    <Checkbox
                      label={candidate.label}
                      checked={selected.has(candidate.sourceId)}
                      disabled={!candidate.config || busy}
                      onChange={(_, data) => toggle(candidate.sourceId, data.checked === true)}
                    />
                    <Text size={200} style={{ color: tokens.colorNeutralForeground2, textAlign: "right" }}>
                      {description}{description && note && <br />}{note}
                    </Text>
                  </div>
                );
              })}
            </div>
          ))}
          {importedCount !== null && <Text role="status">{t("importedConnections").replace("{count}", String(importedCount))}</Text>}
          {error && <Text role="alert" style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}
        </DialogBody>
        <DialogActions className="omni-dialog-actions">
          <Button appearance="subtle" onClick={onClose} disabled={busy}>{importedCount !== null && !candidates ? t("close") : t("cancel")}</Button>
          {candidates && candidates.length > 0 && (
            <Button appearance="primary" onClick={() => void runImport()} disabled={busy || selectedCount === 0}>
              {busy ? t("importing") : t("importSelected").replace("{count}", String(selectedCount))}
            </Button>
          )}
        </DialogActions>
      </DialogSurface>
    </Dialog>
  );
}
