import { test } from "node:test";
import assert from "node:assert/strict";

process.env.OMNI_SQL_METADATA_DB ??= ":memory:";
const { mutatesDatabaseStructure } = await import("./handlers.ts");

test("mutatesDatabaseStructure recognizes schema-changing statements", () => {
  assert.equal(mutatesDatabaseStructure("ALTER TABLE public.items ADD COLUMN note text"), true);
  assert.equal(mutatesDatabaseStructure("-- generated\nCREATE INDEX ix_items_note ON public.items(note)"), true);
  assert.equal(mutatesDatabaseStructure("/* reviewed */ DROP VIEW public.report"), true);
});

test("mutatesDatabaseStructure ignores data and read statements", () => {
  assert.equal(mutatesDatabaseStructure("SELECT * FROM public.items"), false);
  assert.equal(mutatesDatabaseStructure("UPDATE public.items SET note = NULL"), false);
  assert.equal(mutatesDatabaseStructure("WITH rows AS (SELECT 1) SELECT * FROM rows"), false);
});
