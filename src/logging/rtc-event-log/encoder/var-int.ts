// Port of logging/rtc_event_log/encoder/var_int.h @ M154.

import type {BitstreamReader} from "../../../rtc-base/bitstream-reader.js";

export const kMaxVarIntLengthBytes = 10; // ceil(64 / 7.0) is 10.

// Encodes a uint64 as LEB128 (7 bits per byte, least significant first).
export function encodeVarInt(input: bigint): Uint8Array {
  const output: number[] = [];
  let rest = BigInt.asUintN(64, input);
  do {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest > 0n) {
      byte |= 0x80;
    }
    output.push(byte);
  } while (rest > 0n);
  return Uint8Array.from(output);
}

export interface VarIntDecodeResult {
  // False if `input` holds no complete varint within kMaxVarIntLengthBytes.
  success: boolean;
  // Decoded value (0n on failure).
  value: bigint;
  // On success, the input after the varint; on failure, the whole input.
  rest: Uint8Array;
}

// DecodeVarInt(absl::string_view, uint64_t*).
export function decodeVarInt(input: Uint8Array): VarIntDecodeResult {
  let decoded = 0n;
  for (let i = 0; i < input.length && i < kMaxVarIntLengthBytes; ++i) {
    decoded = BigInt.asUintN(64, decoded + (BigInt(input[i] & 0x7f) << BigInt(7 * i)));
    if ((input[i] & 0x80) === 0) {
      return {success: true, value: decoded, rest: input.subarray(i + 1)};
    }
  }
  return {success: false, value: 0n, rest: input};
}

// DecodeVarInt(BitstreamReader&). Invalidates the reader on a varint longer
// than kMaxVarIntLengthBytes.
export function decodeVarIntFromReader(input: BitstreamReader): bigint {
  let decoded = 0n;
  for (let i = 0; i < kMaxVarIntLengthBytes; ++i) {
    const byte = input.readUint8();
    decoded = BigInt.asUintN(64, decoded + (BigInt(byte & 0x7f) << BigInt(7 * i)));
    if ((byte & 0x80) === 0) {
      return decoded;
    }
  }
  input.invalidate();
  return 0n;
}
