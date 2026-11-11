# omni-sql MCP server in standalone (introspection-only) mode.
#
# Build from the repository root:
#   docker build -f packages/mcp-server/Dockerfile -t omni-sql-mcp .
#   docker run -i --rm omni-sql-mcp
#
# The container speaks MCP over STDIO and lists the same tools and schemas as
# the desktop-launched server, but it has no runtime descriptor, credentials or
# database access: every tool call returns "omni-sql desktop is not running".
# To query databases, launch the MCP server from the omni-sql desktop app.
# See docs/MCP.md#standalone-mode.

FROM node:22-slim AS build
WORKDIR /repo
RUN npm install --global pnpm@11.17.0
COPY . .
RUN pnpm install --frozen-lockfile --filter "@omni-sql/mcp-server..." \
 && pnpm --filter @omni-sql/mcp-server build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# The esbuild bundle is self-contained; no node_modules are needed at runtime.
COPY --from=build /repo/packages/mcp-server/dist/ ./
USER node
ENTRYPOINT ["node", "/app/index.js", "--standalone"]
