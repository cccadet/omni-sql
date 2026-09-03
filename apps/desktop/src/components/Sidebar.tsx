import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Input,
  Text,
  tokens,
  Spinner,
  Tooltip,
} from "@fluentui/react-components";
import {
  ChevronRightRegular,
  ChevronDownRegular,
  SearchRegular,
  DismissRegular,
  ArrowEnterRegular,
  LinkRegular,
  DatabaseRegular,
  TableRegular,
  EyeRegular,
  NumberSymbolRegular,
  CheckmarkCircleRegular,
  ErrorCircleRegular,
  WarningRegular,
  CircleRegular,
  AddRegular,
  EditRegular,
  DeleteRegular,
  MoreVerticalRegular,
} from "@fluentui/react-icons";
import { DialectIcon } from "./DialectIcon";
import { SidecarStatus } from "./SidecarStatus";
import { typeIcon } from "../lib/type-icon";
import { backend, type ConnectionEntry, type RelationColumn, type RelationInfo } from "../lib/backend";
import type { FunctionDef, IndexInfo, ObjectDefinitionKind } from "@omni-sql/ts-types";
import type { ConnectionHealth } from "./StatusBar";
import { formatLastSyncedAt, getMetadataFreshness } from "../lib/metadata-freshness";
import { useLanguage } from "../i18n";
import { CreateTableDialog, TableStructureDialog } from "./TableDialogs";

export interface SidebarProps {
  open?: boolean;
  connections?: ConnectionEntry[];
  connectionGroups?: { id: string; name: string }[];
  connection?: ConnectionEntry | null;
  connectionId?: string | null;
  relations?: RelationInfo[];
  schemas?: string[];
  functions?: FunctionDef[];
  loading?: boolean;
  onInsert?: (text: string) => void;
  onAddConnection?: () => void;
  onEditConnection?: (id: string) => void;
  onDuplicateConnection?: (id: string) => void;
  onRemoveConnection?: (id: string) => void;
  onRefreshMetadata?: () => void;
  onSelectConnection?: (id: string) => void;
  onCreateConnectionGroup?: (name: string) => Promise<void>;
  onRenameConnectionGroup?: (id: string, name: string) => Promise<void>;
  onDeleteConnectionGroup?: (id: string) => Promise<void>;
  onMoveConnection?: (id: string, groupId: string | null) => Promise<void>;
  onOpenInNewTab?: (title: string, sql: string) => void;
  health?: ConnectionHealth;
  metadataRefreshFailed?: boolean;
}

interface SchemaGroup {
  name: string;
  tables: RelationInfo[];
  views: RelationInfo[];
  functions: FunctionDef[];
}

interface TreeNodeProps {
  label: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
  forceExpanded?: boolean;
  actions?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
  onExpandedChange?: (expanded: boolean) => void;
}

function TreeNode({ label, icon, children, defaultExpanded = false, forceExpanded, actions, onContextMenu, onExpandedChange }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isExpanded = forceExpanded ?? expanded;
  const hasChildren = Boolean(children);
  return (
    <div style={{ marginLeft: 10, minWidth: 0 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0" }}
        onContextMenu={onContextMenu}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, cursor: hasChildren ? "pointer" : "default" }}
          role={hasChildren ? "button" : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
          onClick={() => {
            if (!hasChildren) return;
            const nextExpanded = !isExpanded;
            setExpanded(nextExpanded);
            onExpandedChange?.(nextExpanded);
          }}
          onKeyDown={(e) => {
            if (!hasChildren || e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            const nextExpanded = !isExpanded;
            setExpanded(nextExpanded);
            onExpandedChange?.(nextExpanded);
          }}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} />
          ) : (
            <span style={{ width: 12 }} />
          )}
          {icon}
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        </div>
        {actions}
      </div>
      {isExpanded && <div>{children}</div>}
    </div>
  );
}

interface MenuItem {
  label: string;
  action: () => void;
}

interface MoveOption {
  id: string | null;
  label: string;
}

const MIN_WIDTH = 160;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 260;
const WIDTH_KEY = "omni-sql:sidebarWidth";
const MIN_CONNECTIONS_HEIGHT = 150;
const MIN_OBJECTS_HEIGHT = 180;
const DEFAULT_CONNECTIONS_HEIGHT = 220;
const CONNECTIONS_HEIGHT_KEY = "omni-sql:connectionsHeight";

function relationKey(schema: string, name: string) {
  return `${schema}.${name}`;
}

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    const n = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function loadConnectionsHeight(): number {
  try {
    const raw = localStorage.getItem(CONNECTIONS_HEIGHT_KEY);
    const value = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(value) ? Math.max(MIN_CONNECTIONS_HEIGHT, value) : DEFAULT_CONNECTIONS_HEIGHT;
  } catch {
    return DEFAULT_CONNECTIONS_HEIGHT;
  }
}

export function Sidebar({
  open = true,
  connections = [],
  connectionGroups = [],
  connection,
  connectionId,
  relations = [],
  schemas = [],
  functions = [],
  loading = false,
  onInsert,
  onAddConnection,
  onEditConnection,
  onDuplicateConnection,
  onRemoveConnection,
  onRefreshMetadata,
  onSelectConnection,
  onCreateConnectionGroup,
  onRenameConnectionGroup,
  onDeleteConnectionGroup,
  onMoveConnection,
  onOpenInNewTab,
  health = "unknown",
  metadataRefreshFailed = false,
}: SidebarProps) {
  const { t: tr } = useLanguage();
  const [search, setSearch] = useState("");
  const [searchMatches, setSearchMatches] = useState<Set<string> | null>(null);
  const [width, setWidth] = useState(loadWidth);
  const [connectionsHeight, setConnectionsHeight] = useState(loadConnectionsHeight);
  const [resizing, setResizing] = useState(false);
  const [resizingConnections, setResizingConnections] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [indexCache, setIndexCache] = useState<Record<string, { loading: boolean; error: string | null; indexes: IndexInfo[] }>>({});
  const [columnCache, setColumnCache] = useState<Record<string, { loading: boolean; error: string | null; columns: RelationColumn[] }>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; moveOptions?: MoveOption[]; moveConnectionId?: string; moveSubmenuOpen: boolean; moveSubmenuPosition?: { left: number; top: number } } | null>(null);
  const [connectionsExpanded, setConnectionsExpanded] = useState(true);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(connectionId ?? null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(connectionGroups.map((group) => group.id)));
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [draggedConnectionId, setDraggedConnectionId] = useState<string | null>(null);
  const [createTableSchema, setCreateTableSchema] = useState<string | null>(null);
  const [structureTable, setStructureTable] = useState<{ schema: string; table: string } | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const connectionsHeightRef = useRef(connectionsHeight);

  useEffect(() => {
    setExpanded(new Set());
    setIndexCache({});
    setColumnCache({});
    setSearchMatches(null);
  }, [connectionId]);

  useEffect(() => {
    const query = search.trim();
    if (!query || !connectionId) {
      setSearchMatches(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void backend.call<{ relations: RelationInfo[] }>("metadata.listRelations", { connectionId, search: query })
        .then(({ relations: matches }) => {
          if (!cancelled) setSearchMatches(new Set(matches.map((relation) => relationKey(relation.schema, relation.name))));
        })
        .catch(() => {
          if (!cancelled) setSearchMatches(new Set());
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connectionId, search]);

  useEffect(() => {
    if (selectedConnectionId && !connections.some((item) => item.id === selectedConnectionId)) {
      setSelectedConnectionId(connectionId ?? null);
    }
  }, [connectionId, connections, selectedConnectionId]);

  useEffect(() => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      let changed = false;
      connectionGroups.forEach((group) => {
        if (!next.has(group.id)) {
          next.add(group.id);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [connectionGroups]);

  const groups = useMemo<SchemaGroup[]>(() => {
    const map = new Map<string, SchemaGroup>();
    const ensure = (name: string): SchemaGroup => {
      let g = map.get(name);
      if (!g) {
        g = { name, tables: [], views: [], functions: [] };
        map.set(name, g);
      }
      return g;
    };
    for (const schema of schemas) ensure(schema);
    for (const r of relations) {
      ensure(r.schema)[r.kind === "view" ? "views" : "tables"].push(r);
    }
    for (const f of functions) {
      ensure(f.schema).functions.push(f);
    }
    const list = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list
      .map((g) => ({
        ...g,
        tables: g.tables.filter((t) =>
          t.name.toLowerCase().includes(q) ||
          searchMatches?.has(relationKey(t.schema, t.name)) ||
          (columnCache[relationKey(t.schema, t.name)]?.columns ?? t.columns ?? []).some((c) => c.name.toLowerCase().includes(q))),
        views: g.views.filter((v) =>
          v.name.toLowerCase().includes(q) ||
          searchMatches?.has(relationKey(v.schema, v.name)) ||
          (columnCache[relationKey(v.schema, v.name)]?.columns ?? v.columns ?? []).some((c) => c.name.toLowerCase().includes(q))),
        functions: g.functions.filter((f) => f.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.tables.length > 0 || g.views.length > 0 || g.functions.length > 0);
  }, [relations, functions, schemas, search, searchMatches, columnCache]);

  const ensureColumns = useCallback(async (schema: string, table: string) => {
    const key = relationKey(schema, table);
    const bundledColumns = relations.find((relation) => relation.schema === schema && relation.name === table)?.columns;
    if (columnCache[key] || bundledColumns !== undefined || !connectionId) return;
    setColumnCache((previous) => ({ ...previous, [key]: { loading: true, error: null, columns: [] } }));
    try {
      const { columns } = await backend.call<{ columns: RelationColumn[] }>("metadata.listColumns", {
        connectionId,
        schema,
        table,
      });
      setColumnCache((previous) => ({ ...previous, [key]: { loading: false, error: null, columns } }));
    } catch (error) {
      setColumnCache((previous) => ({
        ...previous,
        [key]: { loading: false, error: error instanceof Error ? error.message : String(error), columns: [] },
      }));
    }
  }, [columnCache, connectionId, relations]);

  const ensureIndexes = useCallback(async (schema: string, table: string) => {
    const key = relationKey(schema, table);
    if (indexCache[key] || !connectionId) return;
    setIndexCache((prev) => ({ ...prev, [key]: { loading: true, error: null, indexes: [] } }));
    try {
      const { indexes } = await backend.call<{ indexes: IndexInfo[] }>("metadata.listIndexes", {
        connectionId,
        schema,
        table,
      });
      setIndexCache((prev) => ({ ...prev, [key]: { loading: false, error: null, indexes: [...indexes] } }));
    } catch (e) {
      setIndexCache((prev) => ({
        ...prev,
        [key]: { loading: false, error: (e as Error).message, indexes: [] },
      }));
    }
  }, [connectionId, indexCache]);

  const toggleExpand = useCallback((schema: string, name: string, withIndexes: boolean) => {
    const key = relationKey(schema, name);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        void ensureColumns(schema, name);
        if (withIndexes) void ensureIndexes(schema, name);
      }
      return next;
    });
  }, [ensureColumns, ensureIndexes]);

  const openDefinition = useCallback(async (kind: ObjectDefinitionKind, schema: string, name: string) => {
    if (!connectionId) return;
    const title = `${kind === "table" ? "DDL" : "Def"}: ${name}`;
    try {
      const { sql } = await backend.call<{ sql: string }>("metadata.getDefinition", {
        connectionId,
        kind,
        schema,
        name,
      });
      onOpenInNewTab?.(title, sql);
    } catch (e) {
      onOpenInNewTab?.(title, `-- Falha ao obter definição de ${schema}.${name}\n-- ${(e as Error).message}`);
    }
  }, [connectionId, onOpenInNewTab]);

  const openMenu = useCallback((e: React.MouseEvent, items: MenuItem[], moveOptions?: MoveOption[], moveConnectionId?: string) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 28 - 16);
    setMenu({ x, y, items, moveOptions, moveConnectionId, moveSubmenuOpen: false });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMoveSubmenu = useCallback((target: HTMLElement) => {
    const { right: left, top } = target.getBoundingClientRect();
    setMenu((current) => current ? {
      ...current,
      moveSubmenuOpen: true,
      moveSubmenuPosition: { left, top },
    } : current);
  }, []);

  useEffect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, closeMenu]);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = width;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const next = startWidth + (ev.clientX - startX);
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
    }
    function onUp(_ev: PointerEvent) {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(WIDTH_KEY, String(width));
      } catch {
        // localStorage indisponível — largura só não persiste.
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [width]);

  const onResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 16;
    const next = e.key === "ArrowLeft" ? width - step : e.key === "ArrowRight" ? width + step : e.key === "Home" ? MIN_WIDTH : e.key === "End" ? MAX_WIDTH : null;
    if (next === null) return;
    e.preventDefault();
    const bounded = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    setWidth(bounded);
    try {
      localStorage.setItem(WIDTH_KEY, String(bounded));
    } catch {
      // localStorage indisponível — largura só não persiste.
    }
  }, [width]);

  const getMaxConnectionsHeight = useCallback(() => {
    const measured = sidebarRef.current?.clientHeight ?? 0;
    const available = measured > 0 ? measured : DEFAULT_CONNECTIONS_HEIGHT + MIN_OBJECTS_HEIGHT;
    return Math.max(MIN_CONNECTIONS_HEIGHT, available - MIN_OBJECTS_HEIGHT);
  }, []);

  const setConnectionsHeightValue = useCallback((value: number) => {
    const bounded = Math.min(getMaxConnectionsHeight(), Math.max(MIN_CONNECTIONS_HEIGHT, value));
    connectionsHeightRef.current = bounded;
    setConnectionsHeight(bounded);
    try {
      localStorage.setItem(CONNECTIONS_HEIGHT_KEY, String(bounded));
    } catch {
      // localStorage indisponível — altura só não persiste.
    }
  }, [getMaxConnectionsHeight]);

  const onConnectionsResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setResizingConnections(true);
    const startY = e.clientY;
    const startHeight = connectionsHeightRef.current;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    function onMove(event: PointerEvent) {
      setConnectionsHeightValue(startHeight + event.clientY - startY);
    }
    function onUp() {
      setResizingConnections(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [setConnectionsHeightValue]);

  const onConnectionsResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 16;
    const next = e.key === "ArrowUp" ? connectionsHeight - step : e.key === "ArrowDown" ? connectionsHeight + step : e.key === "Home" ? MIN_CONNECTIONS_HEIGHT : e.key === "End" ? getMaxConnectionsHeight() : null;
    if (next === null) return;
    e.preventDefault();
    setConnectionsHeightValue(next);
  }, [connectionsHeight, getMaxConnectionsHeight, setConnectionsHeightValue]);

  const rootConnections = connections.filter((item) => !item.groupId || !connectionGroups.some((group) => group.id === item.groupId));
  const moveOptions: MoveOption[] = [{ id: null, label: "Root" }, ...connectionGroups.map((group) => ({ id: group.id, label: group.name }))];
  const renderConnection = (item: ConnectionEntry) => {
    const isActive = item.id === connectionId;
    const isSelected = item.id === selectedConnectionId;
    return (
      <div
        key={item.id}
        className={`omni-connection-row${isActive ? " active" : ""}${isSelected ? " selected" : ""}`}
        onContextMenu={(event) => openMenu(event, [
          { label: tr("editConnection"), action: () => onEditConnection?.(item.id) },
          { label: tr("duplicateConnection"), action: () => onDuplicateConnection?.(item.id) },
          { label: tr("removeConnection"), action: () => onRemoveConnection?.(item.id) },
          { label: tr("moveTo"), action: () => undefined },
        ], moveOptions, item.id)}
      >
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          className="omni-connection-item"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
            setDraggedConnectionId(item.id);
          }}
          onDragEnd={() => setDraggedConnectionId(null)}
          onClick={() => setSelectedConnectionId(item.id)}
          onDragOver={(event) => event.preventDefault()}
        >
          <DialectIcon dialect={item.dialect} size={13} />
          <span>{item.label}</span>
          {isActive && <span className="omni-active-marker" aria-label={tr("active")}>●</span>}
        </button>
        {isSelected && !isActive && (
          <button
            type="button"
            className="omni-activate-button"
            onClick={() => onSelectConnection?.(item.id)}
          >
            {tr("activate")}
          </button>
        )}
        <Button
          icon={<MoreVerticalRegular fontSize={12} />}
          appearance="transparent"
          size="small"
          className="omni-connection-overflow"
          aria-label={tr("actionsFor").replace("{item}", item.label)}
          onClick={(event) => openMenu(event, [
            { label: tr("editConnection"), action: () => onEditConnection?.(item.id) },
            { label: tr("duplicateConnection"), action: () => onDuplicateConnection?.(item.id) },
            { label: tr("removeConnection"), action: () => onRemoveConnection?.(item.id) },
            { label: tr("moveTo"), action: () => undefined },
          ], moveOptions, item.id)}
        />
      </div>
    );
  };

  if (!open) return null;

  const isSearching = !!search.trim();
  const insertQualified = (schema: string, name: string) => onInsert?.(`${schema}.${name}`);
  const metadataFreshness = getMetadataFreshness(connection?.lastSyncedAt);
  const metadataTimestamp = formatLastSyncedAt(connection?.lastSyncedAt);
  const metadataTooltip = `${metadataRefreshFailed ? `${tr("error")}: ${tr("refreshMetadata")}` : metadataFreshness === "today" ? tr("metadataUpdatedToday") : metadataFreshness === "stale" ? tr("metadataStale") : tr("metadataNotSynced")}${metadataTimestamp ? ` · ${tr("lastSync")}: ${metadataTimestamp}` : ""}`;
  const healthLabel = health === "online" ? "Online" : health === "offline" ? "Offline" : health === "verifying" ? "Verifying…" : "Unknown";

  return (
    <Card
      ref={sidebarRef}
      style={{
        width,
        height: "100%",
        borderRadius: 0,
        background: tokens.colorNeutralBackground2,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        padding: 0,
        position: "relative",
      }}
    >
      <section
        className={`omni-connections-section${connectionsExpanded ? "" : " collapsed"}`}
        style={{ height: connectionsExpanded ? Math.min(connectionsHeight, getMaxConnectionsHeight()) : 32 }}
        aria-labelledby="omni-connections-heading"
      >
        <div className="omni-sidebar-section-header">
          <Button
            appearance="transparent"
            size="small"
            icon={connectionsExpanded ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} />}
            onClick={() => setConnectionsExpanded((value) => !value)}
            aria-expanded={connectionsExpanded}
            aria-controls="omni-connections-content"
          >
            <span id="omni-connections-heading" className="omni-sidebar-section-title">{tr("connections")}</span>
          </Button>
          {connectionsExpanded && <div className="omni-connection-actions">
            <Tooltip content={tr("newConnection")} relationship="label">
              <Button icon={<AddRegular fontSize={12} />} appearance="transparent" size="small" onClick={onAddConnection} aria-label={tr("newConnection")} />
            </Tooltip>
            <Tooltip content={tr("newFolder")} relationship="label">
              <Button
                icon={(
                  <span className="folder-add-icon" aria-hidden="true">
                    <DatabaseRegular fontSize={12} />
                    <AddRegular fontSize={8} />
                  </span>
                )}
                appearance="transparent"
                size="small"
                onClick={() => setNewGroupOpen((value) => !value)}
                aria-label={tr("newFolder")}
              />
            </Tooltip>
          </div>}
        </div>
        {connectionsExpanded && (
          <div id="omni-connections-content" className="omni-connections-content">
            {newGroupOpen && (
              <div className="omni-folder-create">
                <Input
                  value={newGroupName}
                  placeholder="Folder name"
                  onChange={(_, data) => setNewGroupName(data.value)}
                  autoFocus
                />
                <Button
                  size="small"
                  appearance="primary"
                  disabled={!newGroupName.trim()}
                  onClick={() => {
                    const name = newGroupName.trim();
                    if (!name) return;
                    void onCreateConnectionGroup?.(name);
                    setNewGroupName("");
                    setNewGroupOpen(false);
                  }}
                >
                  Create
                </Button>
              </div>
            )}
            <div className="omni-connection-list" role="listbox" aria-label={tr("connections")}>
              {connections.length === 0 ? (
                <Text size={200} style={{ color: tokens.colorNeutralForeground2, padding: "4px 8px" }}>{tr("toolbar.noConnections")}</Text>
              ) : (
                <>
                  {connectionGroups.map((group) => {
                    const members = connections.filter((item) => item.groupId === group.id);
                    const expanded = expandedGroups.has(group.id);
                    return (
                      <div
                        key={group.id}
                        className={`omni-connection-folder${draggedConnectionId ? " drop-ready" : ""}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const connectionId = event.dataTransfer.getData("text/plain") || draggedConnectionId;
                          if (connectionId) void onMoveConnection?.(connectionId, group.id);
                          setDraggedConnectionId(null);
                        }}
                      >
                        <div
                          className="omni-folder-row"
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const connectionId = event.dataTransfer.getData("text/plain") || draggedConnectionId;
                            if (connectionId) void onMoveConnection?.(connectionId, group.id);
                            setDraggedConnectionId(null);
                          }}
                        >
                          <button
                            type="button"
                            className="omni-folder-toggle"
                            aria-expanded={expanded}
                            onClick={() => setExpandedGroups((current) => {
                              const next = new Set(current);
                              if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                              return next;
                            })}
                          >
                            {expanded ? <ChevronDownRegular fontSize={11} /> : <ChevronRightRegular fontSize={11} />}
                            <span>{group.name}</span>
                            <span className="omni-folder-count">{members.length}</span>
                          </button>
                          {renamingGroupId === group.id ? (
                            <div className="omni-folder-edit">
                              <Input value={groupDraft} onChange={(_, data) => setGroupDraft(data.value)} autoFocus />
                              <Button size="small" appearance="transparent" onClick={() => {
                                const name = groupDraft.trim();
                                if (name) void onRenameConnectionGroup?.(group.id, name);
                                setRenamingGroupId(null);
                              }}>OK</Button>
                            </div>
                          ) : (
                            <div className="omni-folder-actions">
                              <Button size="small" appearance="transparent" onClick={() => { setRenamingGroupId(group.id); setGroupDraft(group.name); }} aria-label={`${group.name} ${tr("editConnection")}`} icon={<EditRegular fontSize={11} />} />
                              <Button size="small" appearance="transparent" onClick={() => void onDeleteConnectionGroup?.(group.id)} aria-label={`${group.name} ${tr("removeConnection")}`} icon={<DeleteRegular fontSize={11} />} />
                            </div>
                          )}
                        </div>
                        {expanded && <div className="omni-folder-members">{members.map(renderConnection)}</div>}
                      </div>
                    );
                  })}
                  <div
                    className={`omni-root-connections${draggedConnectionId ? " drop-ready" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const connectionId = event.dataTransfer.getData("text/plain") || draggedConnectionId;
                      if (connectionId) void onMoveConnection?.(connectionId, null);
                      setDraggedConnectionId(null);
                    }}
                  >
                    <div className="omni-root-label">Root connections</div>
                    {rootConnections.map(renderConnection)}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>
      {connectionsExpanded && (
        <div
          className={`connections-resize-handle${resizingConnections ? " resizing" : ""}`}
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={MIN_CONNECTIONS_HEIGHT}
          aria-valuemax={getMaxConnectionsHeight()}
          aria-valuenow={connectionsHeight}
          tabIndex={0}
          aria-label={tr("resizeConnectionsPanel")}
          title={tr("resizeConnectionsPanel")}
          onPointerDown={onConnectionsResizeStart}
          onKeyDown={onConnectionsResizeKeyDown}
        />
      )}
      <div
        style={{
          padding: "10px 12px",
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        {connection ? (
          <div
            className={`omni-connection-chip ${connection.lastSyncedAt ? "synced" : ""}`}
            style={{ flex: "1 1 auto", minWidth: 0 }}
          >
            <DialectIcon dialect={connection.dialect} size={14} />
            <div style={{ minWidth: 0 }}>
              <div className="connection-label" style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connection.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, color: health === "online" ? tokens.colorPaletteGreenForeground1 : health === "offline" ? tokens.colorPaletteRedForeground1 : tokens.colorNeutralForeground2, fontSize: 11 }}>
                {healthLabel}
              </div>
            </div>
          </div>
        ) : (
          <Text weight="semibold" truncate>
            {tr("objects")}
          </Text>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          {loading && <Spinner size="tiny" />}
          {connection && (
            <Tooltip content={metadataTooltip} relationship="description">
              <Button
                icon={metadataRefreshFailed ? <ErrorCircleRegular fontSize={14} style={{ color: tokens.colorPaletteRedForeground1 }} /> : metadataFreshness === "today" ? <CheckmarkCircleRegular fontSize={14} style={{ color: tokens.colorPaletteGreenForeground1 }} /> : metadataFreshness === "stale" ? <WarningRegular fontSize={14} style={{ color: tokens.colorPaletteYellowForeground1 }} /> : <CircleRegular fontSize={13} style={{ color: tokens.colorNeutralForeground3 }} />}
                appearance="transparent"
                size="small"
                onClick={onRefreshMetadata}
                disabled={!connectionId || loading}
                aria-label={tr("refreshMetadata")}
              />
            </Tooltip>
          )}
          <SidecarStatus />
        </div>
      </div>
      <div style={{ padding: 8 }}>
        <Input
          placeholder={tr("searchObjects")}
          value={search}
          onChange={(_, data) => setSearch(data.value)}
          contentBefore={<SearchRegular fontSize={12} />}
          contentAfter={
            search ? (
              <Button
                appearance="transparent"
                icon={<DismissRegular fontSize={12} />}
                onClick={() => setSearch("")}
                aria-label={tr("clearSearch")}
              />
            ) : undefined
          }
          style={{ width: "100%" }}
        />
      </div>
      <div className="omni-sidebar-tree" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "0 8px 8px" }}>
        {groups.length === 0 ? (
          <Text size={200} style={{ color: tokens.colorNeutralForeground2, padding: 8 }}>
            {loading ? tr("loading") : search ? tr("noResults") : tr("noObjects")}
          </Text>
        ) : (
          groups.map((g) => (
            <TreeNode
              key={g.name}
              label={<Text weight="semibold">{g.name}</Text>}
              icon={<DatabaseRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />}
              defaultExpanded={isSearching}
              forceExpanded={isSearching || undefined}
              onContextMenu={(event) => openMenu(event, [
                { label: tr("createTable"), action: () => setCreateTableSchema(g.name) },
              ])}
            >
              <TreeNode
                  label={`${tr("tables")} (${g.tables.length})`}
                  icon={<TableRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />}
                  defaultExpanded={isSearching}
                  forceExpanded={isSearching || undefined}
                  onContextMenu={(event) => openMenu(event, [
                    { label: tr("createTable"), action: () => setCreateTableSchema(g.name) },
                  ])}
                >
                  {g.tables.map((t) => {
                    const key = relationKey(g.name, t.name);
                    const isOpen = expanded.has(key);
                    const indexState = indexCache[key];
                    const columnState = columnCache[key];
                    const columns = columnState?.columns ?? t.columns ?? [];
                    return (
                      <div key={key} style={{ marginLeft: 10 }}>
                        <div
                          className="obj-row"
                          role="presentation"
                          onContextMenu={(e) =>
                            openMenu(e, [
                              { label: tr("insertInEditor"), action: () => insertQualified(g.name, t.name) },
                              { label: tr("viewStructure"), action: () => setStructureTable({ schema: g.name, table: t.name }) },
                              { label: tr("generateDdl"), action: () => void openDefinition("table", g.name, t.name) },
                            ])
                          }
                        >
                          <TreeNode
                            label={
                              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <TableRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {t.name}
                                </span>
                              </span>
                            }
                            defaultExpanded={false}
                            forceExpanded={isOpen || undefined}
                            onExpandedChange={(nextExpanded) => {
                              if (nextExpanded) {
                                void ensureColumns(g.name, t.name);
                                void ensureIndexes(g.name, t.name);
                              }
                            }}
                            actions={
                              <Tooltip content={tr("insertObject").replace("{object}", `${g.name}.${t.name}`)} relationship="label">
                                <Button
                                  appearance="transparent"
                                  size="small"
                                  icon={<ArrowEnterRegular fontSize={11} />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    insertQualified(g.name, t.name);
                                  }}
                                  style={{ padding: 0, height: "auto", minWidth: 0 }}
                                  aria-label={tr("insertObject").replace("{object}", `${g.name}.${t.name}`)}
                                />
                              </Tooltip>
                            }
                          >
                            <div className="columns">
                              <div className="sub-header"><span>{tr("columns")}{(columnState && !columnState.loading && !columnState.error) || t.columns !== undefined ? ` (${columns.length})` : ""}</span></div>
                              {((columnState?.loading ?? t.columns === undefined)) && <p className="sub-hint">{tr("loading")}</p>}
                              {columnState?.error && <p className="sub-hint error">{columnState.error}</p>}
                              {!columnState?.loading && !columnState?.error && columns.map((c) => {
                                const ColumnIcon = typeIcon(c.dataType);
                                return (
                                  <div
                                    key={c.name}
                                    className="column"
                                    title={`${c.name}: ${c.dataType}${c.nullable ? "" : " NOT NULL"}${c.isPrimaryKey ? " — PK" : ""}${c.foreignKeyTo ? ` — FK → ${c.foreignKeyTo.schema}.${c.foreignKeyTo.table}.${c.foreignKeyTo.column}` : ""}`}
                                  >
                                    {c.isPrimaryKey ? (
                                      <>
                                        <LinkRegular fontSize={10} style={{ color: tokens.colorPaletteDarkOrangeForeground1 }} />
                                        <span className="badge badge-pk">PK</span>
                                      </>
                                    ) : c.foreignKeyTo ? (
                                      <>
                                        <LinkRegular fontSize={10} style={{ color: tokens.colorPaletteBlueForeground2 }} />
                                        <span className="badge badge-fk">FK</span>
                                      </>
                                    ) : (
                                      <ColumnIcon fontSize={10} style={{ color: tokens.colorNeutralForeground3 }} />
                                    )}
                                    <span className="col-name">{c.name}</span>
                                    <span className="col-type">{c.dataType}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="indexes">
                              <div className="sub-header">
                                <span>
                                  {tr("indexes")}
                                  {indexState && !indexState.loading && !indexState.error ? ` (${indexState.indexes.length})` : ""}
                                </span>
                              </div>
                              {(!indexState || indexState.loading) && (
                                <p className="sub-hint">{tr("loading")}</p>
                              )}
                              {indexState?.error && (
                                <p className="sub-hint error">{indexState.error}</p>
                              )}
                              {indexState && !indexState.loading && !indexState.error && indexState.indexes.length === 0 && (
                                <p className="sub-hint">{tr("noIndexes")}</p>
                              )}
                              {indexState && !indexState.loading && !indexState.error && indexState.indexes.length > 0 && (
                                <div className="columns">
                                  {indexState.indexes.map((idx) => (
                                    <div
                                      key={idx.name}
                                      className="column"
                                      title={`${idx.name}: ${idx.columns.join(", ")}`}
                                    >
                                      {idx.primary ? (
                                        <>
                                          <LinkRegular fontSize={10} style={{ color: tokens.colorPaletteDarkOrangeForeground1 }} />
                                          <span className="badge badge-pk">PK</span>
                                        </>
                                      ) : (
                                        <span className="col-dot" />
                                      )}
                                      <span className="col-name">{idx.name}</span>
                                      <span className="col-type">{idx.unique ? "UNIQUE " : ""}({idx.columns.join(", ")})</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </TreeNode>
                          <button
                            className="obj-expand-trigger"
                            type="button"
                            aria-label={tr("expandCollapse")}
                            title={tr("expandCollapse")}
                            onClick={() => toggleExpand(g.name, t.name, true)}
                            tabIndex={-1}
                          />
                        </div>
                      </div>
                    );
                  })}
                </TreeNode>
              {g.views.length > 0 && (
                <TreeNode
                  label={`${tr("views")} (${g.views.length})`}
                  icon={<EyeRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />}
                  defaultExpanded={isSearching}
                  forceExpanded={isSearching || undefined}
                >
                  {g.views.map((v) => {
                    const key = relationKey(g.name, v.name);
                    const isOpen = expanded.has(key);
                    const columnState = columnCache[key];
                    const columns = columnState?.columns ?? v.columns ?? [];
                    return (
                      <div key={key} style={{ marginLeft: 10 }}>
                        <div
                          className="obj-row"
                          role="presentation"
                          onContextMenu={(e) =>
                            openMenu(e, [
                              { label: tr("insertInEditor"), action: () => insertQualified(g.name, v.name) },
                              { label: tr("viewDefinition"), action: () => void openDefinition("view", g.name, v.name) },
                            ])
                          }
                        >
                          <TreeNode
                            label={
                              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <EyeRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {v.name}
                                </span>
                              </span>
                            }
                            defaultExpanded={false}
                            forceExpanded={isOpen || undefined}
                            onExpandedChange={(nextExpanded) => {
                              if (nextExpanded) void ensureColumns(g.name, v.name);
                            }}
                            actions={
                              <Tooltip content={tr("insertObject").replace("{object}", `${g.name}.${v.name}`)} relationship="label">
                                <Button
                                  appearance="transparent"
                                  size="small"
                                  icon={<ArrowEnterRegular fontSize={11} />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    insertQualified(g.name, v.name);
                                  }}
                                  style={{ padding: 0, height: "auto", minWidth: 0 }}
                                  aria-label={tr("insertObject").replace("{object}", `${g.name}.${v.name}`)}
                                />
                              </Tooltip>
                            }
                          >
                            <div className="columns">
                              {(columnState?.loading ?? v.columns === undefined) && <p className="sub-hint">{tr("loading")}</p>}
                              {columnState?.error && <p className="sub-hint error">{columnState.error}</p>}
                              {!columnState?.loading && !columnState?.error && columns.map((c) => {
                                const ColumnIcon = typeIcon(c.dataType);
                                return (
                                  <div key={c.name} className="column">
                                    <ColumnIcon fontSize={10} style={{ color: tokens.colorNeutralForeground3 }} />
                                    <span className="col-name">{c.name}</span>
                                    <span className="col-type">{c.dataType}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </TreeNode>
                          <button
                            className="obj-expand-trigger"
                            type="button"
                            aria-label={tr("expandCollapse")}
                            title={tr("expandCollapse")}
                            onClick={() => toggleExpand(g.name, v.name, false)}
                            tabIndex={-1}
                          />
                        </div>
                      </div>
                    );
                  })}
                </TreeNode>
              )}
              {g.functions.length > 0 && (
                <TreeNode
                  label={`${tr("functions")} (${g.functions.length})`}
                  icon={<NumberSymbolRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />}
                  defaultExpanded={isSearching}
                  forceExpanded={isSearching || undefined}
                >
                  {g.functions.map((f) => {
                    return (
                      <div
                        key={relationKey(g.name, f.name)}
                        className="obj-row"
                        role="presentation"
                        style={{ marginLeft: 10 }}
                        onContextMenu={(e) =>
                          openMenu(e, [
                            { label: tr("insertInEditor"), action: () => insertQualified(g.name, f.name) },
                            { label: tr("viewDefinition"), action: () => void openDefinition("function", g.name, f.name) },
                          ])
                        }
                      >
                        <NumberSymbolRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />
                        <Button
                          appearance="transparent"
                          size="small"
                          onClick={() => insertQualified(g.name, f.name)}
                          style={{ padding: 0, height: "auto", minWidth: 0, flex: 1, justifyContent: "flex-start" }}
                        >
                          <span className="obj-name">{f.name}</span>
                        </Button>
                        <Tooltip content={tr("insertObject").replace("{object}", `${g.name}.${f.name}`)} relationship="label">
                          <Button
                            appearance="transparent"
                            size="small"
                            icon={<ArrowEnterRegular fontSize={11} />}
                            onClick={() => insertQualified(g.name, f.name)}
                            style={{ padding: 0, height: "auto", minWidth: 0 }}
                            aria-label={tr("insertObject").replace("{object}", `${g.name}.${f.name}`)}
                          />
                        </Tooltip>
                      </div>
                    );
                  })}
                </TreeNode>
              )}
            </TreeNode>
          ))
        )}
      </div>
      {connection && <CreateTableDialog
        open={createTableSchema !== null}
        dialect={connection.dialect}
        schemas={schemas}
        initialSchema={createTableSchema ?? undefined}
        onClose={() => setCreateTableSchema(null)}
        onOpenSql={(title, sql) => onOpenInNewTab?.(title, sql)}
      />}
      <TableStructureDialog
        open={structureTable !== null}
        connectionId={connectionId ?? null}
        dialect={connection?.dialect ?? "postgres"}
        schema={structureTable?.schema ?? ""}
        table={structureTable?.table ?? ""}
        onClose={() => setStructureTable(null)}
        onOpenSql={(title, sql) => onOpenInNewTab?.(title, sql)}
      />
      <div
        className={`resize-handle ${resizing ? "resizing" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        aria-label={tr("resizeObjectPanel")}
        title={tr("resizeObjectPanel")}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
      />
      {menu && (
        <>
          <div
            className="menu-overlay"
            role="presentation"
            onPointerDown={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeMenu();
            }}
          />
          <div
            className="context-menu-container"
            onMouseLeave={() => setMenu((current) => current?.moveSubmenuOpen ? { ...current, moveSubmenuOpen: false } : current)}
          >
            <ul className="context-menu" style={{ left: menu.x, top: menu.y }}>
              {menu.items.map((item, i) => (
                <li
                  key={i}
                  onMouseEnter={() => {
                    if (item.label !== tr("moveTo")) {
                      setMenu((current) => current?.moveSubmenuOpen ? { ...current, moveSubmenuOpen: false } : current);
                    }
                  }}
                >
                  <button
                    type="button"
                    className={item.label === tr("moveTo") ? "has-submenu" : undefined}
                    onMouseEnter={(event) => {
                      if (item.label === tr("moveTo") && menu.moveOptions) {
                        openMoveSubmenu(event.currentTarget);
                      }
                    }}
                    onClick={(event) => {
                      if (item.label === tr("moveTo") && menu.moveOptions) {
                        openMoveSubmenu(event.currentTarget);
                        return;
                      }
                      item.action();
                      closeMenu();
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
            {menu.moveSubmenuOpen && menu.moveOptions && menu.moveConnectionId && menu.moveSubmenuPosition && (
              <ul className="context-menu context-submenu" style={menu.moveSubmenuPosition}>
                {menu.moveOptions.map((option) => (
                  <li key={option.id ?? "root"}>
                    <button
                      type="button"
                      onClick={() => {
                        void onMoveConnection?.(menu.moveConnectionId!, option.id);
                        closeMenu();
                      }}
                    >
                      {option.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
