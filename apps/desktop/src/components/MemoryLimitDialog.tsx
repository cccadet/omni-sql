import { useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, MessageBar, MessageBarBody, Select, Text } from "@fluentui/react-components";
import { useLanguage } from "../i18n";
import { ANALYSIS_MEMORY_LIMIT_OPTIONS_MB, formatMemoryLimit } from "../lib/analysis-memory";

interface MemoryLimitDialogProps {
  readonly memoryLimitMb: number;
  readonly onClose: () => void;
  /** Applies the new limit; a rejection keeps the dialog open with the error. */
  readonly onSave: (memoryLimitMb: number) => Promise<void>;
}

export function MemoryLimitDialog({ memoryLimitMb, onClose, onSave }: MemoryLimitDialogProps) {
  const { t } = useLanguage();
  const [choice, setChoice] = useState(memoryLimitMb);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(choice);
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open && !saving) onClose(); }}>
      <DialogSurface className="omni-standard-dialog">
        <DialogBody className="omni-dialog-body">
          <DialogTitle>{t("analysisMemoryLimitTitle")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label={t("analysisMemoryLimit")}>
              <Select autoFocus value={String(choice)} disabled={saving} onChange={(_, data) => setChoice(Number(data.value))}>
                {ANALYSIS_MEMORY_LIMIT_OPTIONS_MB.map((option) => <option key={option} value={option}>{formatMemoryLimit(option)}</option>)}
              </Select>
            </Field>
            <Text size={200}>{t("analysisMemoryLimitHint")}</Text>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions>
            <Button disabled={saving} onClick={onClose}>{t("cancel")}</Button>
            <Button appearance="primary" disabled={saving || choice === memoryLimitMb} onClick={() => { void save(); }}>{t("common.save")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
