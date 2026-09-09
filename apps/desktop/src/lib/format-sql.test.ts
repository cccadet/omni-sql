import { assert, describe, expect, test } from "vitest";
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

describe("safe SQL formatting", () => {
  test.each(["postgres", "mysql", "mariadb", "sqlserver", "oracle", "jdbc-generic"] as const)(
    "formats GRANT conservatively for %s",
    (dialect) => {
      expect(formatSql(
        "GRANT SELECT, UPDATE, DELETE, INSERT ON BIDW.LAUDOS_ESTATISTICA TO DREMIO;",
        dialect,
        DEFAULT_FORMATTER_SETTINGS,
      )).toBe("GRANT SELECT, UPDATE, DELETE, INSERT\nON BIDW.LAUDOS_ESTATISTICA\nTO DREMIO;");
    },
  );

  test("formats REVOKE without treating SELECT as a query", () => {
    expect(formatSql("REVOKE SELECT, UPDATE ON BIDW.T FROM DREMIO;", "postgres", DEFAULT_FORMATTER_SETTINGS))
      .toBe("REVOKE SELECT, UPDATE\nON BIDW.T\nFROM DREMIO;");
  });

  test.each([
    "VACUUM (ANALYZE, VERBOSE) BIDW.T;",
    "SET search_path TO bidw, public;",
    "COPY BIDW.T (a, b) FROM STDIN;",
    "SHOW ALL;",
    "BEGIN EXECUTE IMMEDIATE 'GRANT SELECT ON t TO u'; END;",
  ])("preserves unsupported or administrative syntax: %s", (sql) => {
    expect(formatSql(sql, "postgres", DEFAULT_FORMATTER_SETTINGS)).toBe(sql);
  });

  test("formats mixed documents statement by statement", () => {
    const sql = "GRANT SELECT, UPDATE ON BIDW.T TO DREMIO;\nSELECT a,b FROM BIDW.T;";
    const formatted = formatSql(sql, "postgres", DEFAULT_FORMATTER_SETTINGS);
    expect(formatted).toContain("GRANT SELECT, UPDATE\nON BIDW.T\nTO DREMIO;");
    expect(formatted).toContain("SELECT\n  a,\n  b\nFROM\n  BIDW.T;");
  });

  test("is idempotent", () => {
    const once = formatSql("SELECT a,b FROM t WHERE a=1 AND b=2;", "postgres", DEFAULT_FORMATTER_SETTINGS);
    expect(formatSql(once, "postgres", DEFAULT_FORMATTER_SETTINGS)).toBe(once);
  });
});
