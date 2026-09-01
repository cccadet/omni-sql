import { useEffect, useState } from "react";
import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Dropdown, Field, Input, Option, Spinner, Tab, TabList, Text, Textarea,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import type { DialectId, IndexInfo } from "@omni-sql/ts-types";
import { backend, type RelationColumn } from "../lib/backend";

interface DraftColumn {
  id: number;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
}

interface EditDraftColumn extends DraftColumn { originalName?: string; }

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

export function buildAlterTableSql(dialect: DialectId, schema: string, table: string, original: readonly RelationColumn[], draft: readonly EditDraftColumn[]): string {
  const q = (value: string) => quoteIdentifier(value, dialect);
  const target = schema.trim() ? `${q(schema.trim())}.${q(table)}` : q(table);
  const statements: string[] = [];
  const draftByOriginal = new Map(draft.filter((column) => column.originalName).map((column) => [column.originalName!, column]));
  for (const previous of original) {
    const current = draftByOriginal.get(previous.name);
    if (!current) {
      statements.push(`ALTER TABLE ${target} DROP COLUMN ${q(previous.name)};`);
      continue;
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
  const [schema, setSchema] = useState(initialSchema ?? schemas[0] ?? "");
  const [table, setTable] = useState("");
  const [nextId, setNextId] = useState(2);
  const [columns, setColumns] = useState<DraftColumn[]>([{ id: 1, name: "id", dataType: TYPE_OPTIONS[dialect][0]!, nullable: false, primaryKey: true, defaultValue: "" }]);
  useEffect(() => {
    if (open) setSchema(initialSchema ?? schemas[0] ?? "");
  }, [initialSchema, open, schemas]);
  const validColumns = columns.filter((column) => column.name.trim() && column.dataType.trim());
  const sql = table.trim() && validColumns.length ? buildCreateTableSql(dialect, schema, table, validColumns) : "";
  const updateColumn = (id: number, patch: Partial<DraftColumn>) => setColumns((current) => current.map((column) => column.id === id ? { ...column, ...patch } : column));
  return <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
    <DialogSurface style={{ width: "min(920px, calc(100vw - 24px))", maxWidth: "none" }}>
      <DialogBody><DialogTitle>Criar tabela</DialogTitle><DialogContent style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <Field label="Schema">{schemas.length > 0
            ? <Dropdown value={schema} selectedOptions={schema ? [schema] : []} onOptionSelect={(_, data) => setSchema(data.optionValue ?? "")}>{schemas.map((name) => <Option key={name} value={name}>{name}</Option>)}</Dropdown>
            : <Input value={schema} onChange={(_, data) => setSchema(data.value)} />}
          </Field>
          <Field label="Nome da tabela" required><Input aria-label="Nome da tabela" value={table} onChange={(_, data) => setTable(data.value)} autoFocus /></Field>
        </div>
        <div style={{ overflowX: "auto" }}><table className="table-designer-grid"><thead><tr><th>Nome</th><th>Tipo</th><th>Nulo</th><th>PK</th><th>Default</th><th /></tr></thead><tbody>
          {columns.map((column) => <tr key={column.id}>
            <td><Input value={column.name} aria-label="Nome da coluna" onChange={(_, data) => updateColumn(column.id, { name: data.value })} /></td>
            <td><Input value={column.dataType} aria-label="Tipo da coluna" list={`types-${column.id}`} onChange={(_, data) => updateColumn(column.id, { dataType: data.value })} /><datalist id={`types-${column.id}`}>{TYPE_OPTIONS[dialect].map((type) => <option key={type} value={type} />)}</datalist></td>
            <td><Checkbox checked={column.nullable} aria-label="Permitir nulo" onChange={(_, data) => updateColumn(column.id, { nullable: data.checked === true })} /></td>
            <td><Checkbox checked={column.primaryKey} aria-label="Chave primária" onChange={(_, data) => updateColumn(column.id, { primaryKey: data.checked === true, nullable: data.checked === true ? false : column.nullable })} /></td>
            <td><Input value={column.defaultValue} aria-label="Valor default" onChange={(_, data) => updateColumn(column.id, { defaultValue: data.value })} /></td>
            <td><Button appearance="transparent" icon={<DeleteRegular />} aria-label="Remover coluna" disabled={columns.length === 1} onClick={() => setColumns((current) => current.filter((item) => item.id !== column.id))} /></td>
          </tr>)}</tbody></table></div>
        <Button appearance="subtle" icon={<AddRegular />} style={{ justifySelf: "start" }} onClick={() => { setColumns((current) => [...current, { id: nextId, name: "", dataType: TYPE_OPTIONS[dialect][0]!, nullable: true, primaryKey: false, defaultValue: "" }]); setNextId((value) => value + 1); }}>Adicionar coluna</Button>
        <Field label="Prévia SQL"><Textarea value={sql} readOnly resize="vertical" style={{ minHeight: 150, fontFamily: "monospace" }} /></Field>
        {dialect === "jdbc-generic" || dialect === "odbc" ? <Text size={200}>Revise o SQL: o dialeto genérico pode exigir ajustes específicos do driver.</Text> : null}
      </DialogContent><DialogActions><Button onClick={onClose}>Cancelar</Button><Button appearance="primary" disabled={!sql} onClick={() => { onOpenSql(`Criar ${table.trim()}`, sql); onClose(); }}>Abrir SQL</Button></DialogActions></DialogBody>
    </DialogSurface>
  </Dialog>;
}

interface EditTableDialogProps { open: boolean; connectionId: string | null; dialect: DialectId; schema: string; table: string; onClose: () => void; onOpenSql: (title: string, sql: string) => void; }
export function EditTableDialog({ open, connectionId, dialect, schema, table, onClose, onOpenSql }: EditTableDialogProps) {
  const [original, setOriginal] = useState<RelationColumn[]>([]);
  const [columns, setColumns] = useState<EditDraftColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextId, setNextId] = useState(1);
  useEffect(() => {
    if (!open || !connectionId) return;
    setLoading(true); setError(null);
    void backend.call<{ columns: RelationColumn[] }>("metadata.listColumns", { connectionId, schema, table }).then(({ columns: loaded }) => {
      setOriginal(loaded);
      setColumns(loaded.map((column, index) => ({ id: index + 1, originalName: column.name, name: column.name, dataType: column.dataType, nullable: column.nullable, primaryKey: column.isPrimaryKey, defaultValue: column.defaultValue ?? "" })));
      setNextId(loaded.length + 1);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoading(false));
  }, [connectionId, open, schema, table]);
  const sql = buildAlterTableSql(dialect, schema, table, original, columns);
  const updateColumn = (id: number, patch: Partial<EditDraftColumn>) => setColumns((current) => current.map((column) => column.id === id ? { ...column, ...patch } : column));
  return <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}><DialogSurface style={{ width: "min(920px, calc(100vw - 24px))", maxWidth: "none" }}><DialogBody>
    <DialogTitle>Editar tabela: {schema}.{table}</DialogTitle><DialogContent style={{ display: "grid", gap: 12 }}>{loading ? <Spinner label="Carregando colunas…" /> : error ? <Text>{error}</Text> : <>
      <Text size={200}>A remoção de uma coluna gera DROP COLUMN. Revise cuidadosamente o SQL antes de executar.</Text>
      <div style={{ overflowX: "auto" }}><table className="table-designer-grid"><thead><tr><th>Nome</th><th>Tipo</th><th>Nulo</th><th>PK</th><th>Default</th><th /></tr></thead><tbody>{columns.map((column) => <tr key={column.id}>
        <td><Input aria-label="Nome da coluna" value={column.name} disabled={column.originalName !== undefined} onChange={(_, data) => updateColumn(column.id, { name: data.value })} /></td>
        <td><Input aria-label={`Tipo de ${column.name}`} value={column.dataType} onChange={(_, data) => updateColumn(column.id, { dataType: data.value })} /></td>
        <td><Checkbox aria-label={`Permitir nulo em ${column.name}`} checked={column.nullable} disabled={column.primaryKey} onChange={(_, data) => updateColumn(column.id, { nullable: data.checked === true })} /></td>
        <td><Checkbox aria-label={`Chave primária ${column.name}`} checked={column.primaryKey} disabled /></td>
        <td><Input aria-label={`Default de ${column.name}`} value={column.defaultValue} onChange={(_, data) => updateColumn(column.id, { defaultValue: data.value })} /></td>
        <td><Button appearance="transparent" icon={<DeleteRegular />} aria-label={`Remover ${column.name || "coluna"}`} onClick={() => setColumns((current) => current.filter((item) => item.id !== column.id))} /></td>
      </tr>)}</tbody></table></div>
      <Button appearance="subtle" icon={<AddRegular />} style={{ justifySelf: "start" }} onClick={() => { setColumns((current) => [...current, { id: nextId, name: "", dataType: TYPE_OPTIONS[dialect][0]!, nullable: true, primaryKey: false, defaultValue: "" }]); setNextId((value) => value + 1); }}>Adicionar coluna</Button>
      <Field label="ALTER TABLE"><Textarea value={sql || "-- Nenhuma alteração."} readOnly resize="vertical" style={{ minHeight: 180, fontFamily: "monospace" }} /></Field>
    </>}</DialogContent><DialogActions><Button onClick={onClose}>Cancelar</Button><Button appearance="primary" disabled={!sql} onClick={() => { onOpenSql(`Alterar ${table}`, sql); onClose(); }}>Abrir SQL</Button></DialogActions>
  </DialogBody></DialogSurface></Dialog>;
}

interface TableStructureDialogProps { open: boolean; connectionId: string | null; schema: string; table: string; onClose: () => void; }
export function TableStructureDialog({ open, connectionId, schema, table, onClose }: TableStructureDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<RelationColumn[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [ddl, setDdl] = useState("");
  const [tab, setTab] = useState("columns");
  useEffect(() => {
    if (!open || !connectionId) return;
    setLoading(true); setError(null); setTab("columns");
    void Promise.all([
      backend.call<{ columns: RelationColumn[] }>("metadata.listColumns", { connectionId, schema, table }),
      backend.call<{ indexes: IndexInfo[] }>("metadata.listIndexes", { connectionId, schema, table }),
      backend.call<{ sql: string }>("metadata.getDefinition", { connectionId, kind: "table", schema, name: table }),
    ]).then(([columnResult, indexResult, definition]) => { setColumns(columnResult.columns); setIndexes(indexResult.indexes); setDdl(definition.sql); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoading(false));
  }, [connectionId, open, schema, table]);
  return <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}><DialogSurface style={{ width: "min(860px, calc(100vw - 24px))", maxWidth: "none" }}><DialogBody>
    <DialogTitle>Estrutura: {schema}.{table}</DialogTitle><DialogContent>{loading ? <Spinner label="Carregando estrutura…" /> : error ? <Text style={{ color: "var(--colorPaletteRedForeground1)" }}>{error}</Text> : <><TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="columns">Colunas ({columns.length})</Tab><Tab value="indexes">Índices ({indexes.length})</Tab><Tab value="ddl">DDL</Tab></TabList>
      {tab === "columns" && <table className="table-structure-grid"><thead><tr><th>Nome</th><th>Tipo</th><th>Nulo</th><th>Chaves</th></tr></thead><tbody>{columns.map((column) => <tr key={column.name}><td>{column.name}</td><td>{column.dataType}</td><td>{column.nullable ? "Sim" : "Não"}</td><td>{column.isPrimaryKey ? "PK" : column.foreignKeyTo ? `FK → ${column.foreignKeyTo.schema}.${column.foreignKeyTo.table}.${column.foreignKeyTo.column}` : ""}</td></tr>)}</tbody></table>}
      {tab === "indexes" && <table className="table-structure-grid"><thead><tr><th>Nome</th><th>Colunas</th><th>Tipo</th></tr></thead><tbody>{indexes.map((index) => <tr key={index.name}><td>{index.name}</td><td>{index.columns.join(", ")}</td><td>{index.primary ? "PRIMARY" : index.unique ? "UNIQUE" : "INDEX"}</td></tr>)}</tbody></table>}
      {tab === "ddl" && <Textarea value={ddl} readOnly resize="vertical" style={{ width: "100%", minHeight: 280, marginTop: 12, fontFamily: "monospace" }} />}</>}</DialogContent><DialogActions><Button onClick={onClose}>Fechar</Button></DialogActions>
  </DialogBody></DialogSurface></Dialog>;
}
