import { useState } from "react";
import { ChevronRightRegular } from "@fluentui/react-icons";
import { readableBsonValue } from "../lib/bson-value";

const bsonTypes: Record<string, string> = {
  $oid: "ObjectId", $date: "Date", $numberInt: "Int32", $numberLong: "Int64",
  $numberDouble: "Double", $numberDecimal: "Decimal128",
};

export function DocumentValue({ name, value, expanded = false }: { name: string; value: unknown; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  const readable = readableBsonValue(value);
  if (readable !== value || value === null || typeof value !== "object") {
    const type = readable !== value ? bsonTypes[Object.keys(value as object)[0]!] : value === null ? "null" : typeof value;
    return <div className="omni-document-scalar">
      <span className="omni-document-key">{JSON.stringify(name)}</span><span>: </span>
      <span className="omni-document-value" data-type={type}>
        {typeof readable === "string" ? JSON.stringify(readable) : String(readable)}
      </span>
      <span className="omni-document-type">{type}</span>
    </div>;
  }

  const array = Array.isArray(value);
  const count = Object.keys(value).length;
  return <details className="omni-document-node" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <ChevronRightRegular className="omni-document-chevron" aria-hidden="true" />
      <span className="omni-document-key">{name}</span>
      <span className="omni-document-type">{array ? `Array [${count}]` : `Object {${count}}`}</span>
    </summary>
    {open && <div className="omni-document-children">
      {Object.entries(value).map(([key, nested]) => <DocumentValue key={key} name={key} value={nested} />)}
      {count === 0 && <div className="omni-document-scalar">{array ? "[]" : "{}"}</div>}
    </div>}
  </details>;
}
