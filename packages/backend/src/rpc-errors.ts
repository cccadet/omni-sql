/** Errors whose fixed message is safe to expose through JSON-RPC. */
export class RpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcValidationError";
  }
}
