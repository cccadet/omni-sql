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
  Tab,
  TabList,
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
import { useLanguage } from "../i18n";

export interface FormatSettingsProps {
  open: boolean;
  dialect: DialectId;
  settings: FormatterSettings;
  onClose: () => void;
  onSave: (settings: FormatterSettings) => void;
}

const keywordCaseOptions = [
  { value: "preserve", label: "Preserve" },
  { value: "upper", label: "UPPERCASE" },
  { value: "lower", label: "lowercase" },
];

const indentStyleOptions = [
  { value: "standard", label: "Standard" },
  { value: "tabularLeft", label: "Tabular left" },
  { value: "tabularRight", label: "Tabular right" },
];

const logicalOperatorOptions = [
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
];

const PREVIEW_SQL = `SELECT id, name, email FROM users WHERE active = 1 AND created_at >= '2024-01-01' ORDER BY created_at DESC LIMIT 100;`;

export function FormatSettings({ open, dialect, settings, onClose, onSave }: FormatSettingsProps) {
  const { t, language, setLanguage } = useLanguage();
  const [draft, setDraft] = useState<FormatterSettings>(() => ({ ...settings }));
  const [section, setSection] = useState<"formatting" | "language">("formatting");

  const keybindingError = useMemo(
    () => (isValidKeybinding(draft.keybinding) ? null : t("invalidShortcut")),
    [draft.keybinding, t],
  );

  const preview = useMemo(() => {
    try {
      return formatSql(PREVIEW_SQL, dialect, draft);
    } catch (e) {
      return `${t("error")}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [dialect, draft, t]);

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
      <DialogSurface className="omni-settings-dialog">
        <form onSubmit={handleSubmit} style={{ display: "flex", flex: "1 1 auto", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <DialogTitle className="omni-settings-title">{t("formatSettingsTitle")}</DialogTitle>
          <TabList
            selectedValue={section}
            onTabSelect={(_, data) => setSection(data.value as "formatting" | "language")}
            aria-label={t("settingsSections")}
            className="omni-settings-tabs"
          >
            <Tab value="formatting">{t("formattingSettingsTab")}</Tab>
            <Tab value="language">{t("languageSettingsTab")}</Tab>
          </TabList>
          <DialogBody className="omni-settings-body">
            {section === "language" ? (
              <div className="omni-settings-section omni-settings-language">
              <Label>
                {t("language")}
                <Select
                  aria-label={t("language")}
                  value={language}
                  onChange={(_, data) => setLanguage(data.value as "en" | "pt-BR")}
                  style={{ display: "block", marginTop: 4, maxWidth: 240 }}
                >
                  <option value="en">{t("english")}</option>
                  <option value="pt-BR">{t("portugueseBrazil")}</option>
                </Select>
              </Label>
              </div>
            ) : (
              <div className="omni-settings-section">
            <section className="omni-settings-card">
              <Label>{t("shortcut")}</Label>
              <Input
                aria-label={t("shortcut")}
                value={draft.keybinding}
                onChange={(_, data) => update("keybinding", data.value)}
                placeholder="Ctrl+Alt+L"
                style={{ borderColor: keybindingError ? tokens.colorPaletteRedBorder1 : undefined }}
              />
              {keybindingError ? (
                <Text style={{ color: tokens.colorPaletteRedForeground1, fontSize: 12 }}>{keybindingError}</Text>
              ) : (
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                  {t("examples")}: Ctrl+Alt+L, Cmd+Shift+F, Ctrl+Shift+I
                </Text>
              )}
              <div style={{ marginTop: 4 }}>
                {t("displayedAs")}: <kbd>{formatKeybindingForDisplay(draft.keybinding)}</kbd>
              </div>
            </section>

            <section className="omni-settings-card">
              <Text weight="semibold">{t("capitalization")}</Text>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                {[
                  ["keywordCase", t("keywords")], ["identifierCase", t("identifiers")], ["dataTypeCase", t("dataTypes")], ["functionCase", t("functionNames")],
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
            </section>

            <section className="omni-settings-card">
              <Text weight="semibold">{t("layout")}</Text>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                <Label>
                  {t("indentationStyle")}
                  <Select value={draft.indentStyle} onChange={(_, data) => update("indentStyle", data.value as FormatterSettings["indentStyle"])} style={{ display: "block", marginTop: 4 }}>
                    {indentStyleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </Label>
                <Label>
                  {t("expressionWidth")}
                  <Input type="number" min={20} max={200} value={String(draft.expressionWidth)} onChange={(_, data) => update("expressionWidth", Number(data.value))} style={{ marginTop: 4 }} />
                </Label>
                <Label>
                  {t("linesBetweenQueries")}
                  <Input type="number" min={0} max={10} value={String(draft.linesBetweenQueries)} onChange={(_, data) => update("linesBetweenQueries", Number(data.value))} style={{ marginTop: 4 }} />
                </Label>
                <Label>
                  {t("andOrBreak")}
                  <Select value={draft.logicalOperatorNewline} onChange={(_, data) => update("logicalOperatorNewline", data.value as FormatterSettings["logicalOperatorNewline"])} style={{ display: "block", marginTop: 4 }}>
                    {logicalOperatorOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </Label>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <Label>
                  {t("tabWidth")}
                  <Input type="number" min={1} max={8} value={String(draft.tabWidth)} onChange={(_, data) => update("tabWidth", Number(data.value))} style={{ width: 80, marginTop: 4 }} />
                </Label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={draft.useTabs} onChange={(e) => update("useTabs", e.target.checked)} />
                  {t("useTabs")}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={draft.denseOperators} onChange={(e) => update("denseOperators", e.target.checked)} />
                  {t("denseOperators")}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={draft.newlineBeforeSemicolon} onChange={(e) => update("newlineBeforeSemicolon", e.target.checked)} />
                  {t("newlineBeforeSemicolon")}
                </label>
              </div>
            </section>

            <section className="omni-settings-card">
              <Text weight="semibold">{t("preview")} ({dialect})</Text>
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
            </section>
              </div>
            )}
          </DialogBody>
          <DialogActions className="omni-settings-actions">
            <Button type="button" onClick={() => setDraft(DEFAULT_FORMATTER_SETTINGS)}>
              {t("resetToDefaults")}
            </Button>
            <div style={{ flex: 1 }} />
            <Button type="button" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" appearance="primary" disabled={!!keybindingError}>
              {section === "formatting" ? t("saveFormatterSettings") : t("saveSettings")}
            </Button>
          </DialogActions>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
