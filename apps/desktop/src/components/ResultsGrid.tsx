import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Input,
  Tab,
  TabList,
  Text,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  DismissRegular,
  EditRegular,
  CalendarLtrRegular,
  TableRegular,
  ChatRegular,
  WrenchRegular,
} from "@fluentui/react-icons";
import type { QueryResult, RowEditability } from "@omni-sql/ts-types";

export interface ResultsGridProps {
  result?: QueryResult | null;
  error?: string | null;
  planText?: string | null;
  editability?: RowEditability | null;
  onCellEdit?: (rowIndex: number, colIndex: number, value: unknown) => Promise<void>;
}

const PAGE_SIZE = 100;

function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function columnTypeLabel(dataType: string): string {
  const type = dataType.toLowerCase();
  if (
    type.includes("int") ||
    type.includes("serial") ||
    type.includes("number") ||
    type.includes("decimal") ||
    type.includes("numeric") ||
    type.includes("float") ||
    type.includes("double") ||
    type.includes("real") ||
    type.includes("money")
  ) {
    return "123";
  }
  if (type.includes("date") || type.includes("time") || type.includes("timestamp")) return "data";
  if (type.includes("bool") || type.includes("bit")) return "T/F";
  if (type.includes("json") || type.includes("xml") || type.includes("array") || type.includes("struct")) {
    return "{}";
  }
  if (type.includes("uuid")) return "id";
  if (type.includes("binary") || type.includes("blob") || type.includes("bytea")) return "bin";
  if (type.includes("char") || type.includes("text") || type.includes("varchar") || type.includes("clob") || type.includes("string")) {
    return "abc";
  }
  return "?";
}

export function ResultsGrid({ result, error, planText, editability, onCellEdit }: ResultsGridProps) {
  const [activeTab, setActiveTab] = useState<"data" | "messages" | "plan">("data");
  const [globalFilter, setGlobalFilter] = useState("");
  const [sortColumn, setSortColumn] = useState<string | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<"ascending" | "descending">("ascending");
  const [page, setPage] = useState(0);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number; value: string } | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => result?.rows ?? [], [result?.rows]);

  // Reset sort/filters/selection on new result
  useEffect(() => {
    setSortColumn(undefined);
    setPage(0);
    setSelectedRow(null);
    if (error) {
      setActiveTab("messages");
    } else if (result) {
      setActiveTab("data");
    }
  }, [result?.columns, error]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRows = useMemo(() => {
    let list = rows;
    const term = globalFilter.trim().toLowerCase();
    if (term) {
      list = list.filter((row) => row.some((cell) => String(cell ?? "").toLowerCase().includes(term)));
    }
    return list;
  }, [rows, globalFilter]);

  const sortedRows = useMemo(() => {
    if (!sortColumn || !result) return filteredRows;
    const colIndex = result.columns.findIndex((c) => c.name === sortColumn);
    if (colIndex < 0) return filteredRows;
    const dir = sortDirection === "ascending" ? 1 : -1;
    return [...filteredRows].sort((a, b) => compareValues(a[colIndex], b[colIndex]) * dir);
  }, [filteredRows, sortColumn, sortDirection, result]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = page * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, page]);

  const handleSort = useCallback(
    (col: string) => {
      if (sortColumn === col) {
        setSortDirection((d) => (d === "ascending" ? "descending" : "ascending"));
      } else {
        setSortColumn(col);
        setSortDirection("ascending");
      }
      setPage(0);
    },
    [sortColumn],
  );

  const handleExportCsv = useCallback(() => {
    if (!result) return;
    const header = result.columns.map((c) => escapeCsv(c.name)).join(",");
    const body = sortedRows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resultados.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [result, sortedRows]);

  const startEdit = useCallback(
    (rowIndex: number, colIndex: number) => {
      if (!editability?.editable) return;
      const col = result?.columns[colIndex];
      if (!col) return;
      const editableColumn = editability.columns[colIndex];
      if (!editableColumn || editableColumn.sourceColumn === null) return;
      const value = pageRows[rowIndex]?.[colIndex];
      setEditingCell({ row: rowIndex, col: colIndex, value: String(value ?? "") });
    },
    [editability, pageRows, result?.columns],
  );

  const commitEdit = useCallback(async () => {
    if (!editingCell || !onCellEdit) return;
    await onCellEdit(editingCell.row, editingCell.col, editingCell.value);
    setEditingCell(null);
  }, [editingCell, onCellEdit]);

  const cancelEdit = useCallback(() => setEditingCell(null), []);

  const columns = useMemo(
    () =>
      result?.columns.map((col, index) => ({
        key: col.name,
        name: col.name,
        dataType: col.dataType,
        index,
        editable: editability?.editable && editability.columns[index]?.sourceColumn != null,
      })) ?? [],
    [result?.columns, editability],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (activeTab !== "data" || pageRows.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedRow((r) => (r == null ? 0 : Math.min(pageRows.length - 1, r + 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedRow((r) => (r == null ? 0 : Math.max(0, r - 1)));
      }
    }
    const el = gridRef.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [activeTab, pageRows.length]);

  return (
    <Card
      className="omni-results-grid"
      style={{
        height: "100%",
        borderRadius: 0,
        background: tokens.colorNeutralBackground2,
        display: "flex",
        flexDirection: "column",
        padding: 0,
      }}
      tabIndex={0}
      ref={gridRef}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <TabList
          selectedValue={activeTab}
          onTabSelect={(_, data) => setActiveTab(data.value as "data" | "messages" | "plan")}
        >
          <Tab value="data" icon={<TableRegular fontSize={12} />}>Dados</Tab>
          <Tab value="messages" icon={<ChatRegular fontSize={12} />}>Mensagens</Tab>
          {planText && <Tab value="plan" icon={<WrenchRegular fontSize={12} />}>Plano</Tab>}
        </TabList>
        {activeTab === "data" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" }}>
            <Input
              placeholder="Filtrar linhas…"
              value={globalFilter}
              onChange={(_, data) => {
                setGlobalFilter(data.value);
                setPage(0);
              }}
              contentAfter={
                globalFilter ? (
                  <Button
                    appearance="transparent"
                    icon={<DismissRegular />}
                    onClick={() => {
                      setGlobalFilter("");
                      setPage(0);
                    }}
                  />
                ) : undefined
              }
              style={{ minWidth: 160, maxWidth: 240 }}
            />
            <Tooltip content="Exportar CSV" relationship="label">
              <Button icon={<ArrowDownloadRegular />} onClick={handleExportCsv} disabled={!result || rows.length === 0}>
                Exportar
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {activeTab === "data" && (
          <>
            {!result ? (
              <Text size={200} style={{ padding: 16, display: "block", color: tokens.colorNeutralForeground2 }}>
                Nenhum resultado ainda.
              </Text>
            ) : (
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 12,
                  minWidth: "100%",
                  tableLayout: "fixed",
                }}
              >
                <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>
                    {columns.map((col) => (
                      (() => {
                        const typeLabel = columnTypeLabel(col.dataType);
                        return (
                          <th
                            key={col.key}
                            onClick={() => handleSort(col.name)}
                            title={`Tipo: ${col.dataType}`}
                            style={{
                              padding: "8px 10px",
                              borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
                              textAlign: "left",
                              background: tokens.colorNeutralBackground3,
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                              fontWeight: 600,
                              verticalAlign: "middle",
                            }}
                          >
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span
                                aria-hidden="true"
                                style={{
                                  color: tokens.colorPaletteYellowForeground1,
                                  fontSize: typeLabel === "data" ? 14 : 10,
                                  fontWeight: 700,
                                  letterSpacing: "-0.02em",
                                  lineHeight: 1,
                                  minWidth: 24,
                                  textAlign: "center",
                                }}
                              >
                                {typeLabel === "data" ? <CalendarLtrRegular /> : typeLabel}
                              </span>
                              <span>{col.name}</span>
                              {col.editable && (
                                <EditRegular style={{ fontSize: 12, color: tokens.colorNeutralForeground2 }} />
                              )}
                              {sortColumn === col.name && (sortDirection === "ascending" ? " ▲" : " ▼")}
                            </span>
                          </th>
                        );
                      })()
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className={selectedRow === rowIndex ? "selected" : undefined}
                      onClick={() => setSelectedRow(rowIndex)}
                      style={{
                        backgroundColor:
                          selectedRow === rowIndex
                            ? tokens.colorBrandBackground2
                            : undefined,
                        cursor: "pointer",
                      }}
                    >
                      {columns.map((col) => {
                        const cellValue = row[col.index];
                        const isEditing =
                          editingCell && editingCell.row === rowIndex && editingCell.col === col.index;
                        return (
                          <td
                            key={col.key}
                            style={{
                              padding: "4px 10px",
                              borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
                              whiteSpace: "nowrap",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRow(rowIndex);
                              if (col.editable) startEdit(rowIndex, col.index);
                            }}
                          >
                            {isEditing ? (
                              <Input
                                autoFocus
                                value={editingCell.value}
                                onChange={(_, data) => setEditingCell({ ...editingCell, value: data.value })}
                                onBlur={commitEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void commitEdit();
                                  if (e.key === "Escape") cancelEdit();
                                }}
                                style={{ minWidth: 60 }}
                              />
                            ) : (
                              <div style={{ whiteSpace: "nowrap", padding: "2px 0" }}>
                                {String(cellValue ?? "")}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === "messages" && (
          <div style={{ padding: 16 }}>
            {error ? (
              <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>
            ) : result ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Text>
                  {result.rowsAffected !== undefined
                    ? `Linhas afetadas: ${result.rowsAffected}`
                    : `Linhas retornadas: ${result.rows.length}`}
                </Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                  Tempo: {result.elapsedMs} ms
                </Text>
                {result.rowsMoreAvailable && (
                  <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                    Há mais linhas disponíveis; reduza o filtro ou aumente o limite na query.
                  </Text>
                )}
              </div>
            ) : (
              <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                Nenhuma mensagem.
              </Text>
            )}
          </div>
        )}

        {activeTab === "plan" && planText && (
          <pre
            style={{
              padding: 16,
              margin: 0,
              fontSize: 12,
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
              color: tokens.colorNeutralForeground1,
            }}
          >
            {planText}
          </pre>
        )}
      </div>

      {activeTab === "data" && result && sortedRows.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px",
            borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
            gap: 8,
          }}
        >
          <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
            {sortedRows.length} de {rows.length} linhas
          </Text>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Button
              icon={<ChevronLeftRegular />}
              appearance="subtle"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            />
            <Text size={200}>
              {page + 1} / {totalPages}
            </Text>
            <Button
              icon={<ChevronRightRegular />}
              appearance="subtle"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
