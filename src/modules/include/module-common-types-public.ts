// Port of modules/include/module_common_types_public.h @ M154 (IsNewer*).

function isNewer(value: number, prevValue: number, bits: 16 | 32): boolean {
  const mask = bits === 16 ? 0xffff : 0xffffffff;
  // kBreakpoint is the half-way mark for the type U. For instance, for a
  // uint16_t it will be 0x8000, and for a uint32_t, it will be 0x8000000.
  const kBreakpoint = bits === 16 ? 0x8000 : 0x80000000;
  // Distinguish between elements that are exactly kBreakpoint apart.
  // If t1>t2 and |t1-t2| = kBreakpoint: IsNewer(t1,t2)=true,
  // IsNewer(t2,t1)=false
  // rather than having IsNewer(t1,t2) = IsNewer(t2,t1) = false.
  if (value - prevValue === kBreakpoint) {
    return value > prevValue;
  }
  return value !== prevValue && ((value - prevValue) & mask) >>> 0 < kBreakpoint;
}

export function isNewerSequenceNumber(sequenceNumber: number, prevSequenceNumber: number): boolean {
  return isNewer(sequenceNumber & 0xffff, prevSequenceNumber & 0xffff, 16);
}

export function isNewerTimestamp(timestamp: number, prevTimestamp: number): boolean {
  return isNewer(timestamp >>> 0, prevTimestamp >>> 0, 32);
}
