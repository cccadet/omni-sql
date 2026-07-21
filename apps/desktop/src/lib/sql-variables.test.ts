import { assert, test } from "vitest";
import { extractVariables, substituteVariables } from "./sql-variables";

test("extracts bind variables while ignoring strings, comments, and PostgreSQL casts", () => {
  const sql = `
    SELECT :id, ':ignored', $$:dollar_quoted$$, $tag$:tag_quoted$tag$
    -- :line_comment
    /* :block_comment */
    WHERE account_id = :id::uuid AND owner_id = :owner
  `;

  assert.deepEqual(extractVariables(sql), ["id", "owner"]);
});

test("substitutes bind variables without changing ignored SQL or PostgreSQL casts", () => {
  const sql = `SELECT :id::uuid, ':ignored', -- :comment
    :name /* :block */`;

  assert.equal(
    substituteVariables(sql, { id: "abc", name: "O'Reilly" }),
    `SELECT 'abc'::uuid, ':ignored', -- :comment
    'O''Reilly' /* :block */`,
  );
});
