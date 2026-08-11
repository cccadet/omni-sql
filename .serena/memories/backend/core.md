`packages/backend` is ESM Node/TypeScript HTTP JSON-RPC server. Entry: `src/index.ts`; public contract: `src/protocol.ts`; handlers: `src/handlers.ts`. It composes adapters, SQLite metadata cache, autocomplete, OS keyring, JVM sidecar, SQL diagnostics, and MCP bridge/handlers.

`query.run` validates positive integer limits, defaults to 1,000 rows, and caps requests at 10,000. `query.cancel` delegates to active adapter cancellation where driver support exists. CTE completion calls JVM/Calcite `/scope/resolve` with 250ms timeout, merges returned relations into tier1 autocomplete, and falls back to tier1 on sidecar failure, timeout, malformed response, or unparseable CTE.

MCP bridge exposes bounded, validated UI tools without credentials or automatic SQL edits; MCP transport architecture: `mem:mcp-server/core`. Root architecture: `mem:core`; invariants: `mem:conventions`; commands: `mem:suggested_commands`.
