import { useCallback, useMemo, useState } from "react";
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

export function ResultsGrid({ result, error, planText, editability, onCellEdit }: ResultsGridProps) {
  const [activeTab, setActiveTab] = useState<"data" | "messages" | "plan">("data");
  const [globalFilter, setGlobalFilter] = useState("");
  const [sortColumn, setSortColumn] = useState<string | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<"ascending" | "descending">("ascending");
  const [page, setPage] = useState(0);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number; value: string } | null>(null);

  const rows = useMemo(() => result?.rows ?? [], [result?.rows]);

  const filteredRows = useMemo(() => {
    const term = globalFilter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => row.some((cell) => String(cell ?? "").toLowerCase().includes(term)));
  }, [rows, globalFilter]);

  const sortedRows = useMemo(() => {
    if (!sortColumn || !result) return filteredRows;
    const colIndex = result.columns.findIndex((c) => c.name === sortColumn);
    if (colIndex < 0) return filteredRows;
    const dir = sortDirection === "ascending" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = a[colIndex] ?? "";
      const bv = b[colIndex] ?? "";
      if (av === bv) return 0;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
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
        index,
        editable: editability?.editable && editability.columns[index]?.sourceColumn != null,
      })) ?? [],
    [result?.columns, editability],
  );

  return (
    <Card
      style={{
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
          <Tab value="data">Dados</Tab>
          <Tab value="messages">Mensagens</Tab>
          {planText && <Tab value="plan">Plano</Tab>}
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
              <Button icon={<ArrowDownloadRegular />} onClick={handleExportCsv} disabled={!result || rows.length === 0} />
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
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.name)}
                        style={{
                          padding: "6px 10px",
                          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
                          textAlign: "left",
                          background: tokens.colorNeutralBackground3,
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {col.name}
                          {col.editable && (
                            <EditRegular
                              style={{ fontSize: 12, color: tokens.colorNeutralForeground2 }}
                            />
                          )}
                          {sortColumn === col.name && (sortDirection === "ascending" ? " ▲" : " ▼")}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
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
                              <div
                                onClick={() => startEdit(rowIndex, col.index)}
                                style={{
                                  whiteSpace: "nowrap",
                                  cursor: col.editable ? "text" : "default",
                                  padding: "2px 0",
                                }}
                              >
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
