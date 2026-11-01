// Port of logging/rtc_event_log/encoder/optional_blob_encoding.h @ M154.
//
// Encoding: one bit "all blobs present"; if not, one presence bit per blob;
// zero-padded to a byte boundary; then LEB128 length + bytes of each present
// blob. No blobs (or none present) encodes as an empty array.

import {BitstreamReader} from "../../../rtc-base/bitstream-reader.js";
import {encodeVarInt} from "./var-int.js";

export function encodeOptionalBlobs(blobs: readonly (Uint8Array | undefined)[]): Uint8Array {
  if (blobs.length === 0) {
    return new Uint8Array(0);
  }

  let numBlobsPresent = 0;
  for (const blob of blobs) {
    if (blob !== undefined) ++numBlobsPresent;
  }
  if (numBlobsPresent === 0) {
    return new Uint8Array(0);
  }

  const allBlobsPresent = numBlobsPresent === blobs.length;
  const presenceBits = allBlobsPresent ? 1 : 1 + blobs.length;
  const out: number[] = new Array(Math.ceil(presenceBits / 8)).fill(0);
  const setBit = (index: number) => {
    out[index >> 3] |= 0x80 >> (index & 7);
  };
  // Write present bits if all blobs are not present.
  if (allBlobsPresent) setBit(0);
  if (!allBlobsPresent) {
    blobs.forEach((blob, i) => {
      if (blob !== undefined) setBit(1 + i);
    });
  }
  // Write blobs (the bitmap is already byte aligned).
  for (const blob of blobs) {
    if (blob !== undefined) {
      out.push(...encodeVarInt(BigInt(blob.length)), ...blob);
    }
  }
  return Uint8Array.from(out);
}

// Returns `numOfBlobs` entries (undefined = absent), or an empty array if the
// input is malformed.
export function decodeOptionalBlobs(encodedBlobs: Uint8Array, numOfBlobs: number): (Uint8Array | undefined)[] {
  const res: (Uint8Array | undefined)[] = new Array(numOfBlobs).fill(undefined);
  if (encodedBlobs.length === 0 || numOfBlobs === 0) {
    return res;
  }

  const reader = new BitstreamReader(encodedBlobs);
  const allBlobsPresent = reader.readBit() !== 0;

  // Read present bits if all blobs are not present.
  const present: boolean[] = [];
  if (!allBlobsPresent) {
    for (let i = 0; i < numOfBlobs; ++i) {
      present.push(reader.readBit() !== 0);
    }
  }

  // Byte align the reader.
  reader.consumeBits(Math.max(reader.remainingBitCount(), 0) % 8);

  // Read the blobs.
  for (let i = 0; i < numOfBlobs; ++i) {
    if (!allBlobsPresent && !present[i]) {
      continue;
    }
    // ReadString(int): the uint64 length is narrowed to int like upstream.
    const length = Number(BigInt.asIntN(32, reader.readLeb128()));
    res[i] = reader.readString(Math.max(length, 0));
  }

  // The result is only valid if exactly all bits was consumed during decoding.
  if (!reader.ok() || reader.remainingBitCount() > 0) {
    return [];
  }

  return res;
}
