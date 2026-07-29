import { test } from "node:test";
import assert from "node:assert/strict";

process.env.OMNI_SQL_METADATA_DB ??= ":memory:";
const { handlers } = await import("./handlers.ts");

test("update.check returns newer stable GitHub release", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    tag_name: "v1.2.0",
    html_url: "https://github.com/cccadet/omni-sql/releases/tag/v1.2.0",
  }), { status: 200 })) as typeof fetch;
  try {
    assert.deepEqual(await handlers["update.check"]({ currentVersion: "1.1.9" }), {
      available: true,
      version: "v1.2.0",
      releaseUrl: "https://github.com/cccadet/omni-sql/releases/tag/v1.2.0",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("update.check fails closed for malformed or unavailable releases", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ tag_name: "not-semver", html_url: "https://example.com" }), { status: 200 })) as typeof fetch;
    assert.deepEqual(await handlers["update.check"]({ currentVersion: "1.0.0" }), { available: false });

    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.deepEqual(await handlers["update.check"]({ currentVersion: "1.0.0" }), { available: false });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
