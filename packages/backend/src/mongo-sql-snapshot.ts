import { BSON, type Document } from "mongodb";
import { RpcValidationError } from "./rpc-errors.ts";

type Shape = string | { [field: string]: Shape } | [Shape];
const plain = (value: unknown): value is Document => value !== null && typeof value === "object"
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function shape(values: unknown[], depth = 0, samples: unknown[] = []): Shape {
  if (depth > 32) throw new RpcValidationError("MongoDB SQL documents exceed the supported nesting depth (32)");
  const present = values.filter((value) => value != null);
  if (!present.length) return samples.some((value) => value != null) ? shape(samples, depth) : "JSON";
  if (present.every(Array.isArray)) return [shape(present.flat(), depth + 1, samples.filter(Array.isArray).flat())];
  if (present.every(plain)) {
    const sampleObjects = samples.filter(plain);
    const names = [...new Set([...present, ...sampleObjects].flatMap(Object.keys))];
    if (!names.length) return "JSON";
    return Object.fromEntries(names.map((name) => [name, shape(present.map((doc) => doc[name]), depth + 1, sampleObjects.map((doc) => doc[name]))]));
  }
  const types = new Set(present.map((value) => {
    if (value instanceof Date) return "TIMESTAMP";
    if (value instanceof BSON.ObjectId || value instanceof BSON.Decimal128 || value instanceof BSON.Binary) return "VARCHAR";
    if (value instanceof BSON.Timestamp) return "JSON";
    if (value instanceof BSON.Long || typeof value === "bigint") return "BIGINT";
    if (value instanceof BSON.Int32) return "BIGINT";
    if (value instanceof BSON.Double) return "DOUBLE";
    if (typeof value === "string") return "VARCHAR";
    if (typeof value === "boolean") return "BOOLEAN";
    if (typeof value === "number") return Number.isSafeInteger(value) ? "BIGINT" : "DOUBLE";
    return "JSON";
  }));
  // A mixed numeric column stays JSON rather than rounding an exact Int64 into DOUBLE.
  return types.size === 1 ? [...types][0]! : "JSON";
}

export function mongoSqlValue(value: unknown, depth = 0): unknown {
  if (depth > 32) throw new RpcValidationError("MongoDB SQL documents exceed the supported nesting depth (32)");
  if (value instanceof Date) return value.toISOString();
  if (value instanceof BSON.ObjectId) return value.toHexString();
  if (value instanceof BSON.Timestamp) return BSON.EJSON.serialize(value, { relaxed: false });
  if (value instanceof BSON.Long || value instanceof BSON.Decimal128 || typeof value === "bigint") return value.toString();
  if (value instanceof BSON.Int32 || value instanceof BSON.Double) return mongoSqlValue(value.valueOf(), depth);
  if (value instanceof BSON.Binary) return Buffer.from(value.value()).toString("base64");
  if (Array.isArray(value)) return value.map((item) => mongoSqlValue(item, depth + 1));
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mongoSqlValue(item, depth + 1)]));
  if (typeof value === "number" && !Number.isFinite(value)) throw new RpcValidationError("MongoDB SQL cannot import a non-finite number");
  if (value != null && typeof value === "object") return BSON.EJSON.serialize(value, { relaxed: false });
  return value;
}

/** Explicit JSON transformation schema preserves nested LIST/STRUCT and exact Int64 values. */
export function mongoSqlSnapshot(documents: Document[], samples: Document[], fields: string[]) {
  const observed = documents.length ? documents : samples;
  const names = [...new Set([...fields, ...observed.flatMap(Object.keys)])];
  const structure = [Object.fromEntries(names.map((name) => [name, shape(observed.map((doc) => doc[name]), 0, samples.map((doc) => doc[name]))]))];
  return { documents: documents.map((doc) => mongoSqlValue(doc)), structure, rowCount: documents.length };
}

export function mongoSqlNeedsSchemaSample(documents: Document[], fields: string[]): boolean {
  const unknown = (value: Shape): boolean => value === "JSON" || typeof value !== "string" && Object.values(value).some(unknown);
  return !documents.length || unknown(mongoSqlSnapshot(documents, [], fields).structure[0]!);
}
