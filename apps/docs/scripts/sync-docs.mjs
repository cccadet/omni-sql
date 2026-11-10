/* global console, process */
// Generates the Starlight content from the repository's Markdown so docs/ stays
// the single source: GitHub keeps rendering the .md files, and the site gets a
// title in frontmatter, links rewritten to site pages, and copied images.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base, pages, repoUrl } from "../pages.mjs";

const IMAGE_EXT = /\.(png|gif|svg|jpe?g|webp)$/i;
const LINK_RE = /(\]\()([^)\s]+)(\))|((?:src|href)=")([^"]+)(")/g;

/**
 * Rewrites one repository Markdown file into a Starlight page.
 * @param {string} text Markdown source.
 * @param {{ source: string, pages: { source: string, slug: string }[], base: string, repoUrl: string, isDirectory?: (repoPath: string) => boolean }} options
 * @returns {{ markdown: string, title: string, assets: string[] }}
 */
export function transformMarkdown(text, options) {
  const { source, isDirectory = () => false } = options;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const titleIndex = lines.findIndex((line) => /^# /.test(line));
  if (titleIndex === -1) throw new Error(`${source}: missing "# Title" heading`);
  const title = lines[titleIndex].slice(2).trim();
  lines.splice(titleIndex, 1);

  const assets = new Set();
  const rewrite = (target) => {
    if (/^(?:[a-z]+:|#|\/)/i.test(target)) return target;
    const [file, hash] = target.split("#");
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), file));
    const page = options.pages.find((entry) => entry.source === resolved);
    if (page) return `${options.base}/${page.slug}/${hash ? `#${hash}` : ""}`;
    if (IMAGE_EXT.test(resolved) && resolved.startsWith("docs/")) {
      assets.add(resolved);
      return `${options.base}/media/${resolved.slice("docs/".length)}`;
    }
    const kind = file.endsWith("/") || isDirectory(resolved) ? "tree" : "blob";
    return `${options.repoUrl}/${kind}/main/${resolved.replace(/\/$/, "")}${hash ? `#${hash}` : ""}`;
  };

  // Leave fenced code and inline code untouched.
  const body = lines.join("\n").split(/(^```[\s\S]*?^```)/m).map((chunk, index) => {
    if (index % 2 === 1) return chunk;
    return chunk.split(/(`[^`\n]*`)/).map((part, partIndex) => (partIndex % 2 === 1
      ? part
      : part.replace(LINK_RE, (_m, a1, t1, z1, a2, t2, z2) => (a1 ? `${a1}${rewrite(t1)}${z1}` : `${a2}${rewrite(t2)}${z2}`)))).join("");
  }).join("");

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `editUrl: ${JSON.stringify(`${options.repoUrl}/edit/main/${source}`)}`,
    "---",
    "",
    "",
  ].join("\n");
  return { markdown: frontmatter + body.replace(/^\n+/, ""), title, assets: [...assets] };
}

function main() {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(appDir, "../..");
  const contentDir = path.join(appDir, "src/content/docs");
  const mediaDir = path.join(appDir, "public/media");

  fs.rmSync(contentDir, { recursive: true, force: true });
  fs.rmSync(mediaDir, { recursive: true, force: true });
  fs.cpSync(path.join(appDir, "content"), contentDir, { recursive: true });

  for (const page of pages) {
    const text = fs.readFileSync(path.join(repoRoot, page.source), "utf8");
    const { markdown, assets } = transformMarkdown(text, {
      source: page.source,
      pages,
      base,
      repoUrl,
      isDirectory: (repoPath) => fs.statSync(path.join(repoRoot, repoPath), { throwIfNoEntry: false })?.isDirectory() ?? false,
    });
    const out = path.join(contentDir, `${page.slug}.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, markdown);
    for (const asset of assets) {
      const target = path.join(mediaDir, asset.slice("docs/".length));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, asset), target);
    }
  }

  fs.mkdirSync(path.join(appDir, "src/assets"), { recursive: true });
  fs.mkdirSync(path.join(appDir, "public"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "omni-sql.svg"), path.join(appDir, "src/assets/omni-sql.svg"));
  fs.copyFileSync(path.join(repoRoot, "omni-sql.svg"), path.join(appDir, "public/favicon.svg"));
  console.log(`Synced ${pages.length} pages into ${path.relative(repoRoot, contentDir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
