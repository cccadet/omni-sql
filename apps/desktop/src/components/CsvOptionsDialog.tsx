import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody, Select, Spinner, Text } from "@fluentui/react-components";
import { previewAnalysisCsv, type CsvPreview } from "../lib/analysis";
import { useLanguage } from "../i18n";

function isCsvDelimiterValid(value: string): boolean {
  return value === "\t" || /^[\x20-\x21\x23-\x7e]$/.test(value);
}

interface CsvOptionsDialogProps {
  readonly path?: string;
  readonly onResolve: (delimiter: string | null) => void;
}

export function CsvOptionsDialog({ path, onResolve }: CsvOptionsDialogProps) {
  const { t } = useLanguage();
  const hintId = useId();
  const [choice, setChoice] = useState(",");
  const [custom, setCustom] = useState("");
  const delimiter = choice === "custom" ? custom : choice;
  const valid = isCsvDelimiterValid(delimiter);
  const [response, setResponse] = useState<{ path: string; delimiter: string; preview?: CsvPreview; error?: string } | null>(null);
  const current = response?.path === path && response?.delimiter === delimiter ? response : null;
  const loading = !!path && valid && !current;

  useEffect(() => {
    if (!path || !valid) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void previewAnalysisCsv(path, delimiter).then(
        (preview) => { if (active) setResponse({ path, delimiter, preview }); },
        (error: unknown) => { if (active) setResponse({ path, delimiter, error: error instanceof Error ? error.message : String(error) }); },
      );
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [path, delimiter, valid]);

  const preview = current?.preview;
  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onResolve(null); }}>
      <DialogSurface className={`omni-standard-dialog omni-csv-dialog${path ? " omni-csv-import-dialog" : ""}`}>
        <DialogBody className="omni-dialog-body">
          <DialogTitle>{t(path ? "csvImport" : "csvExportOptions")}</DialogTitle>
          <DialogContent className="omni-csv-content">
            {path && <Text className="omni-csv-file" title={path}>{path.split(/[\\/]/).at(-1)}</Text>}
            <div className="omni-csv-fields">
              <Field label={t("csvDelimiter")}>
                <Select autoFocus value={choice} onChange={(_, data) => setChoice(data.value)}>
                  <option value=",">{t("csvComma")}</option>
                  <option value=";">{t("csvSemicolon")}</option>
                  <option value={"\t"}>{t("csvTab")}</option>
                  <option value="custom">{t("csvCustom")}</option>
                </Select>
              </Field>
              {choice === "custom" && <Field label={t("csvCustomDelimiter")} validationState={valid ? "none" : "error"} validationMessage={!valid ? t("csvInvalidDelimiter") : undefined}>
                <Input value={custom} onChange={(_, data) => setCustom(data.value)} aria-describedby={hintId} />
              </Field>}
            </div>
            <Text id={hintId} size={200}>{t("csvDelimiterHint")}</Text>
            {path ? <>
              <Text size={200}>{t("csvPreviewHint")}</Text>
              {loading && <div className="omni-csv-preview-status" role="status"><Spinner size="small" label={t("csvPreviewLoading")} /></div>}
              {current?.error && <MessageBar intent="error"><MessageBarBody>{t("csvPreviewFailed")} {current.error}</MessageBarBody></MessageBar>}
              {preview && <>
                <Text role="status" size={200}>{t("csvPreviewSummary").replace("{rows}", String(preview.rows.length)).replace("{columns}", String(preview.columns.length)).replace("{more}", preview.rowsMoreAvailable ? t("csvPreviewMore") : "")}</Text>
                {preview.columns.length === 1 && <Text size={200}>{t("csvOneColumnHint")}</Text>}
                <div className="omni-csv-preview" tabIndex={0} role="region" aria-label={t("preview")}>
                  <table>
                    <caption className="omni-csv-caption">{t("preview")}</caption>
                    <thead><tr>{preview.columns.map((name, index) => <th scope="col" key={index} title={name}>{name.length > 300 ? `${name.slice(0, 300)}…` : name}</th>)}</tr></thead>
                    <tbody>{preview.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column} title={value ?? ""}>{value && value.length > 300 ? `${value.slice(0, 300)}…` : value ?? ""}</td>)}</tr>)}</tbody>
                  </table>
                  {preview.rows.length === 0 && <Text className="omni-csv-empty" size={200}>{t("csvPreviewEmpty")}</Text>}
                </div>
              </>}
            </> : <Text size={200}>{t("analysisExportCsvSafe")}</Text>}
          </DialogContent>
          <DialogActions className="omni-csv-actions">
            <Button onClick={() => onResolve(null)}>{t("cancel")}</Button>
            <Button appearance="primary" disabled={!valid || loading} onClick={() => onResolve(delimiter)}>{t(path ? "csvImport" : "csvChooseDestination")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// Both import entry points and all export entry points use this same confirmation flow.
export function useCsvOptions() {
  const [pending, setPending] = useState<{ path?: string; resolve: (delimiter: string | null) => void } | null>(null);
  const pendingRef = useRef(pending);
  const resolve = useCallback((delimiter: string | null) => {
    pendingRef.current?.resolve(delimiter);
    pendingRef.current = null;
    setPending(null);
  }, []);
  useEffect(() => () => { pendingRef.current?.resolve(null); }, []);
  const requestCsvOptions = useCallback((path?: string) => new Promise<string | null>((complete) => {
    pendingRef.current?.resolve(null);
    const next = { path, resolve: complete };
    pendingRef.current = next;
    setPending(next);
  }), []);
  return { requestCsvOptions, csvOptionsDialog: pending ? <CsvOptionsDialog key={pending.path ?? "export"} path={pending.path} onResolve={resolve} /> : null };
}
