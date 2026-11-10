// Single map of the documentation site: which repository Markdown file becomes
// which page, and how the sidebar groups them. The sync script and the Astro
// config both read it, so adding a page means adding one entry here.

export const site = "https://cccadet.github.io";
export const base = "/omni-sql/docs";
export const repoUrl = "https://github.com/cccadet/omni-sql";

/** @type {{ label: string, translations?: Record<string, string>, pages: { source: string, slug: string, label?: string }[] }[]} */
export const sections = [
  {
    label: "Start here",
    translations: { "pt-BR": "Comece aqui" },
    pages: [
      { source: "docs/INSTALL.md", slug: "start/install" },
      { source: "docs/GETTING-STARTED.md", slug: "start/getting-started" },
    ],
  },
  {
    label: "Guides",
    translations: { "pt-BR": "Guias" },
    pages: [
      { source: "docs/SQL-EDITOR.md", slug: "guides/sql-editor" },
      { source: "docs/CONNECTIONS.md", slug: "guides/connections" },
      { source: "docs/LOCAL-ANALYSIS.md", slug: "guides/local-analysis" },
      { source: "docs/MONGODB.md", slug: "guides/mongodb" },
      { source: "docs/MCP.md", slug: "guides/mcp" },
    ],
  },
  {
    label: "Tutorials",
    translations: { "pt-BR": "Tutoriais" },
    pages: [
      { source: "docs/demo/README.md", slug: "tutorials/database-and-csv" },
      { source: "docs/TUTORIAL-MONGODB-SQL.md", slug: "tutorials/mongodb-sql", label: "MongoDB with SQL (Português)" },
    ],
  },
  {
    label: "Reference",
    translations: { "pt-BR": "Referência" },
    pages: [
      { source: "docs/DATABASE-SUPPORT.md", slug: "reference/database-support" },
      { source: "docs/SHORTCUTS.md", slug: "reference/shortcuts" },
      { source: "docs/TROUBLESHOOTING.md", slug: "reference/troubleshooting" },
    ],
  },
  {
    label: "Contributing",
    translations: { "pt-BR": "Contribuindo" },
    pages: [
      { source: "docs/DEVELOPMENT.md", slug: "contributing/development" },
      { source: "docs/ARCHITECTURE.md", slug: "contributing/architecture" },
      { source: "docs/TESTING.md", slug: "contributing/testing" },
      { source: "docs/BUILDING.md", slug: "contributing/building" },
    ],
  },
];

export const pages = sections.flatMap((section) => section.pages);
