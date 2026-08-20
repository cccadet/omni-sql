import { Button, Dialog, DialogActions, DialogBody, DialogSurface, DialogTitle, Spinner, Toolbar as FluentToolbar, ToolbarButton, tokens } from "@fluentui/react-components";
import {
  AddRegular,
  PlayRegular,
  StopRegular,
  SettingsRegular,
  FolderOpenRegular,
  SaveRegular,
  PanelLeftContractRegular,
  PanelLeftExpandRegular,
  HistoryRegular,
  WrenchRegular,
  MoreVerticalRegular,
  BookRegular,
} from "@fluentui/react-icons";
import { useLanguage } from "../i18n";

export interface ToolbarProps {
  activeConnectionId: string | null;
  busyMsg?: string | null;
  running?: boolean;
  limit?: number;
  sidebarOpen?: boolean;
  onAdd?: () => void;
  onRun?: () => void;
  onExplain?: () => void;
  onCancelRun?: () => void;
  onRunChoice?: (choice: "current" | "all") => void;
  onRunChoiceCancel?: () => void;
  pendingRunCount?: number | null;
  onLimitChange?: (limit: number) => void;
  onSave?: () => void;
  onOpen?: () => void;
  onOpenFormatSettings?: () => void;
  onToggleSidebar?: () => void;
  onToggleHistory?: () => void;
  onOpenCommandLibrary?: () => void;
}

const LIMIT_OPTIONS = [10, 100, 500, 1000, 5000, 10000];

export function Toolbar({
  activeConnectionId,
  busyMsg,
  running = false,
  limit = 1000,
  sidebarOpen = true,
  onAdd,
  onRun,
  onExplain,
  onCancelRun,
  onRunChoice,
  onRunChoiceCancel,
  pendingRunCount = null,
  onLimitChange,
  onSave,
  onOpen,
  onOpenFormatSettings,
  onToggleSidebar,
  onToggleHistory,
  onOpenCommandLibrary,
}: ToolbarProps) {
  const { t } = useLanguage();
  return (
    <FluentToolbar className="omni-toolbar" style={{ padding: "6px 12px", gap: 0, alignItems: "center" }}>
      <div className="omni-toolbar-group">
        <div className="omni-toolbar-stack">
          <span className="omni-toolbar-label">{t("run")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {running ? (
              <ToolbarButton
                icon={<StopRegular fontSize={14} />}
                onClick={onCancelRun}
                appearance="primary"
                style={{ backgroundColor: tokens.colorPaletteRedBackground1, fontWeight: 600 }}
                title={t("cancel")}
              >
                {t("cancel")}
              </ToolbarButton>
            ) : (
              <ToolbarButton
                icon={<PlayRegular fontSize={14} />}
                onClick={onRun}
                appearance="primary"
                disabled={!activeConnectionId}
                style={{ fontWeight: 600, padding: "4px 12px" }}
                title={t("runCurrentShortcut")}
              >
                {t("run")}
              </ToolbarButton>
            )}
            <ToolbarButton icon={<WrenchRegular fontSize={14} />} onClick={onExplain} disabled={!activeConnectionId || running} aria-label={t("explainQuery")} title={t("explainQuery")}>
              EXPLAIN
            </ToolbarButton>
          </div>
        </div>
      </div>

      <div className="omni-toolbar-group">
        <div className="omni-toolbar-stack">
          <span className="omni-toolbar-label">{t("rowLimit")}</span>
          <select
            aria-label={t("rowLimit")}
            value={limit}
            onChange={(e) => onLimitChange?.(Number(e.target.value))}
            style={{
              padding: "3px 6px",
              borderRadius: 4,
              border: `1px solid ${tokens.colorNeutralStroke1}`,
              background: tokens.colorNeutralBackground1,
              color: tokens.colorNeutralForeground1,
              fontSize: 12,
            }}
          >
            {LIMIT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt} {t("rows")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="omni-toolbar-group" role="group" aria-label={t("tabActions")}>
        <div className="omni-toolbar-stack">
          <span className="omni-toolbar-label">{t("tabActions")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <ToolbarButton icon={<AddRegular fontSize={14} />} onClick={onAdd} aria-label={t("newSqlTab")} title={t("newSqlTab")} />
            <ToolbarButton icon={<FolderOpenRegular fontSize={14} />} onClick={onOpen} aria-label={t("openSavedTab")}>
              {t("openSavedTab")}
            </ToolbarButton>
            <ToolbarButton icon={<SaveRegular fontSize={14} />} onClick={onSave} aria-label={t("saveTab")}>
              {t("saveTab")}
            </ToolbarButton>
          </div>
        </div>
      </div>

      <div
        className="omni-toolbar-group"
        role="group"
        aria-label={t("settings")}
        style={{ borderLeft: `1px solid ${tokens.colorNeutralStroke1}`, marginLeft: 8, paddingLeft: 8 }}
      >
        <div className="omni-toolbar-stack">
          <span className="omni-toolbar-label">{t("settings")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <ToolbarButton icon={<SettingsRegular fontSize={14} />} onClick={onOpenFormatSettings} aria-label={t("settings")} title={t("settings")} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {busyMsg && <Spinner size="tiny" label={busyMsg} labelPosition="after" style={{ marginRight: 8 }} />}

      <ToolbarButton icon={sidebarOpen ? <PanelLeftContractRegular fontSize={14} /> : <PanelLeftExpandRegular fontSize={14} />} onClick={onToggleSidebar} aria-label={t("toggleSidebar")} title={t("toggleSidebar")} />
      <ToolbarButton icon={<BookRegular fontSize={14} />} onClick={onOpenCommandLibrary} aria-label={t("commandLibrary")} title={t("commandLibrary")} />
      <ToolbarButton icon={<HistoryRegular fontSize={14} />} onClick={onToggleHistory} aria-label={t("history")} title={t("history")} />
      <ToolbarButton icon={<MoreVerticalRegular fontSize={14} />} aria-label={t("moreOptions")} title={t("moreOptions")} />
      {pendingRunCount && (
        <Dialog open onOpenChange={(_, data) => !data.open && onRunChoiceCancel?.()}>
          <DialogSurface style={{ minWidth: 280 }}>
            <DialogBody>
              <DialogTitle>{t("multipleStatements")}</DialogTitle>
              <DialogActions>
                <Button onClick={() => onRunChoice?.("current")} appearance="primary">
                  {t("runCurrent")}
                </Button>
                <Button onClick={() => onRunChoice?.("all")}>
                  {t("runAll")} ({pendingRunCount})
                </Button>
                <Button onClick={onRunChoiceCancel}>{t("cancel")}</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </FluentToolbar>
  );
}
