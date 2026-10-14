import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../website/language.js", import.meta.url), "utf8");

function visit({ url = "https://example.com/omni-sql/", current = "en", languages = ["en-US"], language = "en-US", saved = null, blocked = false } = {}) {
  const result = { saved, redirect: null };
  runInNewContext(script, {
    URL,
    document: { documentElement: { lang: current }, currentScript: { src: "https://example.com/omni-sql/language.js" } },
    navigator: { languages, language },
    location: { href: url, replace: (target) => { result.redirect = target; } },
    localStorage: {
      getItem: () => { if (blocked) throw new Error("Storage blocked"); return saved; },
      setItem: (key, value) => { assert.equal(key, "omni-sql.website.language"); result.saved = value; },
    },
  });
  return result;
}

test("browser chooses the first supported language, with English as fallback", () => {
  assert.equal(visit({ languages: ["pt-BR", "en"] }).redirect, "https://example.com/omni-sql/pt/");
  assert.equal(visit({ languages: ["pt-PT"] }).redirect, "https://example.com/omni-sql/pt/");
  assert.equal(visit({ languages: ["fr-FR", "pt"] }).redirect, "https://example.com/omni-sql/pt/");
  assert.equal(visit({ languages: ["en-US", "pt-BR"] }).redirect, null);
  assert.equal(visit({ languages: ["fr-FR"] }).redirect, null);
  assert.equal(visit({ languages: [], language: "pt-BR" }).redirect, "https://example.com/omni-sql/pt/");
});

test("saved manual choice wins over browser preference", () => {
  assert.equal(visit({ saved: "en", languages: ["pt-BR"] }).redirect, null);
  assert.equal(visit({ saved: "pt-BR" }).redirect, "https://example.com/omni-sql/pt/");
});

test("language links persist a new choice and override the current page", () => {
  assert.deepEqual(visit({ url: "https://example.com/omni-sql/?lang=pt-BR", saved: "en" }), { saved: "pt-BR", redirect: "https://example.com/omni-sql/pt/?lang=pt-BR" });
  assert.deepEqual(visit({ url: "https://example.com/omni-sql/pt/?lang=en", current: "pt-BR", saved: "pt-BR" }), { saved: "en", redirect: "https://example.com/omni-sql/?lang=en" });
});

test("direct Portuguese URLs stay Portuguese without a redirect loop", () => {
  assert.equal(visit({ url: "https://example.com/omni-sql/pt/", current: "pt-BR", saved: "en" }).redirect, null);
  assert.equal(visit({ url: "https://example.com/omni-sql/pt/?lang=pt-BR", current: "pt-BR" }).redirect, null);
});

test("blocked storage and invalid preferences do not break navigation", () => {
  assert.equal(visit({ blocked: true, languages: ["pt-BR"] }).redirect, "https://example.com/omni-sql/pt/");
  assert.equal(visit({ blocked: true, url: "https://example.com/omni-sql/?lang=pt-BR" }).redirect, "https://example.com/omni-sql/pt/?lang=pt-BR");
  assert.equal(visit({ saved: "invalid", url: "https://example.com/omni-sql/?lang=https://evil.example" }).redirect, null);
});

test("automatic navigation preserves the project prefix, query and section", () => {
  assert.equal(visit({ url: "https://example.com/omni-sql/?source=demo#download", languages: ["pt-BR"] }).redirect, "https://example.com/omni-sql/pt/?source=demo#download");
});
