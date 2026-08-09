import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  BackendClientError,
  BackendMcpClient,
  MAX_CONNECTION_ID_BYTES,
  MAX_RATIONALE_BYTES,
  MAX_SQL_BYTES,
  MAX_TITLE_BYTES,
  readRuntimeDescriptor,
  type RuntimeDescriptor,
} from "./backend-client.ts";

export { BackendClientError, BackendMcpClient, mcpToolNames, readRuntimeDescriptor } from "./backend-client.ts";
export type { RuntimeDescriptor } from "./backend-client.ts";

const boundedText = (maxBytes: number, name: string) =>
  z.string()
    .min(1, `${name} must not be empty`)
    .refine((value) => Buffer.byteLength(value, "utf8") <= maxBytes, `${name} is too large`);

export const emptyInputSchema = z.object({}).strict();
export const getLatestSqlExecutionErrorInputSchema = emptyInputSchema;
export const openSqlTabInputSchema = z.object({
  title: boundedText(MAX_TITLE_BYTES, "title"),
  sql: boundedText(MAX_SQL_BYTES, "sql"),
  connectionId: boundedText(MAX_CONNECTION_ID_BYTES, "connectionId").optional(),
}).strict();
export const proposeSqlEditInputSchema = z.object({
  sql: boundedText(MAX_SQL_BYTES, "sql"),
  rationale: boundedText(MAX_RATIONALE_BYTES, "rationale"),
}).strict();

type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};

function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "null";
}

function errorText(error: unknown): string {
  if (error instanceof BackendClientError) {
    return JSON.stringify({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return JSON.stringify({ code: "invalid_request", message: "invalid tool input" });
  }
  return JSON.stringify({ code: "backend_error", message: "MCP backend request failed" });
}

function success(value: unknown): ToolResult {
  return { content: [{ type: "text", text: resultText(value) }] };
}

function failure(error: unknown): ToolResult {
  return { content: [{ type: "text", text: errorText(error) }], isError: true };
}

async function invoke<T>(operation: () => Promise<T>): Promise<ToolResult> {
  try {
    return success(await operation());
  } catch (error) {
    return failure(error);
  }
}

export function createMcpServer(client: BackendMcpClient): McpServer {
  const server = new McpServer({ name: "omni-sql", version: "0.0.0" });

  server.registerTool(
    "getActiveSql",
    {
      description: "Read SQL from active Omni SQL tab.",
      inputSchema: emptyInputSchema,
    },
    async (input) => invoke(() => {
      emptyInputSchema.parse(input);
      return client.call("getActiveSql", {});
    }),
  );

  server.registerTool(
    "getActiveConnectionContext",
    {
      description: "Read safe context for active Omni SQL connection.",
      inputSchema: emptyInputSchema,
    },
    async (input) => invoke(() => {
      emptyInputSchema.parse(input);
      return client.call("getActiveConnectionContext", {});
    }),
  );

  server.registerTool(
    "getSchemaSummary",
    {
      description: "Read permitted schema summary for active Omni SQL connection.",
      inputSchema: emptyInputSchema,
    },
    async (input) => invoke(() => {
      emptyInputSchema.parse(input);
      return client.call("getSchemaSummary", {});
    }),
  );

  server.registerTool(
    "getLatestSqlExecutionError",
    {
      description: "Read latest failed SQL execution error from active Omni SQL tab.",
      inputSchema: getLatestSqlExecutionErrorInputSchema,
    },
    async (input) => invoke(() => {
      getLatestSqlExecutionErrorInputSchema.parse(input);
      return client.call("getLatestSqlExecutionError", {});
    }),
  );

  server.registerTool(
    "openSqlTab",
    {
      description: "Request a new Omni SQL tab without executing SQL.",
      inputSchema: openSqlTabInputSchema,
    },
    async (input) => invoke(() => {
      const parsed = openSqlTabInputSchema.parse(input);
      return client.call("openSqlTab", parsed);
    }),
  );

  server.registerTool(
    "proposeSqlEdit",
    {
      description: "Propose SQL edit for explicit UI approval; never applies it automatically.",
      inputSchema: proposeSqlEditInputSchema,
    },
    async (input) => invoke(() => {
      const parsed = proposeSqlEditInputSchema.parse(input);
      return client.call("proposeSqlEdit", parsed);
    }),
  );

  return server;
}

export async function startMcpServer(
  descriptor: RuntimeDescriptor,
  transport = new StdioServerTransport(),
): Promise<void> {
  await createMcpServer(new BackendMcpClient(descriptor)).connect(transport);
}

function diagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "startup failed";
  return [...message]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? " " : character;
    })
    .join("");
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  if (argv.length > 1) throw new Error("usage: node dist/index.js [runtime-descriptor-path]");
  const descriptorPath = argv[0] ?? env.OMNI_SQL_MCP_DESCRIPTOR;
  if (!descriptorPath) throw new Error("runtime descriptor path is required");
  await startMcpServer(await readRuntimeDescriptor(descriptorPath));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`[omni-sql-mcp] ${diagnostic(error)}\n`);
    process.exitCode = 1;
  });
}
