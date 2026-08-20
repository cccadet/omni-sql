import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, tokens } from "@fluentui/react-components";
import { useMemo, useState } from "react";
import type { DialectId } from "@omni-sql/ts-types";
import { commandsForDialect, searchSqlCommands, type SqlCommandCategory } from "../lib/sql-command-library";
import { useLanguage } from "../i18n";
import type { TranslationKey } from "../i18n";

export interface SqlCommandLibraryProps {
  open: boolean;
  dialect: DialectId;
  onClose: () => void;
  onInsert: (sql: string) => void;
}

const CATEGORIES: readonly ("all" | SqlCommandCategory)[] = ["all", "data", "schema", "indexes", "security", "transactions", "diagnostics"];
const CATEGORY_KEYS: Record<"all" | SqlCommandCategory, TranslationKey> = {
  all: "commandCategory.all", data: "commandCategory.data", schema: "commandCategory.schema",
  indexes: "commandCategory.indexes", security: "commandCategory.security",
  transactions: "commandCategory.transactions", diagnostics: "commandCategory.diagnostics",
};

export function SqlCommandLibrary({ open, dialect, onClose, onInsert }: SqlCommandLibraryProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | SqlCommandCategory>("all");
  const commands = useMemo(() => searchSqlCommands(commandsForDialect(dialect), query, category), [dialect, query, category]);

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface style={{ width: "min(820px, calc(100vw - 24px))", maxHeight: "min(760px, calc(100vh - 24px))" }}>
        <DialogBody style={{ minHeight: 0 }}>
          <DialogTitle>{t("commandLibrary")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <Input aria-label={t("searchCommands")} placeholder={t("searchCommands")} value={query} onChange={(_, data) => setQuery(data.value)} style={{ flex: 1 }} />
              <select aria-label={t("commandCategory")} value={category} onChange={(event) => setCategory(event.target.value as "all" | SqlCommandCategory)}>
                {CATEGORIES.map((value) => <option key={value} value={value}>{t(CATEGORY_KEYS[value])}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gap: 8, overflowY: "auto" }}>
              {commands.map((command) => (
                <article key={command.id} style={{ border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: 6, padding: 12, display: "grid", gap: 8 }}>
                  <div><strong>{command.title}</strong> <span style={{ color: tokens.colorNeutralForeground3, fontSize: 12 }}>· {t(CATEGORY_KEYS[command.category])}</span></div>
                  <span style={{ color: tokens.colorNeutralForeground2 }}>{command.description}</span>
                  <pre style={{ margin: 0, padding: 10, borderRadius: 4, overflowX: "auto", background: tokens.colorNeutralBackground3, whiteSpace: "pre-wrap" }}>{command.sql}</pre>
                  <Button appearance="primary" onClick={() => { onInsert(command.sql); onClose(); }} style={{ justifySelf: "end" }}>{t("insertCommand")}</Button>
                </article>
              ))}
              {commands.length === 0 && <span>{t("noCommands")}</span>}
            </div>
          </DialogContent>
          <DialogActions><Button onClick={onClose}>{t("cancel")}</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
