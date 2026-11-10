import assert from "node:assert/strict";
import { test } from "node:test";
import { transformMarkdown } from "./sync-docs.mjs";

const options = {
  source: "docs/GUIDE.md",
  pages: [
    { source: "docs/GUIDE.md", slug: "guides/guide" },
    { source: "docs/MCP.md", slug: "guides/mcp" },
    { source: "docs/demo/README.md", slug: "tutorials/demo" },
  ],
  base: "/omni-sql/docs",
  repoUrl: "https://github.com/o/r",
  isDirectory: (p) => p === "docker/test-dbs",
};

test("moves the H1 into frontmatter with an edit link to the source", () => {
  const { markdown, title } = transformMarkdown("# Local analysis\n\nIntro text.\n", options);
  assert.equal(title, "Local analysis");
  assert.match(markdown, /^---\ntitle: "Local analysis"\neditUrl: "https:\/\/github.com\/o\/r\/edit\/main\/docs\/GUIDE.md"\n---\n\nIntro text\.\n$/);
});

test("rewrites links to mapped pages, keeping anchors", () => {
  const { markdown } = transformMarkdown("# T\n\nSee [MCP](MCP.md#approvals) and [demo](demo/README.md).\n", options);
  assert.match(markdown, /\[MCP\]\(\/omni-sql\/docs\/guides\/mcp\/#approvals\)/);
  assert.match(markdown, /\[demo\]\(\/omni-sql\/docs\/tutorials\/demo\/\)/);
});

test("sends unmapped files and folders to GitHub and collects images", () => {
  const text = "# T\n\n[c](../CLAUDE.md) [db](../docker/test-dbs) ![x](images/a.png) <img src=\"images/b.svg\" />\n";
  const { markdown, assets } = transformMarkdown(text, options);
  assert.match(markdown, /\(https:\/\/github.com\/o\/r\/blob\/main\/CLAUDE.md\)/);
  assert.match(markdown, /\(https:\/\/github.com\/o\/r\/tree\/main\/docker\/test-dbs\)/);
  assert.match(markdown, /\(\/omni-sql\/docs\/media\/images\/a.png\)/);
  assert.match(markdown, /src="\/omni-sql\/docs\/media\/images\/b.svg"/);
  assert.deepEqual(assets.sort(), ["docs/images/a.png", "docs/images/b.svg"]);
});

test("leaves external links, anchors and code untouched", () => {
  const text = "# T\n\n[web](https://x.dev) [here](#local) `[a](MCP.md)`\n\n```md\n[b](MCP.md)\n```\n";
  const { markdown } = transformMarkdown(text, options);
  assert.ok(markdown.includes("[web](https://x.dev) [here](#local) `[a](MCP.md)`"));
  assert.ok(markdown.includes("```md\n[b](MCP.md)\n```"));
});

test("rejects a page without a title", () => {
  assert.throws(() => transformMarkdown("No heading\n", options), /missing "# Title"/);
});
