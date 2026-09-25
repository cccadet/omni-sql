import { listAnalysisDuckLake } from "./analysis";

export interface S3TableSource {
  uri: string;
  name: string;
  format: "csv" | "parquet" | "delta" | "iceberg" | "ducklake";
  tableSchema?: string;
  tableName?: string;
  catalog?: DuckLakeCatalog;
}

export type DuckLakeCatalog =
  | { kind: "postgres"; host: string; port: number; database: string; user: string; password?: string }
  | { kind: "sqlite" | "duckdb"; path: string };

export interface DuckLakeMapping { prefix: string; catalog: DuckLakeCatalog }
export interface S3DiscoveryCredentials { accessKeyId: string; secretAccessKey?: string; ducklakeMappings?: DuckLakeMapping[] }

export function resolveDuckLakeSource<T extends S3TableSource>(source: T, credentials: S3DiscoveryCredentials): T {
  if (source.format !== "ducklake") return source;
  const mapping = (credentials.ducklakeMappings ?? []).filter(({ prefix }) => source.uri === prefix || source.uri.startsWith(`${prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!mapping) throw new Error(`Catálogo DuckLake não configurado para ${source.uri}`);
  return { ...source, catalog: mapping.catalog };
}

export function duckLakeCandidatePrefixes(objects: readonly string[]): string[] {
  return [...new Set(objects.filter((uri) => /\/ducklake-[^/]+\.parquet$/i.test(uri))
    .map((uri) => uri.slice(0, uri.lastIndexOf("/"))))].sort();
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
    if (uri.includes("/_delta_log/") || uri.includes("/metadata/") || /\.ducklake\.files\//i.test(uri)) continue;
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

export async function discoverS3Tables(objects: readonly string[], mappings: readonly DuckLakeMapping[],
  listDuckLake: (mapping: DuckLakeMapping) => Promise<readonly { schema: string; name: string; uri: string }[]>): Promise<S3TableSource[]> {
  const lakeTables = (await Promise.all(mappings.map(async (mapping) =>
    (await listDuckLake(mapping)).map((table) => ({ ...table, mapping }))))).flat()
    .filter(({ uri, mapping }) => uri === mapping.prefix || uri.startsWith(`${mapping.prefix}/`))
    .filter(({ uri, mapping }) => !mappings.some((other) => other !== mapping && other.prefix.length > mapping.prefix.length
      && (uri === other.prefix || uri.startsWith(`${other.prefix}/`))));
  const sources: S3TableSource[] = lakeTables.map(({ schema, name, uri, mapping }) => ({
    uri, name: `${schema}.${name}`, format: "ducklake", tableSchema: schema, tableName: name, catalog: mapping.catalog,
  }));
  const dataFiles = new Set(objects.filter((uri) => /\/ducklake-[^/]+\.parquet$/i.test(uri)
    && sources.some((source) => uri.startsWith(`${source.uri}/`))));
  return [...detectS3Tables(objects.filter((uri) => !dataFiles.has(uri))), ...sources]
    .sort((a, b) => `${a.uri}/${a.name}`.localeCompare(`${b.uri}/${b.name}`));
}

export function discoverConfiguredS3Tables(objects: readonly string[], bucketUri: string, region: string, endpoint: string | undefined,
  credentials: S3DiscoveryCredentials): Promise<S3TableSource[]> {
  const mappings = (credentials.ducklakeMappings ?? []).filter(({ prefix }) => prefix === bucketUri || prefix.startsWith(`${bucketUri}/`));
  return discoverS3Tables(objects, mappings, ({ prefix, catalog }) => listAnalysisDuckLake({
    uri: bucketUri, region, endpoint, accessKeyId: credentials.accessKeyId || undefined,
    secretAccessKey: credentials.secretAccessKey, prefix: prefix.slice(bucketUri.length).replace(/^\//, ""), catalog,
  }));
}
