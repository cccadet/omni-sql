# omni-sql landing page

Dependency-free static landing page published by `.github/workflows/pages.yml`.
The repository must have **Settings → Pages → Source → GitHub Actions** enabled once.

Live site: https://cccadet.github.io/omni-sql/

Keep feature descriptions aligned with the root README and `docs/`. Download
links use `releases/latest` so they follow the current published release.
Changes under `website/` pushed to `main` automatically deploy through the Pages
workflow; verify the workflow and live page after publishing.

The page leads with the PostgreSQL + CSV local-analysis example in `docs/demo/`.
Its result table repeats that example's fictional data; it is not a live database
connection. Keep both aligned when changing the demo. The three primary benefits
are file analysis, local joins, and contextual SQL editing. Secondary capabilities
and import/export limits follow below the demonstration.

Assets are served from `website/assets/` so each Pages deployment contains its
own images. `local-analysis-join.png` is copied from the real demo capture in
`docs/images/release-visuals/`; the logo and favicon come from the repository root.
Update these copies together with their sources. The screenshot illustrates the
demo workflow rather than promising an exact match to every subsequent release.

Preview with a static server rooted at `website/` (for example,
`python -m http.server 8080 --directory website`). Before publishing, check mobile
and desktop layout, image loading, keyboard navigation, the expandable import
details, and download/documentation links. There is no JS bundle or build step.

## Languages

English is served at `/`; Brazilian Portuguese is served at `/pt/`. Both pages
share styles and assets and remain readable with JavaScript disabled. Keep their
content, section IDs, links, and alternate-language metadata aligned.

`language.js` uses the browser's first supported language on the initial English
entry page, falling back to English. The header's English / Português links use
`?lang=` to select and save a manual preference in localStorage. That choice wins
on later visits to `/`. Direct `/pt/` links remain Portuguese. When storage is
blocked, explicit language links and browser detection still work, but choices
cannot persist. The demo screenshot and linked guides retain their source language.

Run the language-routing checks with `node --test scripts/website-language.test.mjs`
and lint with `pnpm exec eslint website/language.js scripts/website-language.test.mjs`.

## Feature sections

Both homepages group the features at `#features`, with a four-link section index,
the local-analysis walkthrough, and separate visual blocks for SQL editing,
results, MongoDB, imports, S3, and MCP. Keep matching section IDs in both languages
so automatic language navigation can preserve deep links.

`assets/features/` mirrors the existing CTE and MCP captures in `docs/images/`
and the query-result/import captures in `docs/images/release-visuals/`. These are
illustrations of the workflows, not a guarantee of exact current toolbar layout.
MongoDB Extended JSON and S3 SQL are labeled illustrative examples, not app
screenshots. The feature index and code examples also work without JavaScript.
