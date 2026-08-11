`packages/mcp-server` is standalone MCP server package using `@modelcontextprotocol/sdk`. `createMcpServer` registers approved tools and can connect through `StdioServerTransport` for default stdio operation.

Streamable HTTP uses `StreamableHTTPServerTransport` at fixed `/mcp`, loopback host by default (`127.0.0.1`) and port `41922`. HTTP startup requires `OMNI_SQL_MCP_HTTP_TOKEN`; requests require Bearer authorization. Sessions use generated IDs, bounded capacity, idle expiry, and cleanup. Request bodies, tool text, streamed responses, errors, and bridge results are size-bounded and schema-validated.

`BackendMcpClient` forwards MCP tool calls to backend `/mcp`; backend MCP bridge validates safe payloads, filters sensitive fields, bounds queue/timeouts, and routes approved UI actions. See `mem:backend/core`, `mem:core`, and `mem:conventions`.
