import type { ConnectionConfig } from "@omni-sql/ts-types";
import { dialectDescriptor } from "@omni-sql/dialect-descriptors";
import { tokenize } from "@omni-sql/autocomplete-engine";
import { RpcValidationError } from "./rpc-errors.ts";

export function assertSafeExplainSql(sql: string, dialect: ConnectionConfig["dialect"]): void {
  const descriptor = dialectDescriptor(dialect);
  const tokens = tokenize(sql, descriptor).filter((token) =>
    token.type !== "whitespace" && token.type !== "comment" && token.type !== "eof",
  );
  if (tokens.length === 0) throw new RpcValidationError("query.explain requer uma consulta SELECT");

  const separators = tokens.filter((token) => token.type === "punct" && token.value === descriptor.statementSeparator);
  if (separators.length > 1 || (separators.length === 1 && separators[0] !== tokens.at(-1))) {
    throw new RpcValidationError("query.explain aceita somente uma instrução");
  }

  const words = tokens.map((token) => token.value.toUpperCase());
  if (words[0] !== "SELECT" && words[0] !== "WITH") {
    throw new RpcValidationError("query.explain aceita somente consultas SELECT");
  }
  if (["INSERT", "UPDATE", "DELETE", "MERGE", "CALL", "DO", "COPY"].some((word) => words.includes(word))) {
    throw new RpcValidationError("query.explain não aceita instruções que modificam dados");
  }
  if (words.some((word, index) => word === "FOR" && words[index + 1] === "UPDATE")) {
    throw new RpcValidationError("query.explain não aceita locking reads");
  }
}

export function assertEndpointHasNoEmbeddedCredentials(config: ConnectionConfig): void {
  if (config.dialect !== "postgres" && config.dialect !== "mysql" && config.dialect !== "mariadb") return;
  if (!/^(postgres(?:ql)?|mysql|mariadb):\/\//i.test(config.endpoint)) return;
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    return;
  }
  if (endpoint.username || endpoint.password) {
    throw new RpcValidationError("endpoint não pode incluir usuário ou senha; use os campos de conexão");
  }
}

/** Removes legacy URI userinfo after its password has been moved to the keyring. */
export function extractLegacyEndpointCredentials(
  config: ConnectionConfig,
): { config: ConnectionConfig; password?: string } | null {
  if (config.dialect !== "postgres" && config.dialect !== "mysql" && config.dialect !== "mariadb") return null;
  if (!/^(postgres(?:ql)?|mysql|mariadb):\/\//i.test(config.endpoint)) return null;
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    return null;
  }
  if (!endpoint.username && !endpoint.password) return null;

  const user = config.user || decodeURIComponent(endpoint.username);
  let password: string | undefined;
  try {
    password = endpoint.password ? decodeURIComponent(endpoint.password) : undefined;
  } catch {
    password = endpoint.password || undefined;
  }
  endpoint.username = "";
  endpoint.password = "";
  return { config: { ...config, endpoint: endpoint.toString(), user }, password };
}
