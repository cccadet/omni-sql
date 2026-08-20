import { describe, expect, it } from "vitest";
import { commandsForDialect, searchSqlCommands } from "./sql-command-library";

describe("SQL command library", () => {
  it("shows common and dialect-specific commands", () => {
    const postgres = commandsForDialect("postgres");
    expect(postgres.some((command) => command.id === "create-table")).toBe(true);
    expect(postgres.some((command) => command.id === "pg-upsert")).toBe(true);
    expect(postgres.some((command) => command.id === "mysql-upsert")).toBe(false);
  });

  it("searches by Portuguese intent and category", () => {
    const commands = commandsForDialect("postgres");
    expect(searchSqlCommands(commands, "criar índice", "all").map((command) => command.id)).toEqual(["create-index"]);
    expect(searchSqlCommands(commands, "", "security").map((command) => command.id)).toEqual(["grant-select"]);
  });
});
