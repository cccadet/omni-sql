import { expect, test } from "vitest";
import { mongoCommandSql } from "./mongo-command";

test("recognizes only a leading /mongo conversion command", () => {
  expect(mongoCommandSql(" /mongo\nSELECT * FROM db.items")).toBe("SELECT * FROM db.items");
  expect(mongoCommandSql("/MONGO SELECT x FROM db.items")).toBe("SELECT x FROM db.items");
  expect(mongoCommandSql("/mongo")).toBe("");
  for (const text of ['{"collection":"/mongo"}', "SELECT '/mongo'", "/mongodb SELECT 1"]) expect(mongoCommandSql(text)).toBeNull();
});
