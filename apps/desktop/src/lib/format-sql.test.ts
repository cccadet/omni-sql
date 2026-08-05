import { assert, test } from "vitest";
import { DEFAULT_FORMATTER_SETTINGS, formatSql } from "./format-sql";

test("PostgreSQL formatter preserves JSON ->> operator", () => {
  const formatted = formatSql(
    "SELECT attributes ->> 'tool.name' FROM events",
    "postgres",
    DEFAULT_FORMATTER_SETTINGS,
  );

  assert.match(formatted, /attributes ->> 'tool\.name'/);
  assert.ok(!formatted.includes("- > >"));
});
