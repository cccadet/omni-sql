import { Toolbar as FluentToolbar, ToolbarButton, Spinner, tokens } from "@fluentui/react-components";
import {
  AddRegular,
  PlayRegular,
  StopRegular,
  DatabaseRegular,
  SettingsRegular,
  FolderOpenRegular,
  SaveRegular,
  PanelLeftContractRegular,
  PanelLeftExpandRegular,
  HistoryRegular,
  EditRegular,
  DeleteRegular,
  ArrowSyncRegular,
  CheckmarkCircleRegular,
  CircleRegular,
  WrenchRegular,
  MoreVerticalRegular,
} from "@fluentui/react-icons";
import { DialectIcon } from "./DialectIcon";
import { SidecarStatus } from "./SidecarStatus";
import type { ConnectionEntry } from "../lib/backend";

export interface ToolbarProps {
  connections: ConnectionEntry[];
  activeConnectionId: string | null;
  busyMsg?: string | null;
  running?: boolean;
  limit?: number;
  sidebarOpen?: boolean;
  onAdd?: () => void;
  onAddConnection?: () => void;
  onEditConnection?: () => void;
  onRemoveConnection?: () => void;
  onRefreshMetadata?: () => void;
  onSelectConnection?: (id: string) => void;
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
}

const LIMIT_OPTIONS = [10, 100, 500, 1000, 5000, 10000];

function formatMetaStatus(entry: ConnectionEntry | undefined): { synced: boolean; label: string } {
  if (!entry) return { synced: false, label: "" };
  if (entry.lastSyncedAt) {
    const d = new Date(entry.lastSyncedAt);
    return { synced: true, label: `Metadados sincronizados em ${d.toLocaleString()}` };
  }
  return { synced: false, label: "Metadados ainda não lidos — autocomplete de tabelas indisponível" };
}

export function Toolbar({
  connections,
  activeConnectionId,
  busyMsg,
  running = false,
  limit = 1000,
  sidebarOpen = true,
  onAdd,
  onAddConnection,
  onEditConnection,
  onRemoveConnection,
  onRefreshMetadata,
  onSelectConnection,
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
}: ToolbarProps) {
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const metaStatus = formatMetaStatus(activeConnection);

  return (
    <FluentToolbar className="omni-toolbar" style={{ padding: "6px 12px", gap: 0, alignItems: "center" }}>
      <div className="omni-toolbar-group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="omni-toolbar-stack">
          <span className="omni-toolbar-label">Conexão</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <select
              aria-label="Conexão ativa"
              value={activeConnectionId ?? ""}
              onChange={(e) => onSelectConnection?.(e.target.value)}
              style={{
                minWidth: 170,
                padding: "3px 6px",
                borderRadius: 4,
                border: `1px solid ${tokens.colorNeutralStroke1}`,
                background: tokens.colorNeutralBackground1,
                color: tokens.colorNeutralForeground1,
                fontSize: 12,
              }}
            >
              {connections.length === 0 && (
                <option value="" disabled>
                  Nenhuma conexão cadastrada
                </option>
              )}
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {activeConnection && (
              <span title={activeConnection.dialect}>
                <DialectIcon dialect={activeConnection.dialect} size={14} />
              </span>
            )}
            <span title={metaStatus.label}>
              {metaStatus.synced ? (
                <CheckmarkCircleRegular style={{ color: tokens.colorBrandForeground1, fontSize: 18 }} />
              ) : (
                <CircleRegular style={{ color: tokens.colorNeutralForeground3, fontSize: 14 }} />
              )}
            </span>
            <SidecarStatus />
          </div>
        </div>
      </div>

      <div className="omni-toolbar-group">
        <div className="omni-toolbar-stack">
          <span className="omni-toolbar-label">Fonte</span>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <ToolbarButton icon={<ArrowSyncRegular fontSize={14} />} onClick={onRefreshMetadata} disabled={!activeConnectionId || !!busyMsg} aria-label="Atualizar metadados" />
            <ToolbarButton icon={<DatabaseRegular fontSize={14} />} onClick={onAddConnection} aria-label="Nova conexão" />
            <ToolbarButton icon={<EditRegular fontSize={14} />} onClick={onEditConnection} disabled={!activeConnectionId} aria-label="Editar conexão" />
            <ToolbarButton icon={<DeleteRegular fontSize={14} />} onClick={onRemoveConnection} disabled={!activeConnectionId} aria-label="Remover conexão" />
          </div>
        </div>
      </div>

      <div className="omni-toolbar-group">
        <div className="omni-toolbar-stack">
          <span className="omni-toolbar-label">Execução</span>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {running ? (
              <ToolbarButton
                icon={<StopRegular fontSize={14} />}
                onClick={onCancelRun}
                appearance="primary"
                style={{ backgroundColor: tokens.colorPaletteRedBackground1, fontWeight: 600 }}
              >
                Cancelar
              </ToolbarButton>
            ) : (
              <ToolbarButton
                icon={<PlayRegular fontSize={14} />}
                onClick={onRun}
                appearance="primary"
                disabled={!activeConnectionId}
                style={{ fontWeight: 600, padding: "4px 12px" }}
              >
                Executar
              </ToolbarButton>
            )}
            <ToolbarButton icon={<WrenchRegular fontSize={14} />} onClick={onExplain} disabled={!activeConnectionId || running} aria-label="Explicar query">
              EXPLAIN
            </ToolbarButton>
          </div>
        </div>
      </div>

      <div className="omni-toolbar-group">
        <div className="omni-toolbar-stack">
          <span className="omni-toolbar-label">Limite</span>
          <select
            aria-label="Limite de linhas"
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
                {opt} linhas
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="omni-toolbar-group">
        <div className="omni-toolbar-stack">
          <span className="omni-toolbar-label">Editor</span>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <ToolbarButton icon={<AddRegular fontSize={14} />} onClick={onAdd} aria-label="Nova aba" />
            <ToolbarButton icon={<FolderOpenRegular fontSize={14} />} onClick={onOpen} aria-label="Abrir arquivo">
              Abrir
            </ToolbarButton>
            <ToolbarButton icon={<SaveRegular fontSize={14} />} onClick={onSave} aria-label="Salvar aba">
              Salvar
            </ToolbarButton>
            <ToolbarButton icon={<SettingsRegular fontSize={14} />} onClick={onOpenFormatSettings} aria-label="Formatador SQL" />
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {busyMsg && <Spinner size="tiny" label={busyMsg} labelPosition="after" style={{ marginRight: 8 }} />}

      <ToolbarButton icon={sidebarOpen ? <PanelLeftContractRegular fontSize={14} /> : <PanelLeftExpandRegular fontSize={14} />} onClick={onToggleSidebar} aria-label="Alternar sidebar" />
      <ToolbarButton icon={<HistoryRegular fontSize={14} />} onClick={onToggleHistory} aria-label="Histórico" />
      <ToolbarButton icon={<MoreVerticalRegular fontSize={14} />} aria-label="Mais opções" />

      {pendingRunCount && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={onRunChoiceCancel}
          role="presentation"
        >
          <div
            style={{
              background: tokens.colorNeutralBackground1,
              border: `1px solid ${tokens.colorNeutralStroke1}`,
              borderRadius: 8,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 280,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600 }}>Esta aba tem várias instruções</div>
            <ToolbarButton onClick={() => onRunChoice?.("current")} appearance="primary">
              Rodar instrução atual
            </ToolbarButton>
            <ToolbarButton onClick={() => onRunChoice?.("all")}>Rodar todas ({pendingRunCount})</ToolbarButton>
            <ToolbarButton onClick={onRunChoiceCancel}>Cancelar</ToolbarButton>
          </div>
        </div>
      )}
    </FluentToolbar>
  );
}
