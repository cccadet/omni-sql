omni-sql is pnpm workspace monorepo for multi-database SQL IDE: Tauri desktop shell, React frontend, Node HTTP JSON-RPC backend, 12 packages, SQLite metadata cache, and Kotlin/Calcite JVM sidecar. Frontend/backend contract lives in `packages/backend/src/protocol.ts`; desktop talks to backend over localhost HTTP JSON-RPC.

Current behavior includes bounded query execution with cancellation, CTE scope enrichment through `/scope/resolve` with tier1 fallback, and MCP stdio plus authenticated/bounded Streamable HTTP. CTE autocomplete case 8 remains TODO.

Maps: `mem:frontend/core`, `mem:backend/core`, `mem:mcp-server/core`. Stack: `mem:tech_stack`. Commands/verification: `mem:suggested_commands`, `mem:task_completion`. Coding invariants: `mem:conventions`. Formatter decision: `mem:frontend/formatter-sql`.
