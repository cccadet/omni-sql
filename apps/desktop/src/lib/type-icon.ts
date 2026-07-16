import {
  ArrowSortRegular,
  BoxRegular,
  DatabaseRegular,
  DataBarVerticalRegular,
  EyeRegular,
  FlashRegular,
  FingerprintRegular,
  LinkRegular,
  ListRegular,
  NumberSymbolRegular,
  PlayCircleRegular,
  QuestionRegular,
  TextCaseTitleRegular,
  ToggleLeftRegular,
  ClockRegular,
  CodeRegular,
  TableRegular,
} from "@fluentui/react-icons";
import type { FluentIcon } from "@fluentui/react-icons";

/**
 * Ícone sugerido para um tipo de coluna SQL.
 * Retorna o componente de ícone do Fluent UI (não um elemento JSX).
 */
export function typeIcon(dataType: string): FluentIcon {
  const t = dataType.toLowerCase();
  if (t.includes("int") || t.includes("serial") || t.includes("number")) return NumberSymbolRegular;
  if (t.includes("decimal") || t.includes("numeric") || t.includes("float") || t.includes("double") || t.includes("real") || t.includes("money")) return DataBarVerticalRegular;
  if (t.includes("bool") || t.includes("bit")) return ToggleLeftRegular;
  if (t.includes("date") || t.includes("time") || t.includes("timestamp")) return ClockRegular;
  if (t.includes("char") || t.includes("text") || t.includes("varchar") || t.includes("clob") || t.includes("string")) return TextCaseTitleRegular;
  if (t.includes("uuid")) return FingerprintRegular;
  if (t.includes("json") || t.includes("xml") || t.includes("array") || t.includes("struct")) return CodeRegular;
  if (t.includes("binary") || t.includes("blob") || t.includes("bytea")) return NumberSymbolRegular;
  return QuestionRegular;
}

/**
 * Ícone para agrupamentos de objetos no explorer.
 */
export function objectKindIcon(kind: "schema" | "table" | "view" | "function" | "procedure" | "trigger" | "sequence" | "package" | "synonym" | "index" | "column"): FluentIcon {
  switch (kind) {
    case "schema":
      return DatabaseRegular;
    case "table":
      return TableRegular;
    case "view":
      return EyeRegular;
    case "function":
      return NumberSymbolRegular;
    case "procedure":
      return PlayCircleRegular;
    case "trigger":
      return FlashRegular;
    case "sequence":
      return ArrowSortRegular;
    case "package":
      return BoxRegular;
    case "synonym":
      return LinkRegular;
    case "index":
      return ListRegular;
    case "column":
      return NumberSymbolRegular;
  }
}
