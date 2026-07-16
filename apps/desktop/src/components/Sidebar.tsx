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
  ArrowSyncRegular,
  ArrowEnterRegular,
  LinkRegular,
  DatabaseRegular,
  TableRegular,
  EyeRegular,
  NumberSymbolRegular,
} from "@fluentui/react-icons";
import { DialectIcon } from "./DialectIcon";
import { typeIcon } from "../lib/type-icon";
import { backend, type ConnectionEntry, type RelationInfo } from "../lib/backend";
import type { FunctionDef, IndexInfo, ObjectDefinitionKind } from "@omni-sql/ts-types";

export interface SidebarProps {
  open?: boolean;
  connection?: ConnectionEntry | null;
  connectionId?: string | null;
  relations?: RelationInfo[];
  functions?: FunctionDef[];
  loading?: boolean;
  onInsert?: (text: string) => void;
  onRefresh?: () => void;
  onOpenInNewTab?: (title: string, sql: string) => void;
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
}

function TreeNode({ label, icon, children, defaultExpanded = false, forceExpanded, actions, onContextMenu }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isExpanded = forceExpanded ?? expanded;
  const hasChildren = Boolean(children);
  return (
    <div style={{ marginLeft: 10 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, cursor: hasChildren ? "pointer" : "default", padding: "2px 0" }}
        onClick={() => hasChildren && setExpanded((v) => !v)}
        onContextMenu={onContextMenu}
      >
        {hasChildren ? (
          isExpanded ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} />
        ) : (
          <span style={{ width: 12 }} />
        )}
        {icon}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
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

const MIN_WIDTH = 160;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 260;
const WIDTH_KEY = "omni-sql:sidebarWidth";

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

export function Sidebar({
  open = true,
  connection,
  connectionId,
  relations = [],
  functions = [],
  loading = false,
  onInsert,
  onRefresh,
  onOpenInNewTab,
}: SidebarProps) {
  const [search, setSearch] = useState("");
  const [width, setWidth] = useState(loadWidth);
  const [resizing, setResizing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [indexCache, setIndexCache] = useState<Record<string, { loading: boolean; error: string | null; indexes: IndexInfo[] }>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

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
        tables: g.tables.filter(
          (t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q)),
        ),
        views: g.views.filter(
          (v) => v.name.toLowerCase().includes(q) || v.columns.some((c) => c.name.toLowerCase().includes(q)),
        ),
        functions: g.functions.filter((f) => f.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.tables.length > 0 || g.views.length > 0 || g.functions.length > 0);
  }, [relations, functions, search]);

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
        if (withIndexes) void ensureIndexes(schema, name);
      }
      return next;
    });
  }, [ensureIndexes]);

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

  const openMenu = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 28 - 16);
    setMenu({ x, y, items });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

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

  if (!open) return null;

  const isSearching = !!search.trim();
  const insertQualified = (schema: string, name: string) => onInsert?.(`${schema}.${name}`);

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
        padding: 0,
        position: "relative",
      }}
    >
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
          <div className={`omni-connection-chip ${connection.lastSyncedAt ? "synced" : ""}`}>
            <DialectIcon dialect={connection.dialect} size={14} />
            <span className="connection-label" style={{ fontWeight: 600 }}>{connection.label}</span>
            <span className={`status ${connection.lastSyncedAt ? "synced" : ""}`}>
              {connection.lastSyncedAt ? "conectado" : "não sincronizado"}
            </span>
          </div>
        ) : (
          <Text weight="semibold" truncate>
            Objetos
          </Text>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {loading && <Spinner size="tiny" />}
          <Tooltip content="Atualizar objetos" relationship="label">
            <Button
              icon={<ArrowSyncRegular fontSize={12} />}
              appearance="transparent"
              size="small"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Atualizar objetos"
            />
          </Tooltip>
        </div>
      </div>
      <div style={{ padding: 8 }}>
        <Input
          placeholder="Buscar tabelas, colunas..."
          value={search}
          onChange={(_, data) => setSearch(data.value)}
          contentBefore={<SearchRegular fontSize={12} />}
          contentAfter={
            search ? (
              <Button
                appearance="transparent"
                icon={<DismissRegular fontSize={12} />}
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
              />
            ) : undefined
          }
          style={{ width: "100%" }}
        />
      </div>
      <div className="omni-sidebar-tree" style={{ flex: 1, overflow: "auto", padding: "0 8px 8px" }}>
        {groups.length === 0 ? (
          <Text size={200} style={{ color: tokens.colorNeutralForeground2, padding: 8 }}>
            {loading ? "Carregando..." : search ? "Nenhum resultado." : "Nenhum objeto disponível."}
          </Text>
        ) : (
          groups.map((g) => (
            <TreeNode
              key={g.name}
              label={<Text weight="semibold">{g.name}</Text>}
              icon={<DatabaseRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />}
              defaultExpanded={isSearching}
              forceExpanded={isSearching || undefined}
            >
              {g.tables.length > 0 && (
                <TreeNode
                  label={`Tabelas (${g.tables.length})`}
                  icon={<TableRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />}
                  defaultExpanded={isSearching}
                  forceExpanded={isSearching || undefined}
                >
                  {g.tables.map((t) => {
                    const key = relationKey(g.name, t.name);
                    const isOpen = isSearching || expanded.has(key);
                    const indexState = indexCache[key];
                    return (
                      <div key={key} style={{ marginLeft: 10 }}>
                        <div
                          className="obj-row"
                          role="presentation"
                          onContextMenu={(e) =>
                            openMenu(e, [
                              { label: "Inserir no editor", action: () => insertQualified(g.name, t.name) },
                              { label: "Gerar DDL em nova aba", action: () => void openDefinition("table", g.name, t.name) },
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
                            defaultExpanded={isSearching}
                            forceExpanded={isOpen || undefined}
                            actions={
                              <Tooltip content={`Inserir ${g.name}.${t.name}`} relationship="label">
                                <Button
                                  appearance="transparent"
                                  size="small"
                                  icon={<ArrowEnterRegular fontSize={11} />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    insertQualified(g.name, t.name);
                                  }}
                                  style={{ padding: 0, height: "auto", minWidth: 0 }}
                                  aria-label={`Inserir ${g.name}.${t.name}`}
                                />
                              </Tooltip>
                            }
                          >
                            <div className="columns">
                              <div className="sub-header"><span>Colunas ({t.columns.length})</span></div>
                              {t.columns.map((c) => {
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
                                  Índices
                                  {indexState && !indexState.loading && !indexState.error ? ` (${indexState.indexes.length})` : ""}
                                </span>
                              </div>
                              {(!indexState || indexState.loading) && (
                                <p className="sub-hint">Carregando...</p>
                              )}
                              {indexState?.error && (
                                <p className="sub-hint error">{indexState.error}</p>
                              )}
                              {indexState && !indexState.loading && !indexState.error && indexState.indexes.length === 0 && (
                                <p className="sub-hint">Nenhum índice.</p>
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
                            aria-label="Expandir/recolher"
                            onClick={() => toggleExpand(g.name, t.name, true)}
                            tabIndex={-1}
                          />
                        </div>
                      </div>
                    );
                  })}
                </TreeNode>
              )}
              {g.views.length > 0 && (
                <TreeNode
                  label={`Views (${g.views.length})`}
                  icon={<EyeRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />}
                  defaultExpanded={isSearching}
                  forceExpanded={isSearching || undefined}
                >
                  {g.views.map((v) => {
                    const key = relationKey(g.name, v.name);
                    const isOpen = isSearching || expanded.has(key);
                    return (
                      <div key={key} style={{ marginLeft: 10 }}>
                        <div
                          className="obj-row"
                          role="presentation"
                          onContextMenu={(e) =>
                            openMenu(e, [
                              { label: "Inserir no editor", action: () => insertQualified(g.name, v.name) },
                              { label: "Ver definição em nova aba", action: () => void openDefinition("view", g.name, v.name) },
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
                            defaultExpanded={isSearching}
                            forceExpanded={isOpen || undefined}
                            actions={
                              <Tooltip content={`Inserir ${g.name}.${v.name}`} relationship="label">
                                <Button
                                  appearance="transparent"
                                  size="small"
                                  icon={<ArrowEnterRegular fontSize={11} />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    insertQualified(g.name, v.name);
                                  }}
                                  style={{ padding: 0, height: "auto", minWidth: 0 }}
                                  aria-label={`Inserir ${g.name}.${v.name}`}
                                />
                              </Tooltip>
                            }
                          >
                            <div className="columns">
                              {v.columns.map((c) => {
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
                            aria-label="Expandir/recolher"
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
                  label={`Funções (${g.functions.length})`}
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
                            { label: "Inserir no editor", action: () => insertQualified(g.name, f.name) },
                            { label: "Ver definição em nova aba", action: () => void openDefinition("function", g.name, f.name) },
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
                        <Tooltip content={`Inserir ${g.name}.${f.name}`} relationship="label">
                          <Button
                            appearance="transparent"
                            size="small"
                            icon={<ArrowEnterRegular fontSize={11} />}
                            onClick={() => insertQualified(g.name, f.name)}
                            style={{ padding: 0, height: "auto", minWidth: 0 }}
                            aria-label={`Inserir ${g.name}.${f.name}`}
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
      <div
        className={`resize-handle ${resizing ? "resizing" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar painel de objetos"
        onPointerDown={onResizeStart}
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
          <ul className="context-menu" style={{ left: menu.x, top: menu.y }}>
            {menu.items.map((item, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    item.action();
                    closeMenu();
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
