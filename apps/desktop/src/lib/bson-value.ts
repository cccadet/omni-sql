/** Unwrap only canonical BSON scalar envelopes; retain malformed or ordinary documents. */
export function readableBsonValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) return value;
  const entry = Object.entries(value)[0]!;
  const [type, scalar] = entry;
  if (type === "$oid" && typeof scalar === "string" && /^[a-f\d]{24}$/i.test(scalar)) return scalar;
  if (["$numberInt", "$numberLong"].includes(type) && typeof scalar === "string" && /^-?\d+$/.test(scalar)) return scalar;
  if (["$numberDecimal", "$numberDouble"].includes(type) && typeof scalar === "string" && /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|NaN|[+-]?Infinity)$/.test(scalar)) return scalar;
  if (type === "$date") {
    let timestamp: string | number | undefined;
    if (typeof scalar === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(scalar)) timestamp = scalar;
    else if (scalar && typeof scalar === "object" && Object.keys(scalar).length === 1 && "$numberLong" in scalar && typeof scalar.$numberLong === "string" && /^-?\d+$/.test(scalar.$numberLong)) {
      const milliseconds = Number(scalar.$numberLong);
      if (Number.isSafeInteger(milliseconds)) timestamp = milliseconds;
    }
    if (timestamp !== undefined) {
      const date = new Date(timestamp);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
  }
  return value;
}
