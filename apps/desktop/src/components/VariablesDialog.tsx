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

export interface VariablesDialogProps {
  open: boolean;
  variables: string[];
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}

export function VariablesDialog({ open, variables, onClose, onSubmit }: VariablesDialogProps) {
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
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Variáveis da query</DialogTitle>
          <DialogContent>
            {variables.length === 0 ? (
              <Text>Nenhuma variável para preencher.</Text>
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
                      placeholder={`Valor para :${name}`}
                      autoComplete="off"
                    />
                  </div>
                ))}
              </div>
            )}
            <Text size={200} style={{ color: tokens.colorNeutralForeground2, marginTop: 12, display: "block" }}>
              Os valores serão interpolados como literais de texto (ex.: <code>:nome</code> vira{" "}
              <code>&apos;valor&apos;</code>).
            </Text>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary" onClick={onClose}>
                Cancelar
              </Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={handleSubmit} disabled={!isComplete}>
              Executar
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
