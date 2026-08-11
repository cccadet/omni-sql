Run smallest affected package test first. For cross-package TypeScript changes, run `pnpm -r typecheck` plus targeted tests; run `pnpm -r lint` for touched linted code. Use `pnpm verify` for broad integration changes. For Tauri/Rust changes, run `cargo check` inside `apps/desktop/src-tauri`.

Validation owner is orchestrator for delegated memory edits; do not claim checks were run unless output exists. Memory references use `mem:` syntax and must resolve after edits. Commands: `mem:suggested_commands`.
