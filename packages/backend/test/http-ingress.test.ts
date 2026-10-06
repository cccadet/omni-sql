import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("invalid raw request target cannot terminate the backend", { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "omni-http-ingress-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const { startServer } = await import(${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)});
    const server = startServer(0);
    server.once("listening", () => process.send(server.address().port));
  `], { env: { ...process.env, OMNI_SQL_AUTH_TOKEN: "ingress-test", OMNI_SQL_METADATA_DB: join(dir, "metadata.db"), OMNI_SQL_DEV_KEYRING_FILE: join(dir, "keyring.json") }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  try {
    const [port] = await once(child, "message");
    assert.equal(typeof port, "number");
    const socket = connect({ host: "127.0.0.1", port: port as number });
    let response = "";
    socket.on("data", chunk => { response += String(chunk); });
    await once(socket, "connect");
    socket.end("GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    await once(socket, "close");
    assert.match(response, /^HTTP\/1\.1 400/);
    const healthy = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: "Bearer ingress-test" } });
    assert.equal(healthy.status, 200);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill();
    await once(child, "exit");
    await rm(dir, { recursive: true, force: true });
  }
});
