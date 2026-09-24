export interface S3TableSource {
  uri: string;
  name: string;
  format: "csv" | "parquet" | "delta" | "iceberg";
}

export function detectS3Tables(objects: readonly string[]): S3TableSource[] {
  const found = new Map<string, S3TableSource>();
  for (const uri of objects) {
    const delta = uri.match(/^(s3:\/\/[^?]+)\/_delta_log\/[^/]+\.json$/i);
    if (delta) {
      const root = delta[1]!;
      found.set(root, { uri: root, name: root.split("/").at(-1) || root, format: "delta" });
      continue;
    }
    const iceberg = uri.match(/^(s3:\/\/[^?]+)\/metadata\/([^/]+\.metadata\.json)$/i);
    if (iceberg) {
      const root = iceberg[1]!;
      const previous = found.get(root);
      if (!previous || uri.includes("current.metadata.json") || (!previous.uri.includes("current.metadata.json") && uri > previous.uri)) {
        found.set(root, { uri, name: root.split("/").at(-1) || root, format: "iceberg" });
      }
      continue;
    }
    if (uri.includes("/_delta_log/") || uri.includes("/metadata/")) continue;
    const format = /\.parquet$/i.test(uri) ? "parquet" : /\.csv$/i.test(uri) ? "csv" : null;
    if (format) found.set(uri, { uri, name: uri.split("/").at(-1) || uri, format });
  }
  const sources = [...found.values()];
  return sources.filter((source) => !sources.some((other) => {
    if (source === other) return false;
    if (other.format === "delta") return source.uri.startsWith(`${other.uri}/`);
    if (other.format === "iceberg") return source.uri.startsWith(`${other.uri.split("/metadata/")[0]}/`);
    return false;
  }))
    .sort((a, b) => a.uri.localeCompare(b.uri));
}
