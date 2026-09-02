import { describe, expect, it } from "vitest";
import { buildAlterTableSql, buildCreateTableSql, buildSampleRowSql } from "./TableDialogs";

describe("buildSampleRowSql", () => {
  it("quotes the table reference for each supported identifier style", () => {
    expect(buildSampleRowSql("postgres", "public", "order")).toBe('SELECT * FROM "public"."order"');
    expect(buildSampleRowSql("mysql", "sales", "order")).toBe("SELECT * FROM `sales`.`order`");
    expect(buildSampleRowSql("sqlserver", "dbo", "odd]name")).toBe("SELECT * FROM [dbo].[odd]]name]");
  });
});

describe("buildCreateTableSql", () => {
  it("quotes PostgreSQL identifiers and creates a composite primary key", () => {
    expect(buildCreateTableSql("postgres", "sales", "order", [
      { id: 1, name: "store_id", dataType: "integer", nullable: false, primaryKey: true, defaultValue: "" },
      { id: 2, name: "number", dataType: "bigint", nullable: false, primaryKey: true, defaultValue: "1" },
      { id: 3, name: "note", dataType: "text", nullable: true, primaryKey: false, defaultValue: "" },
    ])).toBe(`CREATE TABLE "sales"."order" (\n  "store_id" integer NOT NULL,\n  "number" bigint NOT NULL DEFAULT 1,\n  "note" text,\n  PRIMARY KEY ("store_id", "number")\n);`);
  });

  it("uses the quoting rules of MySQL and SQL Server", () => {
    const column = [{ id: 1, name: "odd]name", dataType: "int", nullable: false, primaryKey: false, defaultValue: "" }];
    expect(buildCreateTableSql("mysql", "db", "items", column)).toContain("`db`.`items`");
    expect(buildCreateTableSql("sqlserver", "dbo", "items", column)).toContain("[odd]]name] int");
  });
});

describe("buildAlterTableSql", () => {
  const original = [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }, { name: "note", dataType: "text", nullable: true, isPrimaryKey: false }];

  it("generates PostgreSQL changes, additions, and removals", () => {
    const sql = buildAlterTableSql("postgres", "public", "orders", original, [
      { id: 1, originalName: "id", name: "id", dataType: "bigint", nullable: false, primaryKey: true, defaultValue: "" },
      { id: 3, name: "created_at", dataType: "timestamp", nullable: false, primaryKey: false, defaultValue: "CURRENT_TIMESTAMP" },
    ]);
    expect(sql).toContain('ALTER COLUMN "id" TYPE bigint');
    expect(sql).toContain('DROP COLUMN "note"');
    expect(sql).toContain('ADD COLUMN "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');
  });

  it("uses MODIFY COLUMN for MySQL", () => {
    const sql = buildAlterTableSql("mysql", "shop", "items", original.slice(0, 1), [
      { id: 1, originalName: "id", name: "id", dataType: "bigint", nullable: false, primaryKey: true, defaultValue: "" },
    ]);
    expect(sql).toBe("ALTER TABLE `shop`.`items` MODIFY COLUMN `id` bigint NOT NULL;");
  });

  it("renames columns and replaces a named PostgreSQL primary key", () => {
    const sql = buildAlterTableSql("postgres", "public", "orders", original, [
      { id: 1, originalName: "id", name: "order_id", dataType: "integer", nullable: false, primaryKey: false, defaultValue: "" },
      { id: 2, originalName: "note", name: "note", dataType: "text", nullable: false, primaryKey: true, defaultValue: "" },
    ], [{ name: "orders_pkey", kind: "primary", columns: ["id"] }]);
    expect(sql).toContain('DROP CONSTRAINT "orders_pkey"');
    expect(sql).toContain('RENAME COLUMN "id" TO "order_id"');
    expect(sql).toContain('ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("note")');
  });

  it("uses sp_rename for SQL Server columns", () => {
    const sql = buildAlterTableSql("sqlserver", "dbo", "orders", original.slice(0, 1), [
      { id: 1, originalName: "id", name: "order_id", dataType: "integer", nullable: false, primaryKey: true, defaultValue: "" },
    ]);
    expect(sql).toBe("EXEC sp_rename N'dbo.orders.id', N'order_id', 'COLUMN';");
  });
});
