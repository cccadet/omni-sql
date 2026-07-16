import { Toolbar as FluentToolbar, ToolbarButton } from "@fluentui/react-components";
import {
  AddRegular,
  PlayRegular,
  DatabaseRegular,
  SettingsRegular,
  DocumentRegular,
  FolderOpenRegular,
  SaveRegular,
  PanelLeftContractRegular,
} from "@fluentui/react-icons";

export interface ToolbarProps {
  onAdd?: () => void;
  onAddConnection?: () => void;
  onRun?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onToggleSidebar?: () => void;
  onToggleHistory?: () => void;
  onOpenFormatSettings?: () => void;
}

export function Toolbar({
  onAdd,
  onAddConnection,
  onRun,
  onOpen,
  onSave,
  onToggleSidebar,
  onToggleHistory,
  onOpenFormatSettings,
}: ToolbarProps) {
  return (
    <FluentToolbar style={{ padding: 8, gap: 8 }}>
      <ToolbarButton icon={<DatabaseRegular />} onClick={onAddConnection}>
        Conexão
      </ToolbarButton>
      <ToolbarButton icon={<AddRegular />} onClick={onAdd}>
        Nova aba
      </ToolbarButton>
      <ToolbarButton icon={<PanelLeftContractRegular />} onClick={onToggleSidebar}>
        Sidebar
      </ToolbarButton>
      <ToolbarButton icon={<PlayRegular />} onClick={onRun} appearance="primary">
        Executar
      </ToolbarButton>
      <ToolbarButton icon={<FolderOpenRegular />} onClick={onOpen}>
        Abrir
      </ToolbarButton>
      <ToolbarButton icon={<SaveRegular />} onClick={onSave}>
        Salvar
      </ToolbarButton>
      <ToolbarButton icon={<DocumentRegular />} onClick={onToggleHistory}>
        Histórico
      </ToolbarButton>
      <ToolbarButton icon={<SettingsRegular />} onClick={onOpenFormatSettings}>
        Formatar
      </ToolbarButton>
    </FluentToolbar>
  );
}
