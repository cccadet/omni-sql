import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MCP_LIMITS,
  MCP_MAX_ARGUMENT_BYTES,
  MCP_MAX_BRIDGE_RESULT_BYTES,
  MCP_MAX_CONNECTION_ID_BYTES,
  MCP_MAX_ERROR_MESSAGE_BYTES,
  MCP_MAX_HTTP_BODY_BYTES,
  MCP_MAX_LISTENER_ID_BYTES,
  MCP_MAX_QUEUE_SIZE,
  MCP_MAX_RATIONALE_BYTES,
  MCP_MAX_REQUEST_ID_BYTES,
  MCP_MAX_SQL_BYTES,
  MCP_MAX_STRING_BYTES,
  MCP_MAX_TITLE_BYTES,
  MCP_MAX_UI_WAIT_MS,
  QueryError,
} from "./index.ts";

test("QueryError preserves the public error contract", () => {
  const error = new QueryError("syntax", "invalid SQL", "42601");

  assert.equal(error.name, "QueryError");
  assert.equal(error.message, "invalid SQL");
  assert.equal(error.causeTag, "syntax");
  assert.equal(error.sqlState, "42601");
  assert.ok(error instanceof Error);

  const networkError = new QueryError("network", "offline");
  assert.equal(networkError.sqlState, undefined);
});

test("MCP limits expose the bounded values consumed by all transports", () => {
  assert.deepEqual(MCP_LIMITS, {
    maxHttpBodyBytes: MCP_MAX_HTTP_BODY_BYTES,
    maxArgumentBytes: MCP_MAX_ARGUMENT_BYTES,
    maxStringBytes: MCP_MAX_STRING_BYTES,
    maxBridgeResultBytes: MCP_MAX_BRIDGE_RESULT_BYTES,
    maxQueueSize: MCP_MAX_QUEUE_SIZE,
    maxUiWaitMs: MCP_MAX_UI_WAIT_MS,
    requestTimeoutMs: 120_000,
    listenerLeaseMs: 30_000,
    maxRequestIdBytes: MCP_MAX_REQUEST_ID_BYTES,
    maxListenerIdBytes: MCP_MAX_LISTENER_ID_BYTES,
    maxErrorMessageBytes: MCP_MAX_ERROR_MESSAGE_BYTES,
    maxSqlBytes: MCP_MAX_SQL_BYTES,
    maxTitleBytes: MCP_MAX_TITLE_BYTES,
    maxRationaleBytes: MCP_MAX_RATIONALE_BYTES,
    maxConnectionIdBytes: MCP_MAX_CONNECTION_ID_BYTES,
  });
  assert.equal(MCP_MAX_SQL_BYTES, MCP_MAX_STRING_BYTES);
  assert.ok(MCP_LIMITS.maxArgumentBytes < MCP_LIMITS.maxHttpBodyBytes);
  assert.ok(MCP_LIMITS.maxBridgeResultBytes > MCP_LIMITS.maxHttpBodyBytes);
});
