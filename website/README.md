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
