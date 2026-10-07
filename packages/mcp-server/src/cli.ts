import { pathToFileURL } from "node:url";
import { diagnostic, main } from "./index.ts";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`[omni-sql-mcp] ${diagnostic(error)}\n`);
    process.exitCode = 1;
  });
}
