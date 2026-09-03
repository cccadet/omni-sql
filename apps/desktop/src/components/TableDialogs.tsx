import { useEffect, useState } from "react";
import {
  Button, Checkbox, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Dropdown, Field, Input, Option, Spinner, Tab, TabList, Text, Textarea,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import type { DialectId, IndexInfo, QueryResult } from "@omni-sql/ts-types";
import { useLanguage } from "../i18n";
import { backend, type RelationColumn, type RelationConstraint } from "../lib/backend";

interface DraftColumn {
  id: number;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
}

interface EditDraftColumn extends DraftColumn { originalName?: string; }

interface EditDraftIndex {
  id: number;
  originalName?: string;
  name: string;
  columnsText: string;
  unique: boolean;
  primary: boolean;
}

const TYPE_OPTIONS: Record<DialectId, readonly string[]> = {
  postgres: ["integer", "bigint", "varchar(255)", "text", "boolean", "date", "timestamp", "numeric(18,2)", "uuid", "jsonb"],
  mysql: ["int", "bigint", "varchar(255)", "text", "tinyint(1)", "date", "datetime", "decimal(18,2)", "json"],
  mariadb: ["int", "bigint", "varchar(255)", "text", "tinyint(1)", "date", "datetime", "decimal(18,2)", "json"],
  sqlserver: ["int", "bigint", "nvarchar(255)", "nvarchar(max)", "bit", "date", "datetime2", "decimal(18,2)", "uniqueidentifier"],
  oracle: ["NUMBER(10)", "NUMBER(19)", "VARCHAR2(255)", "CLOB", "NUMBER(1)", "DATE", "TIMESTAMP", "NUMBER(18,2)", "RAW(16)"],
  "jdbc-generic": ["INTEGER", "BIGINT", "VARCHAR(255)", "TEXT", "BOOLEAN", "DATE", "TIMESTAMP", "DECIMAL(18,2)"],
  odbc: ["INTEGER", "BIGINT", "VARCHAR(255)", "TEXT", "BOOLEAN", "DATE", "TIMESTAMP", "DECIMAL(18,2)"],
};

function quoteIdentifier(value: string, dialect: DialectId): string {
  if (dialect === "mysql" || dialect === "mariadb") return `\`${value.replaceAll("`", "``")}\``;
  if (dialect === "sqlserver") {
    const escaped = value.replaceAll("]", "]]");
    return `[${escaped}]`;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildSampleRowSql(dialect: DialectId, schema: string, table: string): string {
  const q = (value: string) => quoteIdentifier(value, dialect);
  const relation = schema.trim() ? `${q(schema)}.${q(table)}` : q(table);
  return `SELECT * FROM ${relation}`;
}

function formatSampleValue(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "—";
  if (typeof value === "object") {
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  }
  return String(value);
}

export function buildCreateTableSql(dialect: DialectId, schema: string, table: string, columns: readonly DraftColumn[]): string {
  const q = (value: string) => quoteIdentifier(value, dialect);
  const definitions = columns.map((column) => {
    const parts = [`  ${q(column.name)} ${column.dataType.trim()}`];
    if (!column.nullable) parts.push("NOT NULL");
    if (column.defaultValue.trim()) parts.push(`DEFAULT ${column.defaultValue.trim()}`);
    return parts.join(" ");
  });
  const primary = columns.filter((column) => column.primaryKey).map((column) => q(column.name));
  if (primary.length) definitions.push(`  PRIMARY KEY (${primary.join(", ")})`);
  const target = schema.trim() ? `${q(schema.trim())}.${q(table.trim())}` : q(table.trim());
  return `CREATE TABLE ${target} (\n${definitions.join(",\n")}\n);`;
}

function columnDefinition(dialect: DialectId, column: Pick<DraftColumn, "name" | "dataType" | "nullable" | "defaultValue">, includeName = true): string {
  const q = (value: string) => quoteIdentifier(value, dialect);
  const parts = [includeName ? q(column.name) : "", column.dataType.trim()].filter(Boolean);
  parts.push(column.nullable ? "NULL" : "NOT NULL");
  if (column.defaultValue.trim()) parts.push(`DEFAULT ${column.defaultValue.trim()}`);
  return parts.join(" ");
}

export function buildAlterTableSql(dialect: DialectId, schema: string, table: string, original: readonly RelationColumn[], draft: readonly EditDraftColumn[], constraints: readonly RelationConstraint[] = []): string {
  const q = (value: string) => quoteIdentifier(value, dialect);
  const target = schema.trim() ? `${q(schema.trim())}.${q(table)}` : q(table);
  const statements: string[] = [];
  const draftByOriginal = new Map(draft.filter((column) => column.originalName).map((column) => [column.originalName!, column]));
  const primaryConstraint = constraints.find((constraint) => constraint.kind === "primary");
  const originalPrimary = original.filter((column) => column.isPrimaryKey).map((column) => draftByOriginal.get(column.name)?.name ?? column.name);
  const nextPrimary = draft.filter((column) => column.primaryKey).map((column) => column.name);
  const primaryChanged = originalPrimary.length !== nextPrimary.length || originalPrimary.some((name, index) => name !== nextPrimary[index]);
  if (primaryChanged && originalPrimary.length > 0) {
    if (dialect === "mysql" || dialect === "mariadb" || dialect === "oracle") {
      statements.push(`ALTER TABLE ${target} DROP PRIMARY KEY;`);
    } else if (primaryConstraint) {
      statements.push(`ALTER TABLE ${target} DROP CONSTRAINT ${q(primaryConstraint.name)};`);
    } else {
      statements.push("-- Não foi possível identificar o nome da constraint de chave primária para removê-la.");
    }
  }
  for (const previous of original) {
    const current = draftByOriginal.get(previous.name);
    if (!current) {
      statements.push(`ALTER TABLE ${target} DROP COLUMN ${q(previous.name)};`);
      continue;
    }
    if (current.name !== previous.name) {
      if (dialect === "sqlserver") {
        const path = [schema, table, previous.name].filter(Boolean).join(".").replaceAll("'", "''");
        statements.push(`EXEC sp_rename N'${path}', N'${current.name.replaceAll("'", "''")}', 'COLUMN';`);
      } else {
        statements.push(`ALTER TABLE ${target} RENAME COLUMN ${q(previous.name)} TO ${q(current.name)};`);
      }
    }
    const changed = current.dataType.trim() !== previous.dataType || current.nullable !== previous.nullable || current.defaultValue.trim() !== (previous.defaultValue ?? "").trim();
    if (!changed) continue;
    if (dialect === "postgres") {
      if (current.dataType.trim() !== previous.dataType) statements.push(`ALTER TABLE ${target} ALTER COLUMN ${q(current.name)} TYPE ${current.dataType.trim()};`);
      if (current.nullable !== previous.nullable) statements.push(`ALTER TABLE ${target} ALTER COLUMN ${q(current.name)} ${current.nullable ? "DROP" : "SET"} NOT NULL;`);
      if (current.defaultValue.trim() !== (previous.defaultValue ?? "").trim()) statements.push(`ALTER TABLE ${target} ALTER COLUMN ${q(current.name)} ${current.defaultValue.trim() ? `SET DEFAULT ${current.defaultValue.trim()}` : "DROP DEFAULT"};`);
    } else if (dialect === "mysql" || dialect === "mariadb") {
      statements.push(`ALTER TABLE ${target} MODIFY COLUMN ${columnDefinition(dialect, current)};`);
    } else if (dialect === "oracle") {
      statements.push(`ALTER TABLE ${target} MODIFY (${columnDefinition(dialect, current)});`);
    } else {
      statements.push(`ALTER TABLE ${target} ALTER COLUMN ${columnDefinition(dialect, { ...current, defaultValue: "" })};`);
      if (current.defaultValue.trim() !== (previous.defaultValue ?? "").trim()) statements.push(`-- Revise manualmente o default de ${q(current.name)} neste dialeto.`);
    }
  }
  for (const column of draft.filter((item) => !item.originalName && item.name.trim() && item.dataType.trim())) {
    const keyword = dialect === "oracle" ? "ADD" : "ADD COLUMN";
    statements.push(`ALTER TABLE ${target} ${keyword} ${dialect === "oracle" ? `(${columnDefinition(dialect, column)})` : columnDefinition(dialect, column)};`);
  }
  if (primaryChanged && nextPrimary.length > 0) {
    const columns = nextPrimary.map(q).join(", ");
    const namedConstraint = primaryConstraint && dialect !== "mysql" && dialect !== "mariadb" && dialect !== "oracle"
      ? `CONSTRAINT ${q(primaryConstraint.name)} `
      : "";
    statements.push(`ALTER TABLE ${target} ADD ${namedConstraint}PRIMARY KEY (${columns});`);
  }
  return statements.join("\n");
}

export function buildAlterIndexesSql(dialect: DialectId, schema: string, table: string, original: readonly IndexInfo[], draft: readonly EditDraftIndex[]): string {
  const q = (value: string) => quoteIdentifier(value, dialect);
  const tableTarget = schema.trim() ? `${q(schema.trim())}.${q(table)}` : q(table);
  const indexTarget = (name: string) => schema.trim() && (dialect === "postgres" || dialect === "oracle") ? `${q(schema.trim())}.${q(name)}` : q(name);
  const draftByOriginal = new Map(draft.filter((index) => index.originalName).map((index) => [index.originalName!, index]));
  const statements: string[] = [];
  const dropIndex = (name: string) => {
    if (dialect === "mysql" || dialect === "mariadb") return `ALTER TABLE ${tableTarget} DROP INDEX ${q(name)};`;
    if (dialect === "sqlserver") return `DROP INDEX ${q(name)} ON ${tableTarget};`;
    return `DROP INDEX ${indexTarget(name)};`;
  };
  const createIndex = (index: EditDraftIndex) => {
    const columns = index.columnsText.split(",").map((column) => column.trim()).filter(Boolean).map(q).join(", ");
    return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${q(index.name.trim())} ON ${tableTarget} (${columns});`;
  };
  for (const previous of original.filter((index) => !index.primary)) {
    const current = draftByOriginal.get(previous.name);
    if (!current) {
      statements.push(dropIndex(previous.name));
      continue;
    }
    const currentColumns = current.columnsText.split(",").map((column) => column.trim()).filter(Boolean);
    const changed = current.name.trim() !== previous.name || current.unique !== previous.unique || currentColumns.join("\0") !== previous.columns.join("\0");
    if (changed) statements.push(dropIndex(previous.name), createIndex(current));
  }
  for (const index of draft.filter((item) => !item.originalName && item.name.trim() && item.columnsText.trim())) statements.push(createIndex(index));
  return statements.join("\n");
}

interface CreateTableDialogProps {
  open: boolean;
  dialect: DialectId;
  schemas: readonly string[];
  initialSchema?: string;
  onClose: () => void;
  onOpenSql: (title: string, sql: string) => void;
}

export function CreateTableDialog({ open, dialect, schemas, initialSchema, onClose, onOpenSql }: CreateTableDialogProps) {
  const { t } = useLanguage();
  const [schema, setSchema] = useState(initialSchema ?? schemas[0] ?? "");
  const [table, setTable] = useState("");
  const [nextId, setNextId] = useState(2);
  const [columns, setColumns] = useState<DraftColumn[]>([{ id: 1, name: "id", dataType: TYPE_OPTIONS[dialect][0]!, nullable: false, primaryKey: true, defaultValue: "" }]);
  useEffect(() => {
    if (!open) return;
    setSchema(initialSchema ?? schemas[0] ?? "");
    setTable("");
    setNextId(2);
    setColumns([{ id: 1, name: "id", dataType: TYPE_OPTIONS[dialect][0]!, nullable: false, primaryKey: true, defaultValue: "" }]);
  }, [dialect, initialSchema, open, schemas]);
  const validColumns = columns.filter((column) => column.name.trim() && column.dataType.trim());
  const sql = table.trim() && validColumns.length ? buildCreateTableSql(dialect, schema, table, validColumns) : "";
  const updateColumn = (id: number, patch: Partial<DraftColumn>) => setColumns((current) => current.map((column) => column.id === id ? { ...column, ...patch } : column));
  return <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
    <DialogSurface className="omni-table-dialog" style={{ width: "min(920px, calc(100vw - 24px))", maxWidth: "none" }}>
      <DialogBody className="omni-table-dialog-body"><DialogTitle>{t("createTableDialog")}</DialogTitle><DialogContent className="omni-table-dialog-content" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <Field label="Schema">{schemas.length > 0
            ? <Dropdown value={schema} selectedOptions={schema ? [schema] : []} onOptionSelect={(_, data) => setSchema(data.optionValue ?? "")}>{schemas.map((name) => <Option key={name} value={name}>{name}</Option>)}</Dropdown>
            : <Input value={schema} onChange={(_, data) => setSchema(data.value)} />}
          </Field>
          <Field label={t("tableName")} required><Input aria-label={t("tableName")} value={table} onChange={(_, data) => setTable(data.value)} autoFocus /></Field>
        </div>
        <div style={{ overflowX: "auto" }}><table className="table-designer-grid"><thead><tr><th>{t("name")}</th><th>{t("type")}</th><th>{t("nullable")}</th><th>PK</th><th>Default</th><th /></tr></thead><tbody>
          {columns.map((column) => <tr key={column.id}>
            <td><Input value={column.name} aria-label={t("columnName")} onChange={(_, data) => updateColumn(column.id, { name: data.value })} /></td>
            <td><Input value={column.dataType} aria-label={t("columnType")} list={`types-${column.id}`} onChange={(_, data) => updateColumn(column.id, { dataType: data.value })} /><datalist id={`types-${column.id}`}>{TYPE_OPTIONS[dialect].map((type) => <option key={type} value={type} />)}</datalist></td>
            <td><Checkbox checked={column.nullable} aria-label={t("allowNull")} onChange={(_, data) => updateColumn(column.id, { nullable: data.checked === true })} /></td>
            <td><Checkbox checked={column.primaryKey} aria-label={t("primaryKey")} onChange={(_, data) => updateColumn(column.id, { primaryKey: data.checked === true, nullable: data.checked === true ? false : column.nullable })} /></td>
            <td><Input value={column.defaultValue} aria-label={t("defaultColumnValue")} onChange={(_, data) => updateColumn(column.id, { defaultValue: data.value })} /></td>
            <td><Button appearance="transparent" icon={<DeleteRegular />} aria-label={t("removeColumn")} disabled={columns.length === 1} onClick={() => setColumns((current) => current.filter((item) => item.id !== column.id))} /></td>
          </tr>)}</tbody></table></div>
        <Button appearance="subtle" icon={<AddRegular />} style={{ justifySelf: "start" }} onClick={() => { setColumns((current) => [...current, { id: nextId, name: "", dataType: TYPE_OPTIONS[dialect][0]!, nullable: true, primaryKey: false, defaultValue: "" }]); setNextId((value) => value + 1); }}>{t("addColumn")}</Button>
        <Field label={t("sqlPreview")}><Textarea value={sql} readOnly resize="vertical" style={{ minHeight: 150, fontFamily: "monospace" }} /></Field>
        {dialect === "jdbc-generic" || dialect === "odbc" ? <Text size={200}>{t("genericDialectHint")}</Text> : null}
      </DialogContent><DialogActions><Button onClick={onClose}>{t("cancel")}</Button><Button appearance="primary" disabled={!sql} onClick={() => { onOpenSql(`${t("createTableDialog")} ${table.trim()}`, sql); onClose(); }}>{t("openSql")}</Button></DialogActions></DialogBody>
    </DialogSurface>
  </Dialog>;
}

interface TableStructureDialogProps { open: boolean; connectionId: string | null; dialect: DialectId; schema: string; table: string; onClose: () => void; onOpenSql: (title: string, sql: string) => void; }
export function TableStructureDialog({ open, connectionId, dialect, schema, table, onClose, onOpenSql }: TableStructureDialogProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<RelationColumn[]>([]);
  const [constraints, setConstraints] = useState<RelationConstraint[]>([]);
  const [draftColumns, setDraftColumns] = useState<EditDraftColumn[]>([]);
  const [draftIndexes, setDraftIndexes] = useState<EditDraftIndex[]>([]);
  const [nextId, setNextId] = useState(1);
  const [editing, setEditing] = useState(false);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [ddl, setDdl] = useState("");
  const [sampleResult, setSampleResult] = useState<QueryResult | null>(null);
  const [sampleError, setSampleError] = useState(false);
  const [tab, setTab] = useState("columns");
  useEffect(() => {
    if (!open || !connectionId) return;
    setLoading(true); setError(null); setSampleResult(null); setSampleError(false); setTab("columns"); setEditing(false);
    void Promise.all([
      backend.call<{ columns: RelationColumn[]; constraints?: RelationConstraint[] }>("metadata.listColumns", { connectionId, schema, table }),
      backend.call<{ indexes: IndexInfo[] }>("metadata.listIndexes", { connectionId, schema, table }),
      backend.call<{ sql: string }>("metadata.getDefinition", { connectionId, kind: "table", schema, name: table }),
    ]).then(([columnResult, indexResult, definition]) => {
      setColumns(columnResult.columns);
      setConstraints(columnResult.constraints ?? []);
      setIndexes(indexResult.indexes);
      setDdl(definition.sql);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoading(false));
    void backend.call<QueryResult>("query.run", { connectionId, sql: buildSampleRowSql(dialect, schema, table), limit: 1 })
      .then(setSampleResult).catch(() => setSampleError(true));
  }, [connectionId, dialect, open, schema, table]);
  const sampleRow = sampleResult?.rows?.[0];
  const sampleColumnIndexes = new Map(sampleResult?.columns?.map((column, index) => [column.name, index]) ?? []);
  const beginEditing = () => {
    if (tab === "indexes") {
      setDraftIndexes(indexes.map((index, position) => ({ id: position + 1, originalName: index.name, name: index.name, columnsText: index.columns.join(", "), unique: index.unique, primary: index.primary })));
      setNextId(indexes.length + 1);
      setEditing(true);
      return;
    }
    setDraftColumns(columns.map((column, index) => ({ id: index + 1, originalName: column.name, name: column.name, dataType: column.dataType, nullable: column.nullable, primaryKey: column.isPrimaryKey, defaultValue: column.defaultValue ?? "" })));
    setNextId(columns.length + 1);
    setEditing(true);
  };
  const normalizedNames = draftColumns.map((column) => column.name.trim().toLocaleLowerCase());
  const draftValid = draftColumns.every((column) => column.name.trim() && column.dataType.trim()) && new Set(normalizedNames).size === normalizedNames.length;
  const indexDraftValid = draftIndexes.every((index) => index.primary || (index.name.trim() && index.columnsText.split(",").some((column) => column.trim())))
    && new Set(draftIndexes.map((index) => index.name.trim().toLocaleLowerCase())).size === draftIndexes.length;
  const sql = tab === "indexes"
    ? indexDraftValid ? buildAlterIndexesSql(dialect, schema, table, indexes, draftIndexes) : ""
    : draftValid ? buildAlterTableSql(dialect, schema, table, columns, draftColumns, constraints) : "";
  const updateDraftColumn = (id: number, patch: Partial<EditDraftColumn>) => setDraftColumns((current) => current.map((column) => column.id === id ? { ...column, ...patch } : column));
  const updateDraftIndex = (id: number, patch: Partial<EditDraftIndex>) => setDraftIndexes((current) => current.map((index) => index.id === id ? { ...index, ...patch } : index));
  return <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}><DialogSurface className="omni-table-dialog" style={{ width: "min(860px, calc(100vw - 24px))", maxWidth: "none" }}><DialogBody className="omni-table-dialog-body">
    <DialogTitle>{t("tableStructure")}: {schema}.{table}</DialogTitle><DialogContent className="omni-table-dialog-content">{loading ? <Spinner label={t("loadingStructure")} /> : error ? <Text style={{ color: "var(--colorPaletteRedForeground1)" }}>{error}</Text> : editing && tab === "columns" ? <div style={{ display: "grid", gap: 12 }}>
      <Text size={200}>{t("dropColumnWarning")}</Text>
      {!draftValid && <Text style={{ color: "var(--colorPaletteRedForeground1)" }}>{t("invalidColumns")}</Text>}
      <div style={{ overflowX: "auto" }}><table className="table-designer-grid"><thead><tr><th>{t("name")}</th><th>{t("type")}</th><th>{t("nullable")}</th><th>PK</th><th>{t("defaultColumnValue")}</th><th /></tr></thead><tbody>{draftColumns.map((column) => { const columnLabel = column.name || column.originalName || t("newColumn"); return <tr key={column.id}>
        <td><Input aria-label={t("columnNameFor").replace("{column}", column.originalName ?? t("newColumn"))} value={column.name} onChange={(_, data) => updateDraftColumn(column.id, { name: data.value })} /></td>
        <td><Combobox freeform aria-label={t("columnTypeFor").replace("{column}", columnLabel)} value={column.dataType} onChange={(event) => updateDraftColumn(column.id, { dataType: event.currentTarget.value })} onOptionSelect={(_, data) => updateDraftColumn(column.id, { dataType: data.optionValue ?? "" })}>{TYPE_OPTIONS[dialect].map((type) => <Option key={type} value={type}>{type}</Option>)}</Combobox></td>
        <td><Checkbox aria-label={t("allowNullFor").replace("{column}", columnLabel)} checked={column.nullable} disabled={column.primaryKey} onChange={(_, data) => updateDraftColumn(column.id, { nullable: data.checked === true })} /></td>
        <td><Checkbox aria-label={t("primaryKeyFor").replace("{column}", columnLabel)} checked={column.primaryKey} onChange={(_, data) => updateDraftColumn(column.id, { primaryKey: data.checked === true, nullable: data.checked === true ? false : column.nullable })} /></td>
        <td><Input aria-label={t("defaultValueFor").replace("{column}", columnLabel)} value={column.defaultValue} onChange={(_, data) => updateDraftColumn(column.id, { defaultValue: data.value })} /></td>
        <td><Button appearance="transparent" icon={<DeleteRegular />} aria-label={t("removeColumnFor").replace("{column}", columnLabel)} onClick={() => setDraftColumns((current) => current.filter((item) => item.id !== column.id))} /></td>
      </tr>; })}</tbody></table></div>
      <Button appearance="subtle" icon={<AddRegular />} style={{ justifySelf: "start" }} onClick={() => { setDraftColumns((current) => [...current, { id: nextId, name: "", dataType: TYPE_OPTIONS[dialect][0]!, nullable: true, primaryKey: false, defaultValue: "" }]); setNextId((value) => value + 1); }}>{t("addColumn")}</Button>
      <Field label="ALTER TABLE"><Textarea value={sql || t("noChanges")} readOnly resize="vertical" style={{ minHeight: 180, fontFamily: "monospace" }} /></Field>
    </div> : editing && tab === "indexes" ? <div style={{ display: "grid", gap: 12 }}>
      {!indexDraftValid && <Text style={{ color: "var(--colorPaletteRedForeground1)" }}>{t("invalidIndexes")}</Text>}
      <div style={{ overflowX: "auto" }}><table className="table-designer-grid"><thead><tr><th>{t("name")}</th><th>{t("columns")}</th><th>UNIQUE</th><th /></tr></thead><tbody>{draftIndexes.map((index) => <tr key={index.id}>
        <td><Input aria-label={t("indexNameFor").replace("{index}", index.name)} value={index.name} disabled={index.primary} onChange={(_, data) => updateDraftIndex(index.id, { name: data.value })} /></td>
        <td><Input aria-label={t("indexColumnsFor").replace("{index}", index.name)} value={index.columnsText} disabled={index.primary} onChange={(_, data) => updateDraftIndex(index.id, { columnsText: data.value })} /></td>
        <td><Checkbox aria-label={t("uniqueIndexFor").replace("{index}", index.name)} checked={index.unique} disabled={index.primary} onChange={(_, data) => updateDraftIndex(index.id, { unique: data.checked === true })} /></td>
        <td><Button appearance="transparent" icon={<DeleteRegular />} aria-label={t("removeIndexFor").replace("{index}", index.name)} disabled={index.primary} onClick={() => setDraftIndexes((current) => current.filter((item) => item.id !== index.id))} /></td>
      </tr>)}</tbody></table></div>
      <Button appearance="subtle" icon={<AddRegular />} style={{ justifySelf: "start" }} onClick={() => { setDraftIndexes((current) => [...current, { id: nextId, name: "", columnsText: "", unique: false, primary: false }]); setNextId((value) => value + 1); }}>{t("addIndex")}</Button>
      <Field label="INDEX DDL"><Textarea value={sql || t("noChanges")} readOnly resize="vertical" style={{ minHeight: 180, fontFamily: "monospace" }} /></Field>
    </div> : <><TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="columns">{t("columns")} ({columns.length})</Tab><Tab value="indexes">{t("indexes")} ({indexes.length})</Tab><Tab value="ddl">DDL</Tab></TabList>
      {tab === "columns" && <><table className="table-structure-grid"><thead><tr><th>{t("name")}</th><th>{t("type")}</th><th>{t("nullable")}</th><th>{t("keys")}</th><th>{t("sampleValue")}</th></tr></thead><tbody>{columns.map((column) => { const sampleIndex = sampleColumnIndexes.get(column.name); const sampleValue = !sampleResult && !sampleError ? t("loading") : sampleIndex === undefined || !sampleRow ? "—" : formatSampleValue(sampleRow[sampleIndex]); return <tr key={column.name}><td>{column.name}</td><td>{column.dataType}</td><td>{column.nullable ? t("yes") : t("no")}</td><td>{column.isPrimaryKey ? "PK" : column.foreignKeyTo ? `FK → ${column.foreignKeyTo.schema}.${column.foreignKeyTo.table}.${column.foreignKeyTo.column}` : ""}</td><td className="table-structure-sample" title={sampleValue}>{sampleValue}</td></tr>; })}</tbody></table>{sampleError ? <Text size={200}>{t("sampleLoadFailed")}</Text> : sampleResult && !sampleRow ? <Text size={200}>{t("noSampleRows")}</Text> : null}</>}
      {tab === "indexes" && <table className="table-structure-grid"><thead><tr><th>{t("name")}</th><th>{t("columns")}</th><th>{t("type")}</th></tr></thead><tbody>{indexes.map((index) => <tr key={index.name}><td>{index.name}</td><td>{index.columns.join(", ")}</td><td>{index.primary ? "PRIMARY" : index.unique ? "UNIQUE" : "INDEX"}</td></tr>)}</tbody></table>}
      {tab === "ddl" && <Textarea className="table-structure-ddl" value={ddl} readOnly resize="vertical" />}</>}</DialogContent><DialogActions>{editing ? <><Button onClick={() => setEditing(false)}>{t("cancel")}</Button><Button appearance="primary" disabled={!sql} onClick={() => { onOpenSql((tab === "indexes" ? t("alterIndexesTab") : t("alterTableTab")).replace("{table}", table), sql); onClose(); }}>{t("openSql")}</Button></> : <><Button onClick={onClose}>{t("close")}</Button>{tab !== "ddl" && <Button appearance="primary" onClick={beginEditing}>{tab === "indexes" ? t("editIndexes") : t("editStructure")}</Button>}</>}</DialogActions>
  </DialogBody></DialogSurface></Dialog>;
}
