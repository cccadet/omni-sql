# Task completion
- Run the smallest affected package check first: its typecheck/test and lint when code changed.
- Cross-package TypeScript or contract changes require `pnpm -r typecheck` and affected tests; broad integration work uses `pnpm verify`.
- For UI/Tauri edits, run desktop tests as appropriate and `cargo check` for Rust changes. For sidecar edits, run `./gradlew test` in `services/jvm-sidecar`.
- Report only commands with observed output. Preserve unrelated dirty/untracked work; do not stage/revert it.
- Memory graph validity can be checked from project root with `serena memories check`.