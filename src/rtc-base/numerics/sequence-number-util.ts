// Port of rtc_base/numerics/sequence_number_util.h @ M154 (the M == 0
// variants for uint16_t and uint32_t; `bits` selects the type).

export type SeqNumBits = 16 | 32;

const modulo = (bits: SeqNumBits) => (bits === 16 ? 0x10000 : 0x100000000);

// ForwardDiff(a, b): distance from a to b going forward, mod 2^bits.
export function forwardDiff(a: number, b: number, bits: SeqNumBits): number {
  const m = modulo(bits);
  return (((b - a) % m) + m) % m;
}

export function aheadOrAt(a: number, b: number, bits: SeqNumBits): boolean {
  const maxDist = modulo(bits) / 2;
  // For uint16_t, `a - b` is computed in int (integer promotion); for
  // uint32_t it wraps.
  const diff = bits === 16 ? a - b : forwardDiff(b, a, bits);
  if (diff === maxDist) return b < a;
  return forwardDiff(b, a, bits) < maxDist;
}

export function aheadOf(a: number, b: number, bits: SeqNumBits): boolean {
  return a !== b && aheadOrAt(a, b, bits);
}
