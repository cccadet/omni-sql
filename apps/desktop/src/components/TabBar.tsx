import { Button, Tab, TabList, tokens } from "@fluentui/react-components";
import { AddRegular, DismissRegular } from "@fluentui/react-icons";

export interface TabItem {
  id: string;
  title: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string | null;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  onAdd?: () => void;
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onAdd }: TabBarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        background: tokens.colorNeutralBackground1,
      }}
    >
      <TabList
        selectedValue={activeTabId ?? undefined}
        onTabSelect={(_, data) => onSelect?.(String(data.value))}
        style={{ flex: 1 }}
      >
        {tabs.map((tab) => (
          <Tab key={tab.id} value={tab.id}>
            {tab.title}
            <Button
              icon={<DismissRegular />}
              appearance="transparent"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onClose?.(tab.id);
              }}
              aria-label="Fechar aba"
            />
          </Tab>
        ))}
      </TabList>
      <Button icon={<AddRegular />} size="small" appearance="subtle" onClick={onAdd} aria-label="Nova aba" />
    </div>
  );
}
