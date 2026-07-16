import { useEffect, useRef, useState } from "react";
import { Button, Tab, TabList, tokens } from "@fluentui/react-components";
import { AddRegular, DismissRegular } from "@fluentui/react-icons";

export interface TabItem {
  id: string;
  title: string;
  dirty?: boolean;
  dialect?: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string | null;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  onAdd?: () => void;
  onRename?: (id: string, title: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onAdd, onRename }: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const commitRename = () => {
    if (editingId) {
      const trimmed = editingValue.trim();
      if (trimmed) onRename?.(editingId, trimmed);
    }
    setEditingId(null);
  };

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
            {editingId === tab.id ? (
              <input
                ref={inputRef}
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 120, font: "inherit" }}
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(tab.id);
                  setEditingValue(tab.title);
                }}
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                {tab.dialect && <span>{tab.dialect}</span>}
                <span>{tab.title}</span>
                {tab.dirty && (
                  <span style={{ color: tokens.colorPaletteYellowForeground1, fontSize: 8 }}>●</span>
                )}
              </span>
            )}
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
