import { format, type FormatOptions, type SqlLanguage, type FormatOptionsWithLanguage } from "sql-formatter";
import type { DialectId } from "@omni-sql/ts-types";

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
  return format(sql, buildFormatOptions(settings, dialect));
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
