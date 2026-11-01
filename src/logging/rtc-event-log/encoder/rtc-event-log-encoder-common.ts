// Port of logging/rtc_event_log/encoder/rtc_event_log_encoder_common.h @ M154.
//
// The C++ templates over signed integer types take the type's width here
// (`bits` = 8, 16, 32 or 64); values are `bigint`.

export type SignedWidth = 8 | 16 | 32 | 64;

// We use 0x3fff because that gives decent precision (compared to the underlying
// measurement producing the packet loss fraction) on the one hand, while
// allowing us to use no more than 2 bytes in varint form on the other hand.
const kPacketLossFractionRange = (1 << 14) - 1; // 0x3fff
const kPacketLossFractionRangeFloat = Math.fround(kPacketLossFractionRange);

// Convert between the packet fraction loss (a floating point number in
// the range [0.0, 1.0]), and a uint32_t with up to a fixed number of bits.
export function convertPacketLossFractionToProtoFormat(packetLossFraction: number): number {
  return Math.trunc(Math.fround(Math.fround(packetLossFraction) * kPacketLossFractionRange));
}

// Returns the float fraction, or undefined if the proto value is out of range.
export function parsePacketLossFractionFromProtoFormat(protoPacketLossFraction: number): number | undefined {
  if (protoPacketLossFraction >= kPacketLossFractionRange) {
    return undefined;
  }
  return Math.fround(Math.fround(protoPacketLossFraction) / kPacketLossFractionRangeFloat);
}

// Produce an unsigned representation of a signed integer `y` of width `bits`
// (two's complement of the narrow type, zero-extended to uint64).
export function toUnsigned(y: bigint, bits: SignedWidth): bigint {
  return BigInt.asUintN(bits, y);
}

// Assuming x = toUnsigned(y, bits), return `y`; undefined if `x` cannot be
// represented using a signed integer of width `bits`.
export function toSigned(x: bigint, bits: SignedWidth): bigint | undefined {
  if (x < 0n || x > (1n << BigInt(bits)) - 1n) {
    return undefined;
  }
  return BigInt.asIntN(bits, x);
}
