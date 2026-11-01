// Port of logging/rtc_event_log/events/rtc_event_field_extraction.h @ M154.
//
// Values are uint64 `bigint`s. The C++ templates over integer types take the
// type as a `IntegerType` descriptor (width and signedness); `bool` is the
// unsigned 1-bit-ish type whose cast is `value != 0`.

import {toSigned, toUnsigned, type SignedWidth} from "../encoder/rtc-event-log-encoder-common.js";

const kUint64Max = (1n << 64n) - 1n;

// The bitwidth required to encode values in the range
// [0, `max_pos_magnitude`] using an unsigned representation.
export function unsignedBitWidth(maxMagnitude: bigint): number {
  let requiredBits = 1;
  while ((maxMagnitude >>= 1n) !== 0n) {
    ++requiredBits;
  }
  return requiredBits;
}

// The bitwidth required to encode signed values in the range
// [-`max_neg_magnitude`, `max_pos_magnitude`] using a signed
// 2-complement representation.
export function signedBitWidth(maxPosMagnitude: bigint, maxNegMagnitude: bigint): number {
  const bitwidthPositive = maxPosMagnitude > 0n ? unsignedBitWidth(maxPosMagnitude) : 0;
  const bitwidthNegative = maxNegMagnitude > 1n ? unsignedBitWidth(maxNegMagnitude - 1n) : 0;
  return 1 + Math.max(bitwidthPositive, bitwidthNegative);
}

// Return the maximum integer of a given bit width.
export function maxUnsignedValueOfBitWidth(bitWidth: number): bigint {
  return bitWidth === 64 ? kUint64Max : (1n << BigInt(bitWidth)) - 1n;
}

// Computes the delta between `previous` and `current`, under the assumption
// that `bit_mask` is the largest value before wrap-around occurs. The bitmask
// must be of the form 2^x-1.
export function unsignedDelta(previous: bigint, current: bigint, bitMask: bigint): bigint {
  return BigInt.asUintN(64, current - previous) & bitMask;
}

// An integral C++ type: bool, uintN_t or intN_t.
export type IntegerType = {kind: "bool"} | {kind: "unsigned"; bits: 8 | 16 | 32 | 64} | {kind: "signed"; bits: SignedWidth};

export const IntegerTypes = {
  bool: {kind: "bool"} as IntegerType,
  uint8: {kind: "unsigned", bits: 8} as IntegerType,
  uint16: {kind: "unsigned", bits: 16} as IntegerType,
  uint32: {kind: "unsigned", bits: 32} as IntegerType,
  uint64: {kind: "unsigned", bits: 64} as IntegerType,
  int8: {kind: "signed", bits: 8} as IntegerType,
  int16: {kind: "signed", bits: 16} as IntegerType,
  int32: {kind: "signed", bits: 32} as IntegerType,
  int64: {kind: "signed", bits: 64} as IntegerType,
};

// EncodeAsUnsigned<T>(value); `value` must be representable in `type`.
export function encodeAsUnsigned(value: bigint | boolean, type: IntegerType): bigint {
  if (type.kind === "bool") return value ? 1n : 0n;
  const v = BigInt(value);
  if (type.kind === "signed") return toUnsigned(v, type.bits);
  return BigInt.asUintN(64, v);
}

// DecodeFromUnsignedToType<T>(value). For signed types a value that does not
// fit (upstream logs an error) decodes to 0; unsigned types truncate like a
// static_cast.
export function decodeFromUnsignedToType(value: bigint, type: IntegerType): bigint {
  switch (type.kind) {
    case "bool":
      return value !== 0n ? 1n : 0n;
    case "unsigned":
      return BigInt.asUintN(type.bits, value);
    case "signed":
      return toSigned(value, type.bits) ?? 0n;
  }
}

// Represents a vector<optional<uint64_t>> optional_values
// as a bit-vector `position_mask` which identifies the positions
// of existing values, and a (potentially shorter)
// `vector<uint64_t> values` containing the actual values.
export interface ValuesWithPositions {
  positionMask: boolean[];
  values: bigint[];
}

// ExtractRtcEventMember for an optional member: the values of `optionals`
// (already in their C++ type) as ValuesWithPositions.
export function extractOptionalValues(optionals: readonly (bigint | undefined)[], type: IntegerType): ValuesWithPositions {
  const result: ValuesWithPositions = {positionMask: [], values: []};
  for (const field of optionals) {
    result.positionMask.push(field !== undefined);
    if (field !== undefined) {
      result.values.push(encodeAsUnsigned(field, type));
    }
  }
  return result;
}
