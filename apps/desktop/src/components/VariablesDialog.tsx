import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Text,
  tokens,
} from "@fluentui/react-components";
import { useLanguage } from "../i18n";

export interface VariablesDialogProps {
  open: boolean;
  variables: string[];
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}

export function VariablesDialog({ open, variables, onClose, onSubmit }: VariablesDialogProps) {
  const { t } = useLanguage();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setValues((prev) => {
        const next: Record<string, string> = {};
        for (const v of variables) {
          next[v] = prev[v] ?? "";
        }
        return next;
      });
    }
  }, [open, variables]);

  const handleSubmit = useCallback(() => {
    onSubmit(values);
  }, [onSubmit, values]);

  const isComplete = useMemo(() => variables.every((v) => (values[v] ?? "").trim().length > 0), [variables, values]);

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className="omni-standard-dialog omni-variables-dialog">
        <DialogBody className="omni-dialog-body">
          <DialogTitle>{t("run")}</DialogTitle>
          <DialogContent className="omni-dialog-content">
            {variables.length === 0 ? (
              <Text>{t("noResults")}</Text>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 280 }}>
                {variables.map((name) => (
                  <div key={name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <Label htmlFor={`var-${name}`} required>
                      :{name}
                    </Label>
                    <Input
                      id={`var-${name}`}
                      value={values[name] ?? ""}
                      onChange={(_, data) => setValues((prev) => ({ ...prev, [name]: data.value }))}
                      placeholder={`${t("valueFor")} :${name}`}
                      autoComplete="off"
                    />
                  </div>
                ))}
              </div>
            )}
            <Text size={200} style={{ color: tokens.colorNeutralForeground2, marginTop: 12, display: "block" }}>
              {t("variableValuesHint")}
            </Text>
          </DialogContent>
          <DialogActions className="omni-dialog-actions">
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary" onClick={onClose}>
                {t("cancel")}
              </Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={handleSubmit} disabled={!isComplete}>
              {t("run")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
