// @vitest-environment node
import { expect, test } from "vitest";
import { detectS3Tables, discoverS3Tables, duckLakeCandidatePrefixes, resolveDuckLakeSource, type DuckLakeCatalog } from "./s3-sources";

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
