import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
  tokens,
} from "@fluentui/react-components";
import { useLanguage } from "../i18n";

export interface McpEditProposal {
  tabId: string;
  originalSql: string;
  proposedSql: string;
  rationale: string;
  expiresAt?: number;
  revision: number;
}

export function McpEditDialog({
  proposal,
  onApply,
  onReject,
}: {
  proposal: McpEditProposal | null;
  onApply: () => void;
  onReject: () => void;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={proposal !== null} onOpenChange={(_, data) => !data.open && onReject()}>
      <DialogSurface className="omni-standard-dialog omni-mcp-edit-dialog">
        <DialogBody style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <DialogTitle style={{ flexShrink: 0 }}>{t("mcpEditTitle")}</DialogTitle>
          <DialogContent style={{ display: "grid", gap: 12, overflowY: "auto", minHeight: 0 }}>
            <Text>{t("mcpEditRationale")}: {proposal?.rationale}</Text>
            <div className="omni-mcp-edit-grid">
              <SqlPreview label={t("mcpOriginalSql")} value={proposal?.originalSql ?? ""} />
              <SqlPreview label={t("mcpProposedSql")} value={proposal?.proposedSql ?? ""} accent />
            </div>
          </DialogContent>
          <DialogActions className="omni-dialog-actions" style={{ flexShrink: 0 }}>
            <Button appearance="secondary" onClick={onReject}>{t("reject")}</Button>
            <Button appearance="primary" onClick={onApply}>{t("applyEdit")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function SqlPreview({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <Text weight="semibold">{label}</Text>
      <textarea
        aria-label={label}
        readOnly
        value={value}
        style={{
          minHeight: 220,
          width: "100%",
          resize: "vertical",
          boxSizing: "border-box",
          padding: 10,
          color: tokens.colorNeutralForeground1,
          background: tokens.colorNeutralBackground3,
          border: `1px solid ${accent ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke1}`,
          borderRadius: 4,
          font: "12px ui-monospace, monospace",
        }}
      />
    </label>
  );
}
