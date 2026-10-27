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
import {
  ConnectionImportError,
  decryptDbeaverCredentials,
  parseConnectionImport,
  relinkDucklakeCatalogs,
  type DbeaverCredentials,
  type ImportCandidate,
  type ImportSource,
} from "../lib/connection-import";
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
  const credentialsInput = useRef<HTMLInputElement>(null);
  // The DBeaver pair can be chosen in either order, so both are kept until the list is rebuilt.
  const dbeaverText = useRef<string | null>(null);
  const dbeaverCredentials = useRef<DbeaverCredentials | undefined>(undefined);
  const [credentialsCount, setCredentialsCount] = useState<number | null>(null);
  const [source, setSource] = useState<ImportSource>("omni-sql");
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const sourceInfo = SOURCES.find((option) => option.value === source)!;

  const forgetFiles = () => {
    dbeaverText.current = null;
    dbeaverCredentials.current = undefined;
    setCredentialsCount(null);
    setCandidates(null);
    setSelected(new Set());
    setError(null);
    setImportedCount(null);
  };

  useEffect(() => {
    if (!open) return;
    forgetFiles();
    setBusy(false);
  }, [open]);

  const chooseSource = (next: ImportSource) => {
    setSource(next);
    forgetFiles();
  };

  const showCandidates = (contents: string) => {
    const parsed = parseConnectionImport(source, contents, connections, dbeaverCredentials.current);
    setCandidates(parsed);
    // Duplicates stay visible but unchecked so re-importing the same file is a no-op by default.
    setSelected(new Set(parsed.filter((candidate) => candidate.status === "ready").map((candidate) => candidate.sourceId)));
  };

  const failWith = (failure: unknown) => {
    if (!(failure instanceof ConnectionImportError)) setError(String(failure));
    else if (failure.code === "newer-version") setError(t("importNewerVersion"));
    else if (failure.code === "invalid-credentials") setError(t("dbeaverInvalidCredentials"));
    else setError(t(source === "dbeaver" ? "dbeaverInvalidFile" : "importInvalidOmniSqlFile"));
  };

  const loadFile = async (file: File) => {
    setError(null);
    setImportedCount(null);
    try {
      const contents = await file.text();
      if (source === "dbeaver") dbeaverText.current = contents;
      showCandidates(contents);
    } catch (failure) {
      setCandidates(null);
      failWith(failure);
    }
  };

  const loadCredentials = async (file: File) => {
    setError(null);
    setImportedCount(null);
    try {
      const credentials = await decryptDbeaverCredentials(await file.arrayBuffer());
      dbeaverCredentials.current = credentials;
      setCredentialsCount(credentials.size);
      if (dbeaverText.current !== null) showCandidates(dbeaverText.current);
    } catch (failure) {
      failWith(failure);
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
          ...(candidate.password ? { password: candidate.password } : {}),
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
      // Decrypted credentials do not outlive the import.
      dbeaverText.current = null;
      dbeaverCredentials.current = undefined;
      setCredentialsCount(null);
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
          <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t(source === "dbeaver" ? "dbeaverPasswordsHint" : "importPasswordsHint")}</Text>
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
          <input
            ref={credentialsInput}
            type="file"
            accept=".json,application/json"
            aria-label={t("dbeaverChooseCredentials")}
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void loadCredentials(file);
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => fileInput.current?.click()} disabled={busy}>{t(sourceInfo.file)}</Button>
            {source === "dbeaver" && <Button onClick={() => credentialsInput.current?.click()} disabled={busy}>{t("dbeaverChooseCredentials")}</Button>}
          </div>
          {source === "dbeaver" && credentialsCount !== null && <Text size={200} role="status">{t("dbeaverCredentialsLoaded").replace("{count}", String(credentialsCount))}</Text>}
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
