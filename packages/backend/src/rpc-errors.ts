/** Errors whose fixed message is safe to expose through JSON-RPC. */
export class RpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcValidationError";
  }
}

/** Database error whose already-sanitized message may cross the JSON-RPC boundary. */
export class RpcDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcDatabaseError";
  }
}

/**
 * Oracle errors are otherwise hidden as "Internal error", which makes ordinary
 * DDL failures (permissions, quota, duplicate objects...) impossible to fix.
 * Only accept the driver's structured ORA code and its single-line ORA message;
 * arbitrary adapter errors remain private.
 */
export function safeOracleDatabaseError(error: unknown): RpcDatabaseError | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = Reflect.get(error, "code");
  if (typeof code !== "string" || !/^ORA-\d{5}$/.test(code)) return undefined;
  const firstLine = error.message.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine?.startsWith(`${code}:`)) return undefined;
  const sanitized = [...firstLine]
    .filter((character) => {
      const charCode = character.charCodeAt(0);
      return charCode >= 32 && charCode !== 127;
    })
    .join("")
    .slice(0, 500);
  return new RpcDatabaseError(sanitized);
}
