import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  Input,
  Label,
  Select,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  DEFAULT_FORMATTER_SETTINGS,
  formatKeybindingForDisplay,
  formatSql,
  isValidKeybinding,
  type FormatterSettings,
} from "../lib/format-sql";
import type { DialectId } from "@omni-sql/ts-types";

export interface FormatSettingsProps {
  open: boolean;
  dialect: DialectId;
  settings: FormatterSettings;
  onClose: () => void;
  onSave: (settings: FormatterSettings) => void;
}

const keywordCaseOptions = [
  { value: "preserve", label: "Preservar" },
  { value: "upper", label: "MAIÚSCULAS" },
  { value: "lower", label: "minúsculas" },
];

const indentStyleOptions = [
  { value: "standard", label: "Padrão" },
  { value: "tabularLeft", label: "Tabular à esquerda" },
  { value: "tabularRight", label: "Tabular à direita" },
];

const logicalOperatorOptions = [
  { value: "before", label: "Antes" },
  { value: "after", label: "Depois" },
];

const PREVIEW_SQL = `SELECT id, name, email FROM users WHERE active = 1 AND created_at >= '2024-01-01' ORDER BY created_at DESC LIMIT 100;`;

export function FormatSettings({ open, dialect, settings, onClose, onSave }: FormatSettingsProps) {
  const [draft, setDraft] = useState<FormatterSettings>(() => ({ ...settings }));

  const keybindingError = useMemo(
    () => (isValidKeybinding(draft.keybinding) ? null : "Atalho inválido. Use pelo menos um modificador."),
    [draft.keybinding],
  );

  const preview = useMemo(() => {
    try {
      return formatSql(PREVIEW_SQL, dialect, draft);
    } catch (e) {
      return `Erro no preview: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [dialect, draft]);

  const update = <K extends keyof FormatterSettings>(key: K, value: FormatterSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (keybindingError) return;
    onSave(draft);
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface style={{ maxWidth: 720 }}>
        <form onSubmit={handleSubmit}>
          <DialogTitle>Configurações do formatador SQL</DialogTitle>
          <DialogBody style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Label>Atalho</Label>
              <Input
                value={draft.keybinding}
                onChange={(_, data) => update("keybinding", data.value)}
                placeholder="Ctrl+Alt+L"
                style={{ borderColor: keybindingError ? tokens.colorPaletteRedBorder1 : undefined }}
              />
              {keybindingError ? (
                <Text style={{ color: tokens.colorPaletteRedForeground1, fontSize: 12 }}>{keybindingError}</Text>
              ) : (
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                  Exemplos: Ctrl+Alt+L, Cmd+Shift+F, Ctrl+Shift+I
                </Text>
              )}
              <div style={{ marginTop: 4 }}>
                Exibido como: <kbd>{formatKeybindingForDisplay(draft.keybinding)}</kbd>
              </div>
            </div>

            <div>
              <Label style={{ display: "block", marginBottom: 8 }}>Capitalização</Label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {[
                  ["keywordCase", "Palavras-chave"],
                  ["identifierCase", "Identificadores"],
                  ["dataTypeCase", "Tipos de dados"],
                  ["functionCase", "Funções"],
                ].map(([key, label]) => (
                  <Label key={key}>
                    {label}
                    <Select
                      value={String(draft[key as keyof FormatterSettings])}
                      onChange={(_, data) => update(key as keyof FormatterSettings, data.value as never)}
                      style={{ display: "block", marginTop: 4 }}
                    >
                      {keywordCaseOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </Label>
                ))}
              </div>
            </div>

            <div>
              <Label style={{ display: "block", marginBottom: 8 }}>Layout</Label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <Label>
                  Estilo de indentação
                  <Select value={draft.indentStyle} onChange={(_, data) => update("indentStyle", data.value as FormatterSettings["indentStyle"])} style={{ display: "block", marginTop: 4 }}>
                    {indentStyleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </Label>
                <Label>
                  Largura da expressão
                  <Input type="number" min={20} max={200} value={String(draft.expressionWidth)} onChange={(_, data) => update("expressionWidth", Number(data.value))} style={{ marginTop: 4 }} />
                </Label>
                <Label>
                  Linhas entre queries
                  <Input type="number" min={0} max={10} value={String(draft.linesBetweenQueries)} onChange={(_, data) => update("linesBetweenQueries", Number(data.value))} style={{ marginTop: 4 }} />
                </Label>
                <Label>
                  Quebra do AND/OR
                  <Select value={draft.logicalOperatorNewline} onChange={(_, data) => update("logicalOperatorNewline", data.value as FormatterSettings["logicalOperatorNewline"])} style={{ display: "block", marginTop: 4 }}>
                    {logicalOperatorOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </Label>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center" }}>
                <Label>
                  Largura do tab
                  <Input type="number" min={1} max={8} value={String(draft.tabWidth)} onChange={(_, data) => update("tabWidth", Number(data.value))} style={{ width: 80, marginTop: 4 }} />
                </Label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={draft.useTabs} onChange={(e) => update("useTabs", e.target.checked)} />
                  Usar tabs
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={draft.denseOperators} onChange={(e) => update("denseOperators", e.target.checked)} />
                  Operadores densos
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={draft.newlineBeforeSemicolon} onChange={(e) => update("newlineBeforeSemicolon", e.target.checked)} />
                  Nova linha antes do ;
                </label>
              </div>
            </div>

            <div>
              <Label>Preview ({dialect})</Label>
              <pre
                style={{
                  background: tokens.colorNeutralBackground1,
                  border: `1px solid ${tokens.colorNeutralStroke1}`,
                  borderRadius: 4,
                  padding: 10,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 12,
                  maxHeight: 220,
                  overflow: "auto",
                }}
              >
                {preview}
              </pre>
            </div>
          </DialogBody>
          <DialogActions>
            <Button type="button" onClick={() => setDraft(DEFAULT_FORMATTER_SETTINGS)}>
              Restaurar padrão
            </Button>
            <div style={{ flex: 1 }} />
            <Button type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" appearance="primary" disabled={!!keybindingError}>
              Salvar
            </Button>
          </DialogActions>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
