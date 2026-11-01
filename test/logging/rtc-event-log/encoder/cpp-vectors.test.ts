// Bit-exactness against the upstream C++ encoders: cpp-vectors.json is written
// by tools/cpp-vectors (EncodeDeltas / EncodeBlobs built from cpp/).

import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {decodeBlobs, encodeBlobs} from "../../../../src/logging/rtc-event-log/encoder/blob-encoding.js";
import {
  decodeDeltas,
  encodeDeltas,
  type OptionalU64,
  setFixedLengthEncoderDeltaSignednessForTesting,
  unsetFixedLengthEncoderDeltaSignednessForTesting,
} from "../../../../src/logging/rtc-event-log/encoder/delta-encoding.js";

interface DeltaVector {
  override: "none" | "unsigned" | "signed";
  base: string | null;
  values: (string | null)[];
  encoded: string;
}

interface BlobVector {
  blobs: string[];
  encoded: string;
}

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cpp-vectors.json"), "utf8"),
) as {delta: DeltaVector[]; blobs: BlobVector[]};

const optional = (v: string | null): OptionalU64 => (v === null ? undefined : BigInt(v));
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const fromHex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "hex"));

afterAll(() => {
  unsetFixedLengthEncoderDeltaSignednessForTesting();
});

describe("EncodeDeltas matches upstream C++", () => {
  test.each(vectors.delta.map((v, i) => [i, v] as const))("vector %i", (_i, v) => {
    if (v.override === "none") {
      unsetFixedLengthEncoderDeltaSignednessForTesting();
    } else {
      setFixedLengthEncoderDeltaSignednessForTesting(v.override === "signed");
    }
    const base = optional(v.base);
    const values = v.values.map(optional);
    expect(hex(encodeDeltas(base, values))).toBe(v.encoded);
    expect(decodeDeltas(fromHex(v.encoded), base, values.length)).toEqual(values);
  });
});

describe("EncodeBlobs matches upstream C++", () => {
  test.each(vectors.blobs.map((v, i) => [i, v] as const))("vector %i", (_i, v) => {
    const blobs = v.blobs.map(fromHex);
    expect(hex(encodeBlobs(blobs))).toBe(v.encoded);
    expect(decodeBlobs(fromHex(v.encoded), blobs.length).map(hex)).toEqual(v.blobs);
  });
});
