import { useMemo, useState } from "react";
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
import { dialectIcon } from "../lib/dialect-icons";
import { typeIcon } from "../lib/type-icon";
import type { ConnectionEntry, RelationInfo } from "../lib/backend";
import type { FunctionDef } from "@omni-sql/ts-types";

export interface SidebarProps {
  open?: boolean;
  connection?: ConnectionEntry | null;
  relations?: RelationInfo[];
  functions?: FunctionDef[];
  loading?: boolean;
  onInsert?: (text: string) => void;
  _onRefresh?: () => void;
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
}

function TreeNode({ label, icon, children, defaultExpanded = false, forceExpanded, actions }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isExpanded = forceExpanded ?? expanded;
  const hasChildren = Boolean(children);
  return (
    <div style={{ marginLeft: 10 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, cursor: hasChildren ? "pointer" : "default", padding: "2px 0" }}
        onClick={() => hasChildren && setExpanded((v) => !v)}
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

export function Sidebar({
  open = true,
  connection,
  relations = [],
  functions = [],
  loading = false,
  onInsert,
  _onRefresh,
}: SidebarProps) {
  const [search, setSearch] = useState("");

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

  const relationKey = (schema: string, name: string) => `${schema}.${name}`;

  if (!open) return null;

  const isSearching = !!search.trim();

  return (
    <Card
      style={{
        width: 280,
        height: "100%",
        borderRadius: 0,
        background: tokens.colorNeutralBackground2,
        display: "flex",
        flexDirection: "column",
        padding: 0,
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
            <span title={connection.dialect}>{dialectIcon(connection.dialect)}</span>
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
              onClick={_onRefresh}
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
                    const isOpen = isSearching;
                    {/* table icon */}
                    return (
                      <div key={key} style={{ marginLeft: 10 }}>
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
                                  onInsert?.(`${g.name}.${t.name}`);
                                }}
                                style={{ padding: 0, height: "auto", minWidth: 0 }}
                                aria-label={`Inserir ${g.name}.${t.name}`}
                              />
                            </Tooltip>
                          }
                        >
                          <div className="columns">
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
                        </TreeNode>
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
                    const isOpen = isSearching;
                    {/* view icon */}
                    return (
                      <div key={key} style={{ marginLeft: 10 }}>
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
                                  onInsert?.(`${g.name}.${v.name}`);
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
                      <div key={relationKey(g.name, f.name)} className="obj-row" style={{ marginLeft: 10 }}>
                        <NumberSymbolRegular fontSize={12} style={{ color: tokens.colorNeutralForeground2 }} />
                        <Button
                          appearance="transparent"
                          size="small"
                          onClick={() => onInsert?.(`${g.name}.${f.name}`)}
                          style={{ padding: 0, height: "auto", minWidth: 0, flex: 1, justifyContent: "flex-start" }}
                        >
                          <span className="obj-name">{f.name}</span>
                        </Button>
                        <Tooltip content={`Inserir ${g.name}.${f.name}`} relationship="label">
                          <Button
                            appearance="transparent"
                            size="small"
                            icon={<ArrowEnterRegular fontSize={11} />}
                            onClick={() => onInsert?.(`${g.name}.${f.name}`)}
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
    </Card>
  );
}
