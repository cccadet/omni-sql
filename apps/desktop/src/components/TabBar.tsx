import { useEffect, useRef, useState } from "react";
import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tab, TabList, tokens } from "@fluentui/react-components";
import { AddRegular, ChevronDownRegular, DismissRegular } from "@fluentui/react-icons";
import { DialectIcon } from "./DialectIcon";
import { useLanguage } from "../i18n";

export interface TabItem {
  id: string;
  title: string;
  dirty?: boolean;
  dialect?: string;
  /** Second line under the title, e.g. the connection the tab runs against. */
  subtitle?: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string | null;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  onAdd?: () => void;
  onRename?: (id: string, title: string) => void;
}

const TAB_SLOT_WIDTH = 196;
const PLAIN_TAB_SLOT_WIDTH = 96;
const OVERFLOW_RESERVE = 130;

export function TabBar({ tabs, activeTabId, onSelect, onClose, onAdd, onRename }: TabBarProps) {
  const { t } = useLanguage();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barWidth, setBarWidth] = useState<number | null>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setBarWidth(entry?.contentRect.width ?? null));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // Fit as many tabs as the bar allows; the rest go to the overflow menu. The active tab always stays visible.
  let capacity = tabs.length;
  if (barWidth) {
    let used = OVERFLOW_RESERVE;
    capacity = tabs.findIndex((tab) => (used += tab.subtitle ? TAB_SLOT_WIDTH : PLAIN_TAB_SLOT_WIDTH) > barWidth);
    capacity = capacity === -1 ? tabs.length : Math.max(1, capacity);
  }
  let visibleTabs = tabs.slice(0, capacity);
  if (tabs.length > capacity) {
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (active && !visibleTabs.includes(active)) visibleTabs = [...visibleTabs.slice(0, capacity - 1), active];
  }
  const hiddenTabs = tabs.filter((tab) => !visibleTabs.includes(tab));

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
      ref={barRef}
      className="omni-tab-bar"
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
      >
        {visibleTabs.map((tab) => (
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
              <div
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}
              >
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(tab.id);
                    setEditingValue(tab.title);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, overflow: "hidden" }}
                >
                  {tab.dialect && (
                    <span title={tab.dialect} style={{ fontSize: 12, lineHeight: 1, display: "flex" }}>
                      <DialectIcon dialect={tab.dialect} size={12} />
                    </span>
                  )}
                  <span className="omni-tab-label" title={tab.subtitle ? `${tab.title} · ${tab.subtitle}` : tab.title}>
                    <span className="omni-tab-title">{tab.title}</span>
                    {tab.subtitle && <span className="omni-tab-subtitle">{tab.subtitle}</span>}
                  </span>
                  {tab.dirty && (
                    <span style={{ color: tokens.colorPaletteYellowForeground1, fontSize: 8 }}>●</span>
                  )}
                </span>
                <Button
                  icon={<DismissRegular />}
                  appearance="transparent"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose?.(tab.id);
                  }}
                  aria-label={t("closeTab")}
                  title={t("closeTab")}
                />
              </div>
            )}
          </Tab>
        ))}
      </TabList>
      {hiddenTabs.length > 0 && <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button size="small" appearance="subtle" icon={<ChevronDownRegular />} className="omni-tab-overflow" aria-label={t("moreTabs").replace("{count}", String(hiddenTabs.length))}>
            {t("moreTabs").replace("{count}", String(hiddenTabs.length))}
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {hiddenTabs.map((tab) => (
              <MenuItem key={tab.id} icon={tab.dialect ? <DialectIcon dialect={tab.dialect} size={12} /> : undefined} secondaryContent={tab.subtitle} onClick={() => onSelect?.(tab.id)}>
                {tab.title}
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>}
      <Button icon={<AddRegular />} size="small" appearance="subtle" onClick={onAdd} aria-label={t("newTab")} title={t("newTab")} />
    </div>
  );
}
