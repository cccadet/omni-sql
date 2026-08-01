import type { SqlDiagnostic } from "@omni-sql/ts-types";
import type { TranslationKey } from "../i18n";

const diagnosticSeverityLabel: Record<SqlDiagnostic["severity"], TranslationKey> = {
  error: "error",
  warning: "warning",
  info: "info",
};

export function formatDiagnosticHoverLabel(severity: SqlDiagnostic["severity"], translate: (key: TranslationKey) => string): string {
  return translate(diagnosticSeverityLabel[severity]);
}
