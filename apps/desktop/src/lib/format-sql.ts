import { format, type FormatOptions, type SqlLanguage, type FormatOptionsWithLanguage } from "sql-formatter";
import type { DialectId } from "@omni-sql/ts-types";
import { splitStatements } from "./sql-statements";

export type { FormatOptions, FormatOptionsWithLanguage } from "sql-formatter";

const DIALECT_MAP: Record<DialectId, SqlLanguage> = {
  postgres: "postgresql",
  mysql: "mysql",
  mariadb: "mariadb",
  sqlserver: "transactsql",
  oracle: "plsql",
  "jdbc-generic": "sql",
  odbc: "sql",
};

export interface FormatterSettings {
  /** Atalho de teclado no formato "Ctrl+Alt+L" / "Cmd+Shift+F" etc. */
  readonly keybinding: string;
  readonly keywordCase: FormatOptions["keywordCase"];
  readonly identifierCase: FormatOptions["identifierCase"];
  readonly dataTypeCase: FormatOptions["dataTypeCase"];
  readonly functionCase: FormatOptions["functionCase"];
  readonly indentStyle: FormatOptions["indentStyle"];
  readonly logicalOperatorNewline: FormatOptions["logicalOperatorNewline"];
  readonly tabWidth: number;
  readonly useTabs: boolean;
  readonly expressionWidth: number;
  readonly linesBetweenQueries: number;
  readonly denseOperators: boolean;
  readonly newlineBeforeSemicolon: boolean;
}

export const DEFAULT_FORMATTER_SETTINGS: FormatterSettings = {
  keybinding: "Ctrl+Alt+L",
  keywordCase: "upper",
  identifierCase: "preserve",
  dataTypeCase: "upper",
  functionCase: "preserve",
  indentStyle: "standard",
  logicalOperatorNewline: "before",
  tabWidth: 2,
  useTabs: false,
  expressionWidth: 80,
  linesBetweenQueries: 2,
  denseOperators: false,
  newlineBeforeSemicolon: false,
};

const SETTINGS_KEY = "omni-sql:formatterSettings";

export function loadFormatterSettings(): FormatterSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_FORMATTER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<FormatterSettings>;
    return { ...DEFAULT_FORMATTER_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_FORMATTER_SETTINGS;
  }
}

export function saveFormatterSettings(settings: FormatterSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage indisponível/cheio — configuração só não persiste.
  }
}

export function buildFormatOptions(
  settings: FormatterSettings,
  dialect: DialectId,
): FormatOptionsWithLanguage {
  return {
    language: DIALECT_MAP[dialect] ?? "sql",
    keywordCase: settings.keywordCase,
    identifierCase: settings.identifierCase,
    dataTypeCase: settings.dataTypeCase,
    functionCase: settings.functionCase,
    indentStyle: settings.indentStyle,
    logicalOperatorNewline: settings.logicalOperatorNewline,
    tabWidth: settings.tabWidth,
    useTabs: settings.useTabs,
    expressionWidth: settings.expressionWidth,
    linesBetweenQueries: settings.linesBetweenQueries,
    denseOperators: settings.denseOperators,
    newlineBeforeSemicolon: settings.newlineBeforeSemicolon,
  };
}

export function formatSql(sql: string, dialect: DialectId, settings: FormatterSettings): string {
  const statements = splitStatements(sql);
  if (statements.length > 1) {
    let result = sql;
    for (const statement of [...statements].reverse()) {
      const formatted = formatSingleStatement(statement.text, dialect, settings);
      result = result.slice(0, statement.start) + formatted + result.slice(statement.end);
    }
    return result;
  }
  return formatSingleStatement(sql, dialect, settings);
}

function formatSingleStatement(sql: string, dialect: DialectId, settings: FormatterSettings): string {
  const command = leadingCommand(sql);
  if (!command) return sql;
  if (command === "GRANT" || command === "REVOKE") return formatPrivilegeStatement(sql, settings);

  // The upstream formatter is query-oriented. Preserve vendor/admin commands
  // instead of guessing and damaging proprietary syntax.
  if (!FORMATTER_SUPPORTED_COMMANDS.has(command)) return sql;
  return format(sql, buildFormatOptions(settings, dialect));
}

const FORMATTER_SUPPORTED_COMMANDS = new Set([
  "SELECT", "WITH", "VALUES", "INSERT", "UPDATE", "DELETE", "MERGE",
  "CREATE", "ALTER", "DROP", "TRUNCATE",
]);

function leadingCommand(sql: string): string | null {
  let rest = sql.trimStart();
  while (rest.startsWith("--") || rest.startsWith("/*")) {
    if (rest.startsWith("--")) {
      const newline = rest.search(/[\r\n]/u);
      if (newline < 0) return null;
      rest = rest.slice(newline + 1).trimStart();
    } else {
      const close = rest.indexOf("*/", 2);
      if (close < 0) return null;
      rest = rest.slice(close + 2).trimStart();
    }
  }
  return /^[A-Za-z]+/u.exec(rest)?.[0]?.toUpperCase() ?? null;
}

function formatPrivilegeStatement(sql: string, settings: FormatterSettings): string {
  const match = /^(\s*)(GRANT|REVOKE)\s+([\s\S]+?)\s+(ON)\s+([\s\S]+?)\s+(TO|FROM)\s+([\s\S]*?)(\s*;?\s*)$/iu.exec(sql);
  if (!match) return sql;
  const [, leading = "", verb = "", privileges = "", on = "", object = "", recipientWord = "", recipient = "", trailing = ""] = match;
  const keyword = (value: string) => settings.keywordCase === "lower" ? value.toLowerCase() : settings.keywordCase === "upper" ? value.toUpperCase() : value;
  const normalizedPrivileges = privileges.split(",").map((item) => item.trim()).filter(Boolean).join(", ");
  return `${leading}${keyword(verb)} ${normalizedPrivileges}\n${keyword(on)} ${object.trim()}\n${keyword(recipientWord)} ${recipient.trim()}${trailing}`;
}

/** Parseia uma string de atalho no estilo "Ctrl+Alt+L" para bitmask do Monaco. */
export function parseKeybinding(keybinding: string): {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
} {
  const parts = keybinding.split(/\+/).map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? "";
  return {
    ctrl: parts.includes("ctrl") || parts.includes("control"),
    alt: parts.includes("alt") || parts.includes("option"),
    shift: parts.includes("shift"),
    meta: parts.includes("cmd") || parts.includes("command") || parts.includes("meta") || parts.includes("win"),
    key: key.length === 1 ? key.toUpperCase() : key,
  };
}

/** Valida se uma string representa um atalho aceitável (tecla + modificadores). */
export function isValidKeybinding(value: string): boolean {
  if (!value.trim()) return false;
  const { key, ctrl, alt, shift, meta } = parseKeybinding(value);
  if (!key) return false;
  if (key.length === 1 && !/[a-z0-9]/i.test(key)) return false;
  // Precisa de pelo menos um modificador para evitar conflitos com digitação.
  return ctrl || alt || shift || meta;
}

export function formatKeybindingForDisplay(value: string): string {
  return value
    .split(/\+/)
    .map((p) => p.trim())
    .map((p) => {
      const lower = p.toLowerCase();
      if (lower === "ctrl" || lower === "control") return "Ctrl";
      if (lower === "alt" || lower === "option") return "Alt";
      if (lower === "shift") return "Shift";
      if (lower === "cmd" || lower === "command" || lower === "meta" || lower === "win") return "⌘";
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join("+");
}
