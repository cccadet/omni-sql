// @vitest-environment node
import { expect, test } from "vitest";
import { detectS3Tables, discoverS3Tables, duckLakeCandidatePrefixes, groupDuckLakeCandidates, resolveDuckLakeSource, selectReferencedS3Sources, type DuckLakeCatalog } from "./s3-sources";

test("DuckLake candidates group by bucket with their common directory prefix", () => {
  expect(groupDuckLakeCandidates([
    "s3://lake/ducklake/gold/sales/orders",
    "s3://lake/ducklake/gold/control/cursor",
    "s3://lake/ducklake/goldfish/items",
    "s3://other/business/visits",
    "s3://spread/a/one",
    "s3://spread/b/two",
  ])).toEqual([
    { bucket: "s3://lake", commonPrefix: "s3://lake/ducklake",
      prefixes: ["s3://lake/ducklake/gold/control/cursor", "s3://lake/ducklake/gold/sales/orders", "s3://lake/ducklake/goldfish/items"] },
    { bucket: "s3://other", commonPrefix: "s3://other/business/visits", prefixes: ["s3://other/business/visits"] },
    { bucket: "s3://spread", commonPrefix: "s3://spread", prefixes: ["s3://spread/a/one", "s3://spread/b/two"] },
  ]);
});

test("DuckLake candidates are unique and sorted alphabetically across case and accents", () => {
  expect(duckLakeCandidatePrefixes([
    "s3://bucket/Zebra/ducklake-a.parquet",
    "s3://bucket/ábaco/ducklake-b.parquet",
    "s3://bucket/apple/ducklake-c.parquet",
    "s3://bucket/apple/ducklake-d.parquet",
    "s3://bucket/ignored/orders.parquet",
  ])).toEqual(["s3://bucket/ábaco", "s3://bucket/apple", "s3://bucket/Zebra"]);
});

test("detects mixed tables in one S3 bucket", () => {
  expect(detectS3Tables([
    "s3://bucket/csv/orders.csv",
    "s3://bucket/parquet/orders.parquet",
    "s3://bucket/delta/orders/_delta_log/00000000000000000000.json",
    "s3://bucket/delta/orders/part-000.parquet",
    "s3://bucket/iceberg/orders/metadata/current.metadata.json",
    "s3://bucket/iceberg/orders/data/part-000.parquet",
  ])).toEqual([
    { uri: "s3://bucket/csv/orders.csv", name: "orders.csv", format: "csv" },
    { uri: "s3://bucket/delta/orders", name: "orders", format: "delta" },
    { uri: "s3://bucket/iceberg/orders/metadata/current.metadata.json", name: "orders", format: "iceberg" },
    { uri: "s3://bucket/parquet/orders.parquet", name: "orders.parquet", format: "parquet" },
  ]);
});

test("DuckLake catalog mappings resolve mixed buckets and table overrides", async () => {
  const objects = [
    "s3://bucket/main/orders/ducklake-a.parquet",
    "s3://bucket/main/customers/ducklake-b.parquet",
    "s3://bucket/main/customers/extra.parquet",
    "s3://bucket/other/orders.parquet",
  ];
  expect(duckLakeCandidatePrefixes(objects)).toEqual(["s3://bucket/main/customers", "s3://bucket/main/orders"]);
  const postgres: DuckLakeCatalog = { kind: "postgres", host: "localhost", port: 5432, database: "lake", user: "reader" };
  const sqlite: DuckLakeCatalog = { kind: "sqlite", path: "catalog.sqlite" };
  const sources = await discoverS3Tables(objects, [
    { prefix: "s3://bucket", catalog: postgres },
    { prefix: "s3://bucket/main/customers", catalog: sqlite },
  ], async ({ catalog }) => catalog.kind === "postgres"
    ? [{ schema: "main", name: "orders", uri: "s3://bucket/main/orders" }, { schema: "main", name: "customers", uri: "s3://bucket/main/customers" }]
    : [{ schema: "main", name: "customers", uri: "s3://bucket/main/customers" }]);
  expect(sources).toEqual([
    { uri: "s3://bucket/main/customers/extra.parquet", name: "extra.parquet", format: "parquet" },
    { uri: "s3://bucket/main/customers", name: "main.customers", format: "ducklake", tableSchema: "main", tableName: "customers", catalog: sqlite },
    { uri: "s3://bucket/main/orders", name: "main.orders", format: "ducklake", tableSchema: "main", tableName: "orders", catalog: postgres },
    { uri: "s3://bucket/other/orders.parquet", name: "orders.parquet", format: "parquet" },
  ]);
  expect(resolveDuckLakeSource({ ...sources[1]!, catalog: undefined }, { accessKeyId: "", ducklakeMappings: [
    { prefix: "s3://bucket", catalog: postgres }, { prefix: "s3://bucket/main/customers", catalog: sqlite },
  ] }).catalog).toEqual(sqlite);
});

test("S3 queries send only the catalog tables they reference, even in catalogs above the engine limit", () => {
  const catalog = Array.from({ length: 600 }, (_, index) => ({ schema: "replicacao-totvs", name: `srespuni__t${index}` }));
  catalog.push({ schema: "replicacao-totvs", name: "srespuni__pat_proced" }, { schema: "replicacao-totvs", name: "Mixed\"Case" });

  expect(selectReferencedS3Sources(catalog, 'SELECT * FROM "replicacao-totvs"."srespuni__pat_proced" LIMIT 1000').map((source) => source.name))
    .toEqual(["srespuni__pat_proced"]);
  expect(selectReferencedS3Sources(catalog, 'SELECT * FROM srespuni__t1 a JOIN "mixed""case" b ON true').map((source) => source.name))
    .toEqual(["srespuni__t1", "Mixed\"Case"]);
  expect(() => selectReferencedS3Sources(catalog, "SELECT 1")).toThrow(/602 tabelas/);
  expect(selectReferencedS3Sources(catalog.slice(0, 2), "SELECT 1")).toHaveLength(2);
  expect(() => selectReferencedS3Sources([], "SELECT * FROM srespuni__pat_proced")).toThrow(/Nenhuma tabela/);
});
