import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  Text,
  tokens,
  Spinner,
} from "@fluentui/react-components";
import { ChevronRightRegular, ChevronDownRegular, SearchRegular } from "@fluentui/react-icons";
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

function TreeNode({
  label,
  children,
  defaultExpanded = false,
}: {
  label: React.ReactNode;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = Boolean(children);
  return (
    <div style={{ marginLeft: 12 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, cursor: hasChildren ? "pointer" : "default", padding: "2px 0" }}
        onClick={() => hasChildren && setExpanded((v) => !v)}
      >
        {hasChildren ? (
          expanded ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} />
        ) : (
          <span style={{ width: 12 }} />
        )}
        {label}
      </div>
      {expanded && <div>{children}</div>}
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

  if (!open) return null;

  return (
    <Card
      style={{
        width: 260,
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
          padding: 10,
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        <Text weight="semibold" truncate>
          {connection?.label ?? "Objetos"}
        </Text>
        {loading && <Spinner size="tiny" />}
      </div>
      <div style={{ padding: 8 }}>
        <Input
          placeholder="Buscar tabelas, colunas..."
          value={search}
          onChange={(_, data) => setSearch(data.value)}
          contentBefore={<SearchRegular />}
          style={{ width: "100%" }}
        />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "0 8px 8px" }}>
        {groups.length === 0 ? (
          <Text size={200} style={{ color: tokens.colorNeutralForeground2, padding: 8 }}>
            {loading ? "Carregando..." : search ? "Nenhum resultado." : "Nenhum objeto disponível."}
          </Text>
        ) : (
          groups.map((g) => (
            <TreeNode key={g.name} label={<Text weight="semibold">{g.name}</Text>} defaultExpanded={!!search.trim()}>
              {g.tables.length > 0 && (
                <TreeNode label={`Tabelas (${g.tables.length})`} defaultExpanded={!!search.trim()}>
                  {g.tables.map((t) => (
                    <TreeNode
                      key={`${g.name}.${t.name}`}
                      label={
                        <Button
                          appearance="transparent"
                          size="small"
                          onClick={() => onInsert?.(`${g.name}.${t.name}`)}
                          style={{ padding: 0, height: "auto", minWidth: 0 }}
                        >
                          {t.name}
                        </Button>
                      }
                    >
                      {t.columns.map((c) => (
                        <Text key={c.name} size={200} style={{ color: tokens.colorNeutralForeground2, paddingLeft: 8 }}>
                          {c.name} <span style={{ color: tokens.colorNeutralForeground3 }}>{c.dataType}</span>
                        </Text>
                      ))}
                    </TreeNode>
                  ))}
                </TreeNode>
              )}
              {g.views.length > 0 && (
                <TreeNode label={`Views (${g.views.length})`} defaultExpanded={!!search.trim()}>
                  {g.views.map((v) => (
                    <TreeNode
                      key={`${g.name}.${v.name}`}
                      label={
                        <Button
                          appearance="transparent"
                          size="small"
                          onClick={() => onInsert?.(`${g.name}.${v.name}`)}
                          style={{ padding: 0, height: "auto", minWidth: 0 }}
                        >
                          {v.name}
                        </Button>
                      }
                    >
                      {v.columns.map((c) => (
                        <Text key={c.name} size={200} style={{ color: tokens.colorNeutralForeground2, paddingLeft: 8 }}>
                          {c.name} <span style={{ color: tokens.colorNeutralForeground3 }}>{c.dataType}</span>
                        </Text>
                      ))}
                    </TreeNode>
                  ))}
                </TreeNode>
              )}
              {g.functions.length > 0 && (
                <TreeNode label={`Funções (${g.functions.length})`} defaultExpanded={!!search.trim()}>
                  {g.functions.map((f) => (
                    <Button
                      key={`${g.name}.${f.name}`}
                      appearance="transparent"
                      size="small"
                      onClick={() => onInsert?.(`${g.name}.${f.name}`)}
                      style={{ padding: 0, height: "auto", minWidth: 0, display: "block" }}
                    >
                      {f.name}
                    </Button>
                  ))}
                </TreeNode>
              )}
            </TreeNode>
          ))
        )}
      </div>
    </Card>
  );
}
