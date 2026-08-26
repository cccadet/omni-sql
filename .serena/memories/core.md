# omni-sql
- pnpm workspace monorepo: multi-database SQL IDE. Major boundaries: Tauri desktop/React UI, Node JSON-RPC backend, Kotlin/Calcite sidecar, adapter/cache packages, standalone MCP server.
- Stable frontend↔backend contract: `packages/backend/src/protocol.ts`; desktop communicates with backend via localhost HTTP JSON-RPC.
- Query safety: bounded result rows; `query.cancel` delegates cancellation where drivers support it. CTE completion enriches lexer/metadata autocomplete via sidecar `/scope/resolve`, with tier-1 fallback on sidecar errors/timeouts/invalid response.
- Start with focused maps: UI `mem:frontend/core`; backend and bridge `mem:backend/core`; MCP transport `mem:mcp-server/core`; JVM parsing/scope `mem:jvm-sidecar/core`.
- Cross-project stack: `mem:tech_stack`; commands: `mem:suggested_commands`; completion checks: `mem:task_completion`; coding constraints: `mem:conventions`.