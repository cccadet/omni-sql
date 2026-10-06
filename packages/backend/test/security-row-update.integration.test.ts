import type { ConnectionConfig } from "@omni-sql/ts-types";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MysqlAdapter } from "@omni-sql/adapters-mysql";
import { MssqlAdapter } from "@omni-sql/adapters-mssql";
import { OracleAdapter } from "@omni-sql/adapters-oracle";

const enabled = process.env.OMNI_SQL_RUN_SECURITY_INTEGRATION === "1";
for (const dialect of ["mysql", "sqlserver", "oracle"] as const) {
  test(`${dialect}: nonunique row edits rollback and unique edits commit`, { skip: !enabled, timeout: 60_000 }, async () => {
    const name = `SECURITY_EDIT_${process.pid}`;
    const config: ConnectionConfig = { id: `security-${dialect}`, label: "Security regression", dialect,
      endpoint: dialect === "mysql" ? "127.0.0.1:3306/omni_test" : dialect === "sqlserver" ? "127.0.0.1:1433/omni_test" : "127.0.0.1:1521/XEPDB1",
      user: dialect === "sqlserver" ? "sa" : dialect === "mysql" ? "omni" : "OMNI", options: dialect === "sqlserver" ? { trustServerCertificate: true, serverName: "localhost" } : {} };
    const adapter = dialect === "mysql" ? new MysqlAdapter(config, "omni") : dialect === "sqlserver" ? new MssqlAdapter(config, "Omni!2024") : new OracleAdapter(config, "omni");
    const table = dialect === "mysql" ? `\`${name}\`` : dialect === "sqlserver" ? `[dbo].[${name}]` : `"${name}"`;
    const audit = `${name}_AUDIT`;
    try {
      await adapter.connect();
      await adapter.runQuery(`CREATE TABLE ${table} (id int, v int)${dialect === "mysql" ? " ENGINE=InnoDB" : ""}`, 10);
      await adapter.runQuery(`INSERT INTO ${table} (id,v) VALUES (1,0)`, 10);
      await adapter.runQuery(`INSERT INTO ${table} (id,v) VALUES (1,0)`, 10);
      await adapter.runQuery(`INSERT INTO ${table} (id,v) VALUES (2,0)`, 10);
      if (dialect === "sqlserver") {
        await adapter.runQuery(`CREATE TABLE dbo.[${audit}] (v int)`, 10);
        await adapter.runQuery(`CREATE TRIGGER dbo.[${name}_TRIGGER] ON ${table} AFTER UPDATE AS BEGIN SET NOCOUNT OFF; INSERT INTO dbo.[${audit}] VALUES (1); END`, 10);
      }
      const spec = { schema: dialect === "sqlserver" ? "dbo" : dialect === "mysql" ? "omni_test" : "OMNI", table: name, set: { V: 9 }, where: { ID: 1 } };
      assert.equal(await adapter.updateRow(spec), 2);
      assert.equal((await adapter.runQuery(`SELECT count(*) FROM ${table} WHERE v=0`, 10)).rows[0]?.[0], 3);
      assert.equal(await adapter.updateRow({ ...spec, where: { ID: 2 } }), 1);
      assert.equal((await adapter.runQuery(`SELECT count(*) FROM ${table} WHERE v=9`, 10)).rows[0]?.[0], 1);
      if (dialect === "mysql") {
        await adapter.runQuery(`ALTER TABLE ${table} ENGINE=MyISAM`, 10);
        await assert.rejects(adapter.updateRow(spec), /transactional MySQL table/);
        assert.equal((await adapter.runQuery(`SELECT count(*) FROM ${table} WHERE id=1 AND v=0`, 10)).rows[0]?.[0], 2);
      }
    } finally {
      await adapter.runQuery(`DROP TABLE ${table}`, 10).catch(() => undefined);
      if (dialect === "sqlserver") await adapter.runQuery(`DROP TABLE dbo.[${audit}]`, 10).catch(() => undefined);
      await adapter.close();
    }
  });
}
