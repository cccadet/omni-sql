import { Button, Dialog, DialogActions, DialogBody, DialogSurface, DialogTitle, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Spinner, Toolbar as FluentToolbar, ToolbarButton, Tooltip, tokens } from "@fluentui/react-components";
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
  BookRegular,
  MoreVerticalRegular,
} from "@fluentui/react-icons";
import { useLanguage } from "../i18n";
import { DuckDbIcon } from "./DuckDbIcon";
import type { ReactNode } from "react";

export interface ToolbarProps {
  mongoControls?: ReactNode;
  activeConnectionId: string | null;
  busyMsg?: string | null;
  running?: boolean;
  limit?: number;
  sidebarOpen?: boolean;
  onAdd?: () => void;
  onRun?: () => void;
  onExplain?: () => void;
  explainAvailable?: boolean;
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
  onSendToAnalysis?: () => void;
  onAnalyzeLocally?: () => void;
  analyzingLocally?: boolean;
  onImportLocalFile?: () => void;
}

const LIMIT_OPTIONS = [10, 100, 500, 1000, 5000, 10000];

export function Toolbar({
  mongoControls,
  activeConnectionId,
  busyMsg,
  running = false,
  limit = 1000,
  sidebarOpen = true,
  onAdd,
  onRun,
  onExplain,
  explainAvailable = true,
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
  onSendToAnalysis,
  onAnalyzeLocally,
  analyzingLocally = false,
  onImportLocalFile,
}: ToolbarProps) {
  const { t } = useLanguage();
  return (
    <FluentToolbar size="small" className="omni-toolbar">
      <div className="omni-toolbar-main">
      <div className="omni-toolbar-execution">
      <div className="omni-toolbar-group omni-toolbar-group-primary" role="group" aria-label={t("run")}>
            {running ? (
              <ToolbarButton
                className="omni-cancel-run"
                icon={<StopRegular fontSize={14} />}
                onClick={onCancelRun}
                appearance="primary"
                style={{ fontWeight: 600 }}
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
                {t("run")}<span aria-hidden className="omni-toolbar-run-hint">Ctrl+↵</span>
              </ToolbarButton>
            )}
            <ToolbarButton icon={<WrenchRegular fontSize={14} />} onClick={onExplain} disabled={!activeConnectionId || running || !explainAvailable} aria-label={t("explainQuery")} title={t("explainQuery")}>
              EXPLAIN
            </ToolbarButton>
        <div className="omni-toolbar-limit">
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
      </div>

      {mongoControls}
      {onAnalyzeLocally && <ToolbarButton
        className="omni-toolbar-analyze"
        icon={<DuckDbIcon size={16} />}
        onClick={onAnalyzeLocally}
        disabled={running || analyzingLocally}
      >{analyzingLocally ? t("analysisImporting") : t("analyzeLocally")}</ToolbarButton>}

      </div>
      <div className="omni-toolbar-utilities">
      <span className="omni-toolbar-progress" aria-live="polite">
        {busyMsg && <Tooltip content={busyMsg} relationship="description"><Spinner size="tiny" aria-label={busyMsg} /></Tooltip>}
      </span>

      <div className="omni-toolbar-group omni-toolbar-global-actions" role="group" aria-label={t("settings")}>
        <ToolbarButton icon={<SaveRegular fontSize={16} />} onClick={onSave} aria-label={t("saveTab")} title={t("saveTab")} />
        <ToolbarButton icon={sidebarOpen ? <PanelLeftContractRegular fontSize={14} /> : <PanelLeftExpandRegular fontSize={14} />} onClick={onToggleSidebar} aria-label={t("toggleSidebar")} title={t("toggleSidebar")} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <ToolbarButton icon={<MoreVerticalRegular fontSize={16} />} aria-label={t("moreActions")} title={t("moreActions")} />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
                <MenuItem icon={<AddRegular />} onClick={onAdd}>{t("newSqlTab")}</MenuItem>
                <MenuItem icon={<FolderOpenRegular />} onClick={onOpen}>{t("openSavedTab")}</MenuItem>
                <MenuItem icon={<DuckDbIcon size={16} />} onClick={onSendToAnalysis} disabled={!activeConnectionId || !onSendToAnalysis}>{t("analysisSendToLocal")}</MenuItem>
                <MenuItem icon={<AddRegular />} onClick={onImportLocalFile}>{t("analysisImportFile")}</MenuItem>
              <MenuItem icon={<SettingsRegular />} onClick={onOpenFormatSettings}>{t("settings")}</MenuItem>
              <MenuItem icon={<BookRegular />} onClick={onOpenCommandLibrary}>{t("commandLibrary")}</MenuItem>
              <MenuItem icon={<HistoryRegular />} onClick={onToggleHistory}>{t("history")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      </div>
      {pendingRunCount && (
        <Dialog open onOpenChange={(_, data) => !data.open && onRunChoiceCancel?.()}>
          <DialogSurface className="omni-standard-dialog omni-confirm-dialog" style={{ minWidth: 280 }}>
            <DialogBody className="omni-dialog-body">
              <DialogTitle>{t("multipleStatements")}</DialogTitle>
              <DialogActions className="omni-dialog-actions">
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
