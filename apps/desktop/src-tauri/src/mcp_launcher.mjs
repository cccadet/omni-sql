// omni-sql MCP launcher. MCP clients keep this stable path in their config;
// it starts the server build the desktop app staged most recently, so app
// updates take effect without copying the client configuration again.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const SERVER_NAME = /^server-[0-9a-f]{64}\.mjs$/;

function currentServer() {
  const name = readFileSync(join(directory, "server-current"), "utf8").trim();
  if (!SERVER_NAME.test(name)) throw new Error(`invalid MCP server pointer: ${JSON.stringify(name)}`);
  return join(directory, name);
}

async function start(retry) {
  const server = currentServer();
  // The server only runs main() when it is the process entry point.
  process.argv[1] = server;
  try {
    await import(pathToFileURL(server).href);
  } catch (error) {
    // Tolerate a server copy that disappeared between both reads.
    if (retry && error?.code === "ERR_MODULE_NOT_FOUND") return start(false);
    throw error;
  }
}

start(true).catch((error) => {
  process.stderr.write(`[omni-sql-mcp] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
