import { assert, test } from "vitest";
import { s3Buckets } from "./s3-buckets";

test("an S3 connection without selected buckets has no discovery roots", () => {
  assert.deepEqual(s3Buckets({ endpoint: "s3://", options: { buckets: "[]" } }), []);
});
