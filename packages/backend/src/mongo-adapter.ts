import { BSON, MongoClient, type Document, type AbstractCursor } from "mongodb";
import { CachedAdapter, type RowInsertSpec, type RowUpdateSpec } from "@omni-sql/adapters-core";
import { dialectDescriptor } from "@omni-sql/dialect-descriptors";
import type { ConnectionConfig, Relation, QueryResult, ExplainResult } from "@omni-sql/ts-types";
import { RpcDatabaseError, RpcValidationError } from "./rpc-errors.ts";
import { assertEndpointHasNoEmbeddedCredentials } from "./security-policy.ts";
import { mongoSqlNeedsSchemaSample, mongoSqlSnapshot, mongoSqlValue } from "./mongo-sql-snapshot.ts";

const OPERATIONS = ["find", "aggregate", "insertOne", "updateOne", "updateMany", "deleteOne", "deleteMany"] as const;
type Operation = typeof OPERATIONS[number];
interface MongoQuery {
  database?: string;
  collection: string;
  operation: Operation;
  filter: Document;
  projection?: Document;
  sort?: Record<string, 1 | -1>;
  pipeline?: Document[];
  document?: Document;
  update?: Document;
}

function object(value: unknown): value is Document {
  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Extended JSON preserves ObjectId, Decimal128 and dates. Never evaluate editor JavaScript. */
export function parseMongoQuery(text: string): MongoQuery {
  let query: unknown;
  try { query = BSON.EJSON.parse(text, { relaxed: false }); }
  catch { throw new RpcValidationError("MongoDB queries must be valid Extended JSON"); }
  if (!object(query) || typeof query.collection !== "string" || !query.collection.trim()
    || !OPERATIONS.includes(query.operation as Operation)
    || (query.database !== undefined && (typeof query.database !== "string" || !query.database.trim()))) {
    throw new RpcValidationError(`Specify collection and operation (${OPERATIONS.join(", ")})`);
  }
  if (Object.keys(query).some((key) => !["database", "collection", "operation", "filter", "projection", "sort", "pipeline", "document", "update"].includes(key))) {
    throw new RpcValidationError("Unsupported MongoDB query field; use the row limit control to bound results");
  }
  for (const field of ["filter", "projection", "sort", "document", "update"]) {
    if (query[field] !== undefined && !object(query[field])) throw new RpcValidationError(`MongoDB ${field} must be an object`);
  }
  let sort: Record<string, 1 | -1> | undefined;
  if (query.sort !== undefined) {
    sort = Object.create(null) as Record<string, 1 | -1>;
    for (const [field, value] of Object.entries(query.sort)) {
      if (typeof value !== "number" && !(value instanceof BSON.Int32) && !(value instanceof BSON.Long) && !(value instanceof BSON.Double)) throw new RpcValidationError("MongoDB sort directions must be numeric");
      const direction = Number(value);
      if (direction !== 1 && direction !== -1) throw new RpcValidationError("MongoDB sort directions must be 1 or -1");
      sort[field] = direction;
    }
  }
  if (query.operation === "aggregate" && (!Array.isArray(query.pipeline) || !query.pipeline.every(object))) {
    throw new RpcValidationError("MongoDB aggregate requires an array of pipeline stages");
  }
  // Keep aggregation read-only; mutations use explicit native operations and their confirmations.
  if (Array.isArray(query.pipeline) && query.pipeline.some((stage: Document) => "$out" in stage || "$merge" in stage)) {
    throw new RpcValidationError("MongoDB aggregation stages $out and $merge are not supported");
  }
  if (query.operation === "insertOne" && !object(query.document)) throw new RpcValidationError("insertOne requires document");
  if (String(query.operation).startsWith("update") && !object(query.update)) throw new RpcValidationError("update requires update");
  return { ...query, filter: query.filter ?? {}, sort } as MongoQuery;
}

function safeMongoError(error: unknown): RpcDatabaseError | RpcValidationError {
  if (error instanceof RpcValidationError || error instanceof RpcDatabaseError) return error;
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
  const messages: Record<string, string> = {
    "18": "MongoDB authentication failed. Check user, password and authSource.",
    "13": "MongoDB permission denied. Check database permissions.",
    "11000": "MongoDB duplicate key. Check _id and unique indexes.",
    "50": "MongoDB query timed out.",
    "14": "MongoDB field type mismatch.",
  };
  const name = error instanceof Error ? error.name : "";
  return new RpcDatabaseError(messages[String(code)] ?? (name === "MongoServerSelectionError"
    ? "MongoDB server unavailable. Check URI, TLS and network access."
    : "MongoDB operation failed. Check the query and connection settings."));
}

function mongoValueType(value: unknown): string {
  if (value instanceof BSON.ObjectId) return "OBJECTID";
  if (value instanceof Date) return "TIMESTAMP";
  if (value instanceof BSON.Timestamp) return "JSON";
  if (value instanceof BSON.Long || typeof value === "bigint") return "BIGINT";
  if (value instanceof BSON.Int32) return "INTEGER";
  if (value instanceof BSON.Double) return "DOUBLE";
  if (value instanceof BSON.Decimal128) return "DECIMAL128";
  if (value instanceof BSON.Binary || value instanceof Uint8Array) return "BINARY";
  if (typeof value === "string") return "VARCHAR";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return Number.isSafeInteger(value) ? value >= -2147483648 && value <= 2147483647 ? "INTEGER" : "BIGINT" : "DOUBLE";
  return "JSON";
}

function mongoValuesType(values: unknown[], depth = 0): string {
  const present = values.filter((value) => value != null);
  if (!present.length || depth >= 16) return "JSON";
  if (present.every(Array.isArray)) return `${mongoValuesType(present.flat(), depth + 1)}[]`;
  const types = new Set(present.map(mongoValueType));
  if (types.size === 1) return [...types][0]!;
  if ([...types].every((type) => ["INTEGER", "BIGINT", "DOUBLE", "DECIMAL128"].includes(type))) return "NUMERIC";
  return "JSON";
}

function mongoColumns(documents: Document[], names: string[]) {
  return names.map((name) => {
    const values = documents.map((doc) => Object.hasOwn(doc, name) ? doc[name] : null);
    return { name, dataType: mongoValuesType(values), nullable: values.some((value) => value == null) };
  });
}

export function mongoResult(documents: Document[], limit: number, elapsedMs: number): QueryResult {
  const preview = documents.slice(0, limit);
  const names = [...new Set(preview.flatMap((doc) => Object.keys(doc)))];
  return {
    columns: mongoColumns(preview, names),
    rows: preview.map((doc) => {
      const json = BSON.EJSON.serialize(doc, { relaxed: false }) as Document;
      return names.map((name) => Object.hasOwn(json, name) ? json[name] : null);
    }),
    rowsMoreAvailable: documents.length > limit,
    elapsedMs,
  };
}

export class MongoAdapter extends CachedAdapter {
  readonly dialect = "mongodb" as const;
  private readonly client: MongoClient;
  private readonly database: string;
  private connected = false;
  private readonly explicitDatabase: boolean;
  private cursor: AbstractCursor | null = null;
  private abort: AbortController | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config);
    assertEndpointHasNoEmbeddedCredentials(config);
    if (password && !config.user) throw new RpcValidationError("MongoDB user is required with a password");
    try { this.client = new MongoClient(config.endpoint, {
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
      ...(config.user ? { auth: { username: config.user, password: password ?? "" } } : {}),
    }); } catch { throw new RpcValidationError("Invalid MongoDB URI or connection options"); }
    this.database = this.client.db().databaseName;
    this.explicitDatabase = /^mongodb(?:\+srv)?:\/\/[^/]+\/[^?]+/.test(config.endpoint);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try { await this.client.connect(); this.connected = true; }
    catch (error) { throw safeMongoError(error); }
  }
  async close(): Promise<void> { await this.cancelRunning(); await this.client.close(); this.connected = false; }
  async test() {
    const started = Date.now();
    await this.connect();
    try { await this.client.db(this.database).command({ ping: 1 }); }
    catch (error) { throw safeMongoError(error); }
    return { ok: true, latencyMs: Date.now() - started };
  }
  protected databaseName(): string { return this.database; }
  async listAvailableSchemas(): Promise<readonly string[]> {
    await this.connect();
    // A URI with a database works for users without cluster-wide listDatabases permission.
    if (this.explicitDatabase) return [this.database];
    try { return (await this.client.db().admin().listDatabases({ authorizedDatabases: true })).databases.map((db) => db.name); }
    catch (error) { throw safeMongoError(error); }
  }
  protected async introspectSchemas(): Promise<readonly (readonly [unknown, string, readonly Relation[]])[]> {
    await this.connect();
    const databases = this.schemaFilter?.length ? this.schemaFilter : await this.listAvailableSchemas();
    const result: [unknown, string, Relation[]][] = [];
    try {
      for (const database of databases) {
        const db = this.client.db(database);
        const collections = await db.listCollections({}, { nameOnly: true }).toArray();
        const relations: Relation[] = [];
        for (const collection of collections) {
          const fields = new Set(["_id"]);
          const samples: Document[] = [];
          const cursor = db.collection(collection.name).find({}, { maxTimeMS: 10_000 }).limit(100);
          try { for await (const document of cursor) { samples.push(document); for (const name of Object.keys(document)) fields.add(name); } }
          finally { await cursor.close(); }
          relations.push({ schema: database, name: collection.name, kind: collection.type === "view" ? "view" : "table",
            constraints: [], columns: mongoColumns(samples, [...fields]).map((column, ordinalPosition) => ({ ...column, isPrimaryKey: column.name === "_id", ordinalPosition })) });
        }
        result.push([null, database, relations]);
      }
      return result;
    } catch (error) { throw safeMongoError(error); }
  }
  protected async listFunctionsForSchema() { return []; }
  dialectDescriptor() { return dialectDescriptor("mongodb"); }
  async listIndexes(schema: string, table: string) {
    try {
      return (await this.client.db(schema).collection(table).listIndexes().toArray()).map((index) => ({
        name: String(index.name), unique: index.unique === true || index.name === "_id_", primary: index.name === "_id_", columns: Object.keys(index.key),
      }));
    } catch (error) { throw safeMongoError(error); }
  }
  async getDefinition(): Promise<string> { throw new RpcValidationError("MongoDB collections have no SQL definition"); }
  async updateRow(_spec: RowUpdateSpec): Promise<number> { throw new RpcValidationError("Use a native MongoDB update operation"); }
  async insertRow(_spec: RowInsertSpec): Promise<number> { throw new RpcValidationError("Use a native MongoDB insertOne operation"); }
  async cancelRunning(): Promise<void> { this.abort?.abort(); await this.cursor?.close(); }
  async readSqlSource(text: string, fields: string[]) {
    const query = parseMongoQuery(text);
    if (query.operation !== "find" || query.sort) throw new RpcValidationError("MongoDB SQL source requires an unsorted find");
    const collection = this.client.db(query.database ?? this.database).collection(query.collection);
    const abort = this.abort = new AbortController();
    const options = { signal: abort.signal, maxTimeMS: 60_000, projection: query.projection, promoteLongs: false };
    const cursor = this.cursor = collection.find(query.filter, options).limit(100_001);
    try {
      const documents: Document[] = [];
      let bytes = 0;
      for await (const document of cursor) {
        bytes += Buffer.byteLength(JSON.stringify(mongoSqlValue(document)));
        if (documents.length === 100_000 || bytes > 16 * 1024 * 1024) {
          throw new RpcValidationError("MongoDB SQL filtered source exceeds 100,000 documents or 16 MiB; narrow the WHERE or select fewer fields. No partial result was returned.");
        }
        documents.push(document);
      }
      abort.signal.throwIfAborted();
      const samples: Document[] = [];
      if (mongoSqlNeedsSchemaSample(documents, fields)) {
        this.cursor = collection.find({}, options).limit(100);
        for await (const document of this.cursor) {
          bytes += Buffer.byteLength(JSON.stringify(mongoSqlValue(document)));
          if (bytes > 16 * 1024 * 1024) throw new RpcValidationError("MongoDB SQL schema sample exceeds 16 MiB");
          samples.push(document);
        }
      }
      abort.signal.throwIfAborted();
      return mongoSqlSnapshot(documents, samples, fields);
    } catch (error) { throw safeMongoError(error); }
    finally { await cursor.close(); await this.cursor?.close(); this.cursor = null; this.abort = null; }
  }
  async runQuery(text: string, limit: number): Promise<QueryResult> {
    const query = parseMongoQuery(text);
    const started = Date.now();
    const collection = this.client.db(query.database ?? this.database).collection(query.collection);
    this.abort = new AbortController();
    const options = { signal: this.abort.signal, maxTimeMS: 60_000 };
    try {
      let documents: Document[];
      let rowsAffected: number | undefined;
      if (query.operation === "find" || query.operation === "aggregate") {
        this.cursor = query.operation === "find"
          ? collection.find(query.filter, { ...options, projection: query.projection, sort: query.sort }).limit(limit + 1)
          : collection.aggregate([...query.pipeline!, { $limit: limit + 1 }], options);
        documents = [];
        let bytes = 0;
        for await (const document of this.cursor) {
          bytes += Buffer.byteLength(BSON.EJSON.stringify(document));
          if (bytes > 16 * 1024 * 1024) throw new RpcValidationError("MongoDB result exceeds 16 MiB; use projection or a smaller limit");
          documents.push(document);
        }
      } else if (query.operation === "insertOne") {
        const result = await collection.insertOne(query.document!, options);
        documents = [{ insertedId: result.insertedId }]; rowsAffected = 1;
      } else if (query.operation === "updateOne" || query.operation === "updateMany") {
        const result = await collection[query.operation](query.filter, query.update!, options);
        documents = [{ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }]; rowsAffected = result.modifiedCount;
      } else {
        const result = await collection[query.operation](query.filter, options);
        documents = [{ deletedCount: result.deletedCount }]; rowsAffected = result.deletedCount;
      }
      return { ...mongoResult(documents, limit, Date.now() - started), ...(rowsAffected === undefined ? {} : { rowsAffected }) };
    } catch (error) { throw safeMongoError(error); }
    finally { await this.cursor?.close(); this.cursor = null; this.abort = null; }
  }
  async explain(text: string): Promise<ExplainResult> {
    const query = parseMongoQuery(text);
    if (query.operation !== "find" && query.operation !== "aggregate") throw new RpcValidationError("Explain requires find or aggregate");
    const collection = this.client.db(query.database ?? this.database).collection(query.collection);
    try {
      const cursor = query.operation === "find" ? collection.find(query.filter, { projection: query.projection, sort: query.sort, maxTimeMS: 60_000 })
        : collection.aggregate(query.pipeline!, { maxTimeMS: 60_000 });
      try {
        const raw = BSON.EJSON.serialize(await cursor.explain("queryPlanner"));
        return { textual: JSON.stringify(raw, null, 2), format: "json", raw };
      } finally { await cursor.close(); }
    } catch (error) { throw safeMongoError(error); }
  }
}
