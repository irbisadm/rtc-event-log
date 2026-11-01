// Port of logging/rtc_event_log/encoder/blob_encoding.h @ M154.
//
// Encoding: the varint lengths of all blobs, followed by the blobs themselves.

import {decodeVarInt, encodeVarInt} from "./var-int.js";

export function encodeBlobs(blobs: readonly Uint8Array[]): Uint8Array {
  if (blobs.length === 0) throw new Error("encodeBlobs: no blobs");
  const lengths = blobs.map((blob) => encodeVarInt(BigInt(blob.length)));
  let total = 0;
  for (const part of lengths) total += part.length;
  for (const blob of blobs) total += blob.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of [...lengths, ...blobs]) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// Returns views into `encodedBlobs`, or an empty array if the input is
// malformed (including leftover bytes after the last blob).
export function decodeBlobs(encodedBlobs: Uint8Array, numOfBlobs: number): Uint8Array[] {
  if (encodedBlobs.length === 0) {
    return [];
  }
  if (numOfBlobs === 0) {
    return [];
  }

  let rest = encodedBlobs;
  const lengths: bigint[] = new Array(numOfBlobs);
  for (let i = 0; i < numOfBlobs; ++i) {
    const decoded = decodeVarInt(rest);
    if (!decoded.success) {
      return [];
    }
    lengths[i] = decoded.value;
    rest = decoded.rest;
  }

  const blobs: Uint8Array[] = new Array(numOfBlobs);
  for (let i = 0; i < numOfBlobs; ++i) {
    if (lengths[i] > BigInt(rest.length)) {
      return [];
    }
    const length = Number(lengths[i]);
    blobs[i] = rest.subarray(0, length);
    rest = rest.subarray(length);
  }

  if (rest.length !== 0) {
    return [];
  }
  return blobs;
}
