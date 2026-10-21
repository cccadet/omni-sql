import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Popover,
  PopoverSurface,
  PopoverTrigger,
} from "@fluentui/react-components";
import {
  AddRegular,
  CheckmarkRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  FolderRegular,
  MoreHorizontalRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { DialectIcon } from "./DialectIcon";
import type { ConnectionHealth } from "./StatusBar";
import type { ConnectionEntry, ConnectionGroup } from "../lib/backend";
import { DIALECT_LABELS } from "../lib/dialect-labels";
import { recentConnectionIds, type ConnectionUsage } from "../lib/recent-connections";
import { useLanguage, type TranslationKey } from "../i18n";

const COLLAPSED_FOLDERS_KEY = "omni-sql:collapsedConnectionFolders";
const ROOT_FOLDER = "__root__";

export type ConnectionEnvironment = "development" | "staging" | "production";

export function connectionEnvironment(connection: ConnectionEntry): ConnectionEnvironment | null {
  const value = connection.options?.environment;
  return value === "development" || value === "staging" || value === "production" ? value : null;
}

export const ENVIRONMENT_LABEL_KEYS: Record<ConnectionEnvironment, TranslationKey> = {
  development: "environmentDevelopment",
  staging: "environmentStaging",
  production: "environmentProduction",
};

export function EnvironmentBadge({ connection }: { connection: ConnectionEntry }) {
  const { t } = useLanguage();
  const environment = connectionEnvironment(connection);
  return environment ? <span className="omni-environment-badge" data-environment={environment}>{t(ENVIRONMENT_LABEL_KEYS[environment])}</span> : null;
}

function loadCollapsedFolders(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedFolders(folders: ReadonlySet<string>) {
  try {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...folders]));
  } catch {
    // localStorage unavailable: folder state only lasts for this session.
  }
}

interface Section {
  key: string;
  title: string;
  folderId?: string;
  collapsed: boolean;
  items: ConnectionEntry[];
}

export interface ConnectionSwitcherProps {
  connections: readonly ConnectionEntry[];
  groups: readonly ConnectionGroup[];
  activeConnectionId: string | null;
  activeDatabase?: string | null;
  health: ConnectionHealth;
  usage: ConnectionUsage;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, groupId: string | null) => Promise<void> | void;
  onManage: () => void;
}

export function ConnectionSwitcher({
  connections,
  groups,
  activeConnectionId,
  activeDatabase,
  health,
  usage,
  onSelect,
  onAdd,
  onEdit,
  onDuplicate,
  onRemove,
  onMove,
  onManage,
}: ConnectionSwitcherProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [collapsed, setCollapsed] = useState(loadCollapsedFolders);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const activeConnection = connections.find((connection) => connection.id === activeConnectionId) ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey || event.key.toLowerCase() !== "o") return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlighted(0);
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const groupName = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);
  const sections = useMemo<Section[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matches = (connection: ConnectionEntry) => {
      if (!needle) return true;
      const environment = connectionEnvironment(connection);
      return [
        connection.label,
        connection.endpoint,
        DIALECT_LABELS[connection.dialect] ?? connection.dialect,
        connection.groupId ? groupName.get(connection.groupId) ?? "" : "",
        environment ? t(ENVIRONMENT_LABEL_KEYS[environment]) : "",
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    };
    const result: Section[] = [];
    if (!needle) {
      const recent = recentConnectionIds(usage, connections.map((connection) => connection.id))
        .map((id) => connections.find((connection) => connection.id === id)!)
        .filter(Boolean);
      if (recent.length > 0 && connections.length > recent.length) result.push({ key: "recent", title: t("recentConnections"), collapsed: false, items: recent });
    }
    for (const group of groups) {
      const items = connections.filter((connection) => connection.groupId === group.id && matches(connection));
      if (needle && items.length === 0) continue;
      result.push({ key: `folder:${group.id}`, title: group.name, folderId: group.id, collapsed: !needle && collapsed.has(group.id), items });
    }
    const loose = connections.filter((connection) => (!connection.groupId || !groupName.has(connection.groupId)) && matches(connection));
    if (loose.length > 0) {
      const title = groups.length > 0 ? t("noFolder") : t("connections");
      result.push({ key: "folder:root", title, folderId: groups.length > 0 ? ROOT_FOLDER : undefined, collapsed: !needle && collapsed.has(ROOT_FOLDER), items: loose });
    }
    return result;
  }, [collapsed, connections, groupName, groups, query, t, usage]);

  const options = useMemo(() => sections.flatMap((section) => section.collapsed ? [] : section.items.map((connection) => ({ section: section.key, connection }))), [sections]);
  const highlightedIndex = Math.min(highlighted, Math.max(options.length - 1, 0));

  const toggleFolder = (folderId: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
    saveCollapsedFolders(next);
    return next;
  });

  const choose = (id: string) => {
    setOpen(false);
    if (id !== activeConnectionId) onSelect(id);
  };
  const runAndClose = (action: () => void) => {
    setOpen(false);
    action();
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((highlightedIndex + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      const option = options[highlightedIndex];
      if (!option) return;
      event.preventDefault();
      choose(option.connection.id);
    }
  };

  let optionIndex = -1;
  return (
    <Popover open={open} onOpenChange={(_, data) => setOpen(data.open)} positioning={{ position: "below", align: "start", offset: 4 }}>
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="omni-connection-switcher" aria-haspopup="dialog" aria-expanded={open} aria-label={`${t("switchConnection")}: ${activeConnection?.label ?? t("noActiveConnection")}`} title={`${t("switchConnection")} (Ctrl+Alt+O)`}>
          {activeConnection ? <>
            <DialectIcon dialect={activeConnection.dialect} size={14} />
            <strong className="omni-app-connection" title={activeConnection.label}>{activeConnection.label}</strong>
            <span className="omni-app-dialect">{DIALECT_LABELS[activeConnection.dialect]}</span>
            {activeDatabase && <span className="omni-app-database" title={activeDatabase}>{activeDatabase}</span>}
            <EnvironmentBadge connection={activeConnection} />
            <span className={`omni-app-health omni-header-state-${health}`} role="status">
              <span aria-hidden className="omni-header-state-dot" />
              {health === "online" ? t("headerConnected") : health === "offline" ? t("headerOffline") : health === "verifying" ? t("headerVerifying") : t("statusUnknown")}
            </span>
          </> : <span className="omni-header-empty">{t("noActiveConnection")}</span>}
          <ChevronDownRegular fontSize={12} className="omni-connection-switcher-chevron" />
        </button>
      </PopoverTrigger>
      <PopoverSurface className="omni-switcher-panel" role="dialog" aria-label={t("switchConnection")}>
        <div className="omni-switcher-search">
          <SearchRegular fontSize={14} aria-hidden />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setHighlighted(0); }}
            onKeyDown={onSearchKeyDown}
            placeholder={t("searchConnectionsPlaceholder")}
            aria-label={t("searchConnections")}
          />
          <kbd className="omni-kbd-hint" aria-hidden>Ctrl+Alt+O</kbd>
        </div>
        <div className="omni-switcher-list">
          {connections.length === 0 ? (
            <div className="omni-switcher-empty">
              <span>{t("toolbar.noConnections")}</span>
              <span className="omni-switcher-empty-hint">{t("firstConnectionHint")}</span>
            </div>
          ) : options.length === 0 && sections.every((section) => !section.collapsed) ? (
            <div className="omni-switcher-empty">{t("noConnectionsMatch")}</div>
          ) : sections.map((section) => (
            <section key={section.key} className="omni-switcher-section" aria-label={section.title}>
              {section.folderId ? (
                <button type="button" className="omni-switcher-folder" aria-expanded={!section.collapsed} onClick={() => toggleFolder(section.folderId!)}>
                  {section.collapsed ? <ChevronRightRegular fontSize={12} /> : <ChevronDownRegular fontSize={12} />}
                  <FolderRegular fontSize={14} aria-hidden />
                  <span className="omni-switcher-folder-name">{section.title}</span>
                  <span className="omni-switcher-count">{section.items.length}</span>
                </button>
              ) : <div className="omni-switcher-heading">{section.title}</div>}
              {!section.collapsed && section.items.map((connection) => {
                optionIndex += 1;
                const index = optionIndex;
                const isActive = connection.id === activeConnectionId;
                const nested = section.folderId !== undefined;
                return (
                  <div key={`${section.key}:${connection.id}`} className={`omni-switcher-row${isActive ? " is-active" : ""}${index === highlightedIndex ? " is-highlighted" : ""}`} onMouseEnter={() => setHighlighted(index)}>
                    <button type="button" className={`omni-switcher-option${nested ? " is-nested" : ""}`} aria-current={isActive ? "true" : undefined} onClick={() => choose(connection.id)}>
                      <DialectIcon dialect={connection.dialect} size={14} />
                      <span className="omni-switcher-name">{connection.label}</span>
                      <EnvironmentBadge connection={connection} />
                      <span className="omni-switcher-dialect">{DIALECT_LABELS[connection.dialect] ?? connection.dialect}</span>
                      {isActive && health === "online" && <span className="omni-switcher-online" role="img" aria-label={t("headerConnected")} />}
                    </button>
                    <Menu>
                      <MenuTrigger disableButtonEnhancement>
                        <Button appearance="subtle" size="small" className="omni-switcher-actions" icon={<MoreHorizontalRegular />} aria-label={t("actionsFor").replace("{item}", connection.label)} />
                      </MenuTrigger>
                      <MenuPopover>
                        <MenuList>
                          <MenuItem onClick={() => runAndClose(() => onEdit(connection.id))}>{t("editConnection")}</MenuItem>
                          <MenuItem onClick={() => runAndClose(() => onDuplicate(connection.id))}>{t("duplicateConnection")}</MenuItem>
                          <Menu>
                            <MenuTrigger disableButtonEnhancement>
                              <MenuItem>{t("moveToFolder")}</MenuItem>
                            </MenuTrigger>
                            <MenuPopover>
                              <MenuList>
                                {groups.map((group) => (
                                  <MenuItem key={group.id} icon={connection.groupId === group.id ? <CheckmarkRegular /> : <span />} onClick={() => void onMove(connection.id, group.id)}>{group.name}</MenuItem>
                                ))}
                                <MenuItem icon={!connection.groupId || !groupName.has(connection.groupId) ? <CheckmarkRegular /> : <span />} onClick={() => void onMove(connection.id, null)}>{t("noFolder")}</MenuItem>
                                <MenuDivider />
                                <MenuItem icon={<AddRegular />} onClick={() => runAndClose(onManage)}>{t("newFolderEllipsis")}</MenuItem>
                              </MenuList>
                            </MenuPopover>
                          </Menu>
                          <MenuDivider />
                          <MenuItem className="omni-menu-danger" onClick={() => runAndClose(() => onRemove(connection.id))}>{t("removeConnectionEllipsis")}</MenuItem>
                        </MenuList>
                      </MenuPopover>
                    </Menu>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        <div className="omni-switcher-footer">
          <Button appearance="primary" size="small" icon={<AddRegular />} onClick={() => runAndClose(onAdd)}>{t("newConnection")}</Button>
          <Button size="small" onClick={() => runAndClose(onManage)}>{t("manageConnectionsEllipsis")}</Button>
          <span className="omni-switcher-hint" aria-hidden>{t("switcherKeyboardHint")}</span>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
