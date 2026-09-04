import type { DialectId } from "@omni-sql/ts-types";

export type SqlCommandCategory = "data" | "schema" | "indexes" | "security" | "transactions" | "diagnostics";

export interface SqlCommand {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: SqlCommandCategory;
  readonly dialects: readonly DialectId[];
  readonly sql: string;
  readonly searchTerms: readonly string[];
}

const ALL: readonly DialectId[] = ["postgres", "mysql", "mariadb", "sqlserver", "oracle", "jdbc-generic", "odbc"];
const MYSQL: readonly DialectId[] = ["mysql", "mariadb"];

export const SQL_COMMANDS: readonly SqlCommand[] = [
  { id: "create-table", title: "Create table", description: "Create a table with primary key and required columns.", category: "schema", dialects: ALL, searchTerms: ["criar tabela", "ddl"], sql: "CREATE TABLE table_name (\n  id INTEGER NOT NULL,\n  name VARCHAR(255) NOT NULL,\n  CONSTRAINT pk_table_name PRIMARY KEY (id)\n);" },
  { id: "add-column", title: "Add column", description: "Add a column to an existing table.", category: "schema", dialects: ALL, searchTerms: ["adicionar coluna", "alter table"], sql: "ALTER TABLE table_name\nADD COLUMN column_name VARCHAR(255);" },
  { id: "create-index", title: "Create index", description: "Create an index for frequently filtered columns.", category: "indexes", dialects: ALL, searchTerms: ["criar índice", "performance"], sql: "CREATE INDEX idx_table_column\nON table_name (column_name);" },
  { id: "transaction", title: "Transaction", description: "Execute changes atomically with commit or rollback.", category: "transactions", dialects: ALL, searchTerms: ["transação", "commit", "rollback"], sql: "BEGIN;\n\n-- SQL statements\n\nCOMMIT;\n-- ROLLBACK;" },
  { id: "safe-update", title: "Update rows", description: "Update selected rows using an explicit predicate.", category: "data", dialects: ALL, searchTerms: ["atualizar dados", "update where"], sql: "UPDATE table_name\nSET column_name = value\nWHERE id = value;" },
  { id: "safe-delete", title: "Delete rows", description: "Delete selected rows using an explicit predicate.", category: "data", dialects: ALL, searchTerms: ["excluir dados", "delete where"], sql: "DELETE FROM table_name\nWHERE id = value;" },
  { id: "pg-upsert", title: "Upsert", description: "Insert a row or update it on key conflict.", category: "data", dialects: ["postgres"], searchTerms: ["insert conflict", "atualizar ou inserir"], sql: "INSERT INTO table_name (id, column_name)\nVALUES (value, value)\nON CONFLICT (id) DO UPDATE\nSET column_name = EXCLUDED.column_name;" },
  { id: "mysql-upsert", title: "Upsert", description: "Insert a row or update it on duplicate key.", category: "data", dialects: MYSQL, searchTerms: ["insert duplicate", "atualizar ou inserir"], sql: "INSERT INTO table_name (id, column_name)\nVALUES (value, value)\nON DUPLICATE KEY UPDATE\ncolumn_name = VALUES(column_name);" },
  { id: "mssql-upsert", title: "Upsert with MERGE", description: "Update a matching row or insert a new one.", category: "data", dialects: ["sqlserver"], searchTerms: ["merge", "atualizar ou inserir"], sql: "MERGE INTO table_name AS target\nUSING (VALUES (value, value)) AS source (id, column_name)\nON target.id = source.id\nWHEN MATCHED THEN UPDATE SET column_name = source.column_name\nWHEN NOT MATCHED THEN INSERT (id, column_name) VALUES (source.id, source.column_name);" },
  { id: "grant-select", title: "Grant read access", description: "Grant SELECT permission on a table.", category: "security", dialects: ALL, searchTerms: ["permissão", "permission", "grant"], sql: "GRANT SELECT ON table_name TO user_name;" },
  { id: "pg-sessions", title: "Active sessions", description: "Inspect active PostgreSQL sessions and SQL statements.", category: "diagnostics", dialects: ["postgres"], searchTerms: ["sessões", "locks", "SQL em execução"], sql: "SELECT pid, usename, state, wait_event_type, wait_event, query_start, query\nFROM pg_stat_activity\nWHERE state <> 'idle'\nORDER BY query_start;" },
  { id: "mysql-processlist", title: "Active sessions", description: "Inspect active MySQL or MariaDB sessions.", category: "diagnostics", dialects: MYSQL, searchTerms: ["sessões", "processos", "SQL em execução"], sql: "SHOW FULL PROCESSLIST;" },
  { id: "mssql-sessions", title: "Active requests", description: "Inspect SQL Server requests currently executing.", category: "diagnostics", dialects: ["sqlserver"], searchTerms: ["sessões", "requests", "SQL em execução"], sql: "SELECT session_id, status, command, wait_type, start_time\nFROM sys.dm_exec_requests\nWHERE session_id <> @@SPID;" },
  { id: "oracle-sessions", title: "Active sessions", description: "Inspect active Oracle user sessions.", category: "diagnostics", dialects: ["oracle"], searchTerms: ["sessões", "locks", "SQL em execução"], sql: "SELECT sid, serial#, username, status, event, sql_id\nFROM v$session\nWHERE type = 'USER' AND status = 'ACTIVE';" },
];

export function commandsForDialect(dialect: DialectId): readonly SqlCommand[] {
  return SQL_COMMANDS.filter((command) => command.dialects.includes(dialect));
}

export function searchSqlCommands(commands: readonly SqlCommand[], query: string, category: "all" | SqlCommandCategory): readonly SqlCommand[] {
  const normalized = query.trim().toLocaleLowerCase();
  return commands.filter((command) => {
    if (category !== "all" && command.category !== category) return false;
    if (!normalized) return true;
    return [command.title, command.description, command.category, ...command.searchTerms, command.sql]
      .some((value) => value.toLocaleLowerCase().includes(normalized));
  });
}
