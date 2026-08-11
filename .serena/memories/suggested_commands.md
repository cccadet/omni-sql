Install: `pnpm install`.

Checks: `pnpm -r typecheck`; `pnpm -r lint`; `pnpm -r test`; full `pnpm verify`. Backend-only: `pnpm --filter backend typecheck`, `pnpm --filter backend lint`, `pnpm --filter backend test`. MCP-only: `pnpm --filter mcp-server typecheck`, `pnpm --filter mcp-server lint`, `pnpm --filter mcp-server test`.

Dev/build: `pnpm dev:frontend` (Vite :1420); `pnpm dev:backend` (JSON-RPC :41920); `pnpm dev:tauri`; `pnpm build:tauri`.

Rust: run `cargo check` inside `apps/desktop/src-tauri`. Backend/packages use Node tests; desktop uses Vitest. See `mem:task_completion` for validation order and ownership.
