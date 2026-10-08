# Product media guide

Use this checklist when refreshing README, release, website, and launch media. Show a
real workflow quickly and consistently without exposing credentials or production data.

## Primary demo GIF

- **Length:** 12–20 seconds.
- **Canvas:** 1600×900 or 1920×1080; crop unused desktop chrome.
- **Flow:** select connection → open schema → trigger CTE completion → run query → show results.
- **Dataset:** fictional names and values only.
- **Cursor:** move deliberately; pause briefly on autocomplete and the result grid.
- **Output:** optimized GIF for README plus MP4/WebM for social and the website.

README currently uses `docs/images/release-visuals/omni-sql-demo.gif` and
`docs/images/release-visuals/local-analysis-demo.gif`. Keep captions and links in
sync when refreshing them; see `scripts/generate_release_visuals.py` for release
visuals and [Publication plan](PUBLICATION-PLAN.md) for current channel status.

## Screenshot set

Capture at the same application size and theme: a workspace overview, CTE-aware
autocomplete, a dialect quick fix, an execution plan, and connection coverage. Use
short, benefit-led captions. Avoid empty areas, debug UI, unrelated errors, and OS data.

## Social preview

Create a dedicated 1280×640 image with the logo, product name, hero statement, five
supported connection types, and a clean UI crop. Upload it in **Repository settings → General
→ Social preview**; repository files cannot configure that GitHub setting by themselves.
