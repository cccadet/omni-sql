import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, tokens } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import type { ExecutionRiskAnalysis, ExecutionRiskKind } from "@omni-sql/autocomplete-engine";
import { useLanguage, type TranslationKey } from "../i18n";

const FINDING_KEYS: Record<ExecutionRiskKind, TranslationKey> = {
  truncate: "executionRisk.truncate",
  drop: "executionRisk.drop",
  "delete-without-where": "executionRisk.delete-without-where",
  "update-without-where": "executionRisk.update-without-where",
  "alter-drop": "executionRisk.alter-drop",
};

export interface ExecutionRiskDialogProps {
  analysis: ExecutionRiskAnalysis | null;
  onCancel: () => void;
  onConfirm: (suppressWarningsForConnection: boolean) => void;
}

export function ExecutionRiskDialog({ analysis, onCancel, onConfirm }: ExecutionRiskDialogProps) {
  const { t } = useLanguage();
  const [typedObject, setTypedObject] = useState("");
  const [suppressWarnings, setSuppressWarnings] = useState(false);
  const confirmationObject = analysis?.level === "critical"
    ? analysis.findings.find((finding) => finding.objectName)?.objectName
    : undefined;
  useEffect(() => {
    setTypedObject("");
    setSuppressWarnings(false);
  }, [analysis]);
  const canConfirm = Boolean(analysis) && (!confirmationObject || typedObject === confirmationObject);

  return (
    <Dialog open={analysis !== null} onOpenChange={(_, data) => !data.open && onCancel()}>
      <DialogSurface style={{ width: "min(720px, calc(100vw - 24px))" }}>
        <DialogBody>
          <DialogTitle>{t("destructiveSqlTitle")}</DialogTitle>
          <DialogContent style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0 }}>{analysis?.level === "critical" ? t("destructiveSqlCritical") : t("destructiveSqlWarning")}</p>
            {analysis?.findings.map((finding, index) => (
              <section key={`${finding.start}-${finding.kind}-${index}`} style={{ borderLeft: `3px solid ${finding.level === "critical" ? tokens.colorPaletteRedBorderActive : tokens.colorPaletteDarkOrangeBorderActive}`, paddingLeft: 10 }}>
                <strong>{t(FINDING_KEYS[finding.kind])}</strong>
                <pre style={{ margin: "6px 0 0", padding: 8, maxHeight: 130, overflow: "auto", whiteSpace: "pre-wrap", background: tokens.colorNeutralBackground3 }}>{finding.statement}</pre>
              </section>
            ))}
            {confirmationObject && (
              <Input
                aria-label={t("destructiveSqlTypeObject").replace("{object}", confirmationObject)}
                placeholder={t("destructiveSqlTypeObject").replace("{object}", confirmationObject)}
                value={typedObject}
                onChange={(_, data) => setTypedObject(data.value)}
              />
            )}
            {analysis?.level === "warning" && (
              <Checkbox
                checked={suppressWarnings}
                onChange={(_, data) => setSuppressWarnings(data.checked === true)}
                label={t("destructiveSqlTrustConnection")}
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onCancel}>{t("cancel")}</Button>
            <Button appearance="primary" disabled={!canConfirm} onClick={() => onConfirm(suppressWarnings)}>{t("destructiveSqlConfirm")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
