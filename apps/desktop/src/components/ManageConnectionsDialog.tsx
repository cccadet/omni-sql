import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from "@fluentui/react-components";
import {
  AddRegular,
  CheckmarkRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
  FolderRegular,
  MoreHorizontalRegular,
  ReOrderDotsVerticalRegular,
  SearchRegular,
  TextBulletListLtrRegular,
} from "@fluentui/react-icons";
import { DialectIcon } from "./DialectIcon";
import { EnvironmentBadge } from "./ConnectionSwitcher";
import type { ConnectionEntry, ConnectionGroup } from "../lib/backend";
import { DIALECT_LABELS } from "../lib/dialect-labels";
import { formatUsageAge, type ConnectionUsage } from "../lib/recent-connections";
import { useLanguage } from "../i18n";

const ROOT_DROP_ID = "connection-group:root";
const groupDropId = (groupId: string) => `connection-group:${groupId}`;

/** Drop target → folder id: `null` is "No folder", `undefined` is not a folder. */
export function connectionGroupIdFromDrop(overId: string | number | null): string | null | undefined {
  if (overId === null) return undefined;
  const value = String(overId);
  if (value === ROOT_DROP_ID) return null;
  const prefix = "connection-group:";
  return value.startsWith(prefix) ? value.slice(prefix.length) : undefined;
}

/** Dragging a selected row moves the whole selection; any other row moves alone. */
export function connectionMoveFromDrag(activeId: string | number, overId: string | number | null, selected: ReadonlySet<string> = new Set()) {
  const groupId = connectionGroupIdFromDrop(overId);
  if (groupId === undefined) return null;
  const id = String(activeId);
  return { connectionIds: selected.has(id) ? [...selected] : [id], groupId };
}

/** The folder under the pointer wins; keyboard drags have no pointer, so fall back to overlap. */
const folderCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

type Folder = "all" | "root" | string;

function FolderDropTarget({ id, className, children }: { id: string; className: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className}${isOver ? " is-drop-over" : ""}`}>{children}</div>;
}

function DragHandle({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });
  return (
    <button ref={setNodeRef} type="button" className="omni-manage-drag-handle" aria-label={label} {...attributes} {...listeners} style={{ touchAction: "none" }}>
      <ReOrderDotsVerticalRegular fontSize={14} />
    </button>
  );
}

export interface ManageConnectionsDialogProps {
  open: boolean;
  onClose: () => void;
  connections: readonly ConnectionEntry[];
  groups: readonly ConnectionGroup[];
  usage: ConnectionUsage;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (ids: string[]) => Promise<void> | void;
  onMove: (id: string, groupId: string | null) => Promise<void>;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (id: string, name: string) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
}

export function ManageConnectionsDialog({
  open,
  onClose,
  connections,
  groups,
  usage,
  onAdd,
  onEdit,
  onDuplicate,
  onRemove,
  onMove,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
}: ManageConnectionsDialogProps) {
  const { t } = useLanguage();
  const [folder, setFolder] = useState<Folder>("all");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const groupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups]);
  const folderOf = (connection: ConnectionEntry) => connection.groupId && groupIds.has(connection.groupId) ? connection.groupId : null;

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setFilter("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (folder !== "all" && folder !== "root" && !groupIds.has(folder)) setFolder("all");
  }, [folder, groupIds]);

  useEffect(() => {
    setSelected((current) => {
      const existing = new Set(connections.map((connection) => connection.id));
      const next = new Set([...current].filter((id) => existing.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [connections]);

  const inFolder = connections.filter((connection) => folder === "all" || (folder === "root" ? folderOf(connection) === null : folderOf(connection) === folder));
  const needle = filter.trim().toLocaleLowerCase();
  const rows = needle ? inFolder.filter((connection) => connection.label.toLocaleLowerCase().includes(needle) || connection.endpoint.toLocaleLowerCase().includes(needle)) : inFolder;
  const selectedRows = rows.filter((connection) => selected.has(connection.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const folderTitle = folder === "all" ? t("allConnections") : folder === "root" ? t("noFolder") : groups.find((group) => group.id === folder)?.name ?? "";

  const run = async (action: () => Promise<void> | void) => {
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const moveMany = (ids: readonly string[], groupId: string | null) => run(async () => {
    for (const id of ids) await onMove(id, groupId);
  });
  const toggle = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    void run(async () => {
      await onCreateGroup(name);
      setNewFolderName("");
      setNewFolderOpen(false);
    });
  };
  const commitRename = () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    const target = renaming.id;
    setRenaming(null);
    if (name && name !== groups.find((group) => group.id === target)?.name) void run(() => onRenameGroup(target, name));
  };
  const deleteFolder = (group: ConnectionGroup) => {
    if (!window.confirm(t("deleteFolderConfirm").replace("{name}", group.name))) return;
    void run(() => onDeleteGroup(group.id));
  };
  const leaveFor = (action: () => void) => {
    onClose();
    action();
  };

  const folderEntries: { key: Folder; dropId?: string; label: string; count: number; group?: ConnectionGroup }[] = [
    { key: "all", label: t("allConnections"), count: connections.length },
    ...groups.map((group) => ({ key: group.id, dropId: groupDropId(group.id), label: group.name, count: connections.filter((connection) => folderOf(connection) === group.id).length, group })),
    { key: "root", dropId: ROOT_DROP_ID, label: t("noFolder"), count: connections.filter((connection) => folderOf(connection) === null).length },
  ];
  const dragged = draggedId ? connections.find((connection) => connection.id === draggedId) : undefined;
  const dragCount = draggedId && selected.has(draggedId) ? selected.size : 1;

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className="omni-standard-dialog omni-manage-connections-dialog">
        <DialogBody className="omni-dialog-body omni-manage-body">
          <div className="omni-mcp-dialog-header omni-manage-header">
            <DialogTitle>{t("manageConnections")}</DialogTitle>
            <Button appearance="subtle" size="small" icon={<DismissRegular />} aria-label={t("close")} title={t("close")} onClick={onClose} />
          </div>
          <DialogContent className="omni-manage-content">
            <DndContext
              sensors={sensors}
              collisionDetection={folderCollision}
              onDragStart={(event) => setDraggedId(String(event.active.id))}
              onDragCancel={() => setDraggedId(null)}
              onDragEnd={(event: DragEndEvent) => {
                setDraggedId(null);
                const move = connectionMoveFromDrag(event.active.id, event.over?.id ?? null, selected);
                if (move) void moveMany(move.connectionIds, move.groupId);
              }}
            >
              <nav className="omni-manage-folders" aria-label={t("folders")}>
                <div className="omni-manage-label">{t("folders")}</div>
                {folderEntries.map((entry) => {
                  const content = (
                    <div className={`omni-manage-folder${folder === entry.key ? " is-current" : ""}`}>
                      {renaming && entry.group && renaming.id === entry.group.id ? (
                        <Input
                          size="small"
                          className="omni-manage-folder-input"
                          value={renaming.name}
                          aria-label={t("folderName")}
                          autoFocus
                          onChange={(_, data) => setRenaming({ id: renaming.id, name: data.value })}
                          onBlur={commitRename}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") { event.preventDefault(); commitRename(); }
                            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRenaming(null); }
                          }}
                        />
                      ) : (
                        <button type="button" className="omni-manage-folder-button" aria-current={folder === entry.key ? "true" : undefined} onClick={() => { setFolder(entry.key); setSelected(new Set()); }}>
                          {entry.key === "all" ? <TextBulletListLtrRegular fontSize={14} aria-hidden /> : <FolderRegular fontSize={14} aria-hidden />}
                          <span className="omni-manage-folder-name">{entry.label}</span>
                          <span className="omni-switcher-count">{entry.count}</span>
                        </button>
                      )}
                      {entry.group && renaming?.id !== entry.group.id && <span className="omni-manage-folder-actions">
                        <Button appearance="subtle" size="small" icon={<EditRegular fontSize={14} />} aria-label={t("renameFolderNamed").replace("{name}", entry.group.name)} title={t("renameFolder")} onClick={() => setRenaming({ id: entry.group!.id, name: entry.group!.name })} />
                        <Button appearance="subtle" size="small" icon={<DeleteRegular fontSize={14} />} aria-label={t("deleteFolderNamed").replace("{name}", entry.group.name)} title={t("deleteFolder")} onClick={() => deleteFolder(entry.group!)} />
                      </span>}
                    </div>
                  );
                  return entry.dropId
                    ? <FolderDropTarget key={entry.key} id={entry.dropId} className={`omni-manage-drop${draggedId ? " is-drop-ready" : ""}`}>{content}</FolderDropTarget>
                    : <div key={entry.key}>{content}</div>;
                })}
                {newFolderOpen ? (
                  <Input
                    size="small"
                    className="omni-manage-new-folder"
                    value={newFolderName}
                    placeholder={t("folderName")}
                    aria-label={t("folderName")}
                    autoFocus
                    contentBefore={<FolderRegular fontSize={14} />}
                    contentAfter={<Button appearance="transparent" size="small" icon={<CheckmarkRegular />} aria-label={t("createFolder")} disabled={!newFolderName.trim()} onClick={createFolder} />}
                    onChange={(_, data) => setNewFolderName(data.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); createFolder(); }
                      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setNewFolderOpen(false); setNewFolderName(""); }
                    }}
                  />
                ) : <span className="omni-manage-spacer" />}
                <Button appearance="outline" size="small" icon={<AddRegular />} className="omni-manage-add-folder" onClick={() => setNewFolderOpen(true)}>{t("newFolder")}</Button>
              </nav>

              <section className="omni-manage-main" aria-label={folderTitle}>
                <div className="omni-manage-toolbar">
                  <Input
                    size="small"
                    className="omni-manage-filter"
                    value={filter}
                    placeholder={t("filterConnectionsPlaceholder")}
                    aria-label={t("filterConnections")}
                    contentBefore={<SearchRegular fontSize={14} />}
                    onChange={(_, data) => setFilter(data.value)}
                  />
                  <span className="omni-manage-toolbar-spacer" />
                  {selectedRows.length > 0 && <>
                    <span className="omni-manage-selection" role="status">{t("selectedCount").replace("{count}", String(selectedRows.length))}</span>
                    <Menu>
                      <MenuTrigger disableButtonEnhancement>
                        <Button size="small">{t("moveTo")}</Button>
                      </MenuTrigger>
                      <MenuPopover>
                        <MenuList>
                          {groups.map((group) => <MenuItem key={group.id} onClick={() => void moveMany(selectedRows.map((connection) => connection.id), group.id)}>{group.name}</MenuItem>)}
                          <MenuItem onClick={() => void moveMany(selectedRows.map((connection) => connection.id), null)}>{t("noFolder")}</MenuItem>
                        </MenuList>
                      </MenuPopover>
                    </Menu>
                    <Button size="small" className="omni-button-danger" onClick={() => void run(() => onRemove(selectedRows.map((connection) => connection.id)))}>{t("remove")}</Button>
                  </>}
                  <Button appearance="primary" size="small" icon={<AddRegular />} onClick={() => leaveFor(onAdd)}>{t("newConnection")}</Button>
                </div>
                {error && <div className="omni-mcp-error" role="alert">{error}</div>}
                <div className="omni-manage-table-wrap">
                  {rows.length === 0 ? (
                    <div className="omni-empty-state">{needle ? t("noConnectionsMatch") : t("folderEmpty")}</div>
                  ) : (
                    <table className="omni-manage-table">
                      <caption className="omni-visually-hidden">{folderTitle}</caption>
                      <thead>
                        <tr>
                          <th className="is-narrow"><Checkbox checked={allSelected ? true : selectedRows.length > 0 ? "mixed" : false} aria-label={t("selectAll")} onChange={(_, data) => setSelected(data.checked === true ? new Set(rows.map((connection) => connection.id)) : new Set())} /></th>
                          <th className="is-narrow"><span className="omni-visually-hidden">{t("dragToFolder")}</span></th>
                          <th>{t("name")}</th>
                          <th>{t("type")}</th>
                          <th>{t("connectionEnvironment")}</th>
                          <th>{t("host")}</th>
                          <th>{t("lastUsed")}</th>
                          <th className="is-narrow"><span className="omni-visually-hidden">{t("actions")}</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((connection) => {
                          const age = formatUsageAge(usage[connection.id]);
                          return (
                            <tr key={connection.id} className={selected.has(connection.id) ? "is-selected" : undefined} style={{ opacity: draggedId && (draggedId === connection.id || (selected.has(draggedId) && selected.has(connection.id))) ? 0.5 : undefined }}>
                              <td><Checkbox checked={selected.has(connection.id)} aria-label={t("selectItem").replace("{item}", connection.label)} onChange={(_, data) => toggle(connection.id, data.checked === true)} /></td>
                              <td><DragHandle id={connection.id} label={t("dragItemToFolder").replace("{item}", connection.label)} /></td>
                              <td><span className="omni-manage-name"><DialectIcon dialect={connection.dialect} size={14} /><strong>{connection.label}</strong></span></td>
                              <td>{DIALECT_LABELS[connection.dialect] ?? connection.dialect}</td>
                              <td><EnvironmentBadge connection={connection} /></td>
                              <td className="omni-manage-host" title={connection.endpoint}>{connection.endpoint}</td>
                              <td className="omni-manage-muted">{age === null ? "—" : age === "now" ? t("justNow") : t("ageAgo").replace("{age}", age)}</td>
                              <td>
                                <Menu>
                                  <MenuTrigger disableButtonEnhancement>
                                    <Button appearance="subtle" size="small" icon={<MoreHorizontalRegular />} aria-label={t("actionsFor").replace("{item}", connection.label)} />
                                  </MenuTrigger>
                                  <MenuPopover>
                                    <MenuList>
                                      <MenuItem onClick={() => leaveFor(() => onEdit(connection.id))}>{t("editConnection")}</MenuItem>
                                      <MenuItem onClick={() => leaveFor(() => onDuplicate(connection.id))}>{t("duplicateConnection")}</MenuItem>
                                      <MenuItem className="omni-menu-danger" onClick={() => void run(() => onRemove([connection.id]))}>{t("removeConnectionEllipsis")}</MenuItem>
                                    </MenuList>
                                  </MenuPopover>
                                </Menu>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
              {/* The dialog surface is transformed, which would offset a fixed overlay rendered inside it. */}
              {createPortal(
                <DragOverlay dropAnimation={null} zIndex={1000000}>
                  {dragged && <div className="omni-manage-drag-ghost">
                    <DialectIcon dialect={dragged.dialect} size={14} />
                    {dragged.label}
                    {dragCount > 1 && <span className="omni-manage-drag-count">+{dragCount - 1}</span>}
                  </div>}
                </DragOverlay>,
                document.body,
              )}
            </DndContext>
          </DialogContent>
          <DialogActions className="omni-dialog-actions omni-mcp-dialog-actions omni-manage-actions">
            <span className="omni-manage-footer-hint">{t("manageConnectionsHint")}</span>
            <Button appearance="secondary" onClick={onClose}>{t("close")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
