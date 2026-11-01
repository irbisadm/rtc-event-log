// Port of rtc_base/random.h @ M154 (test-only; the parts the ported tests use).
//
// xorshift64* generator; same sequence as upstream for the same seed.

const kMask64 = (1n << 64n) - 1n;

export class Random {
  private state: bigint;

  constructor(seed: bigint | number) {
    const s = BigInt(seed);
    if (s === 0n) throw new Error("Random: seed must be non-zero");
    this.state = s & kMask64;
  }

  // Rand<uint64_t>().
  nextOutput(): bigint {
    let s = this.state;
    s ^= s >> 12n;
    s = (s ^ (s << 25n)) & kMask64;
    s ^= s >> 27n;
    this.state = s;
    return (s * 2685821657736338717n) & kMask64;
  }

  // Rand(uint32_t t): uniform in [0, t].
  rand(t: number): number {
    const x = this.nextOutput() & 0xffffffffn;
    return Number((x * (BigInt(t >>> 0) + 1n)) >> 32n);
  }

  // Rand(uint32_t low, uint32_t high).
  randRange(low: number, high: number): number {
    return this.rand(high - low) + low;
  }

  // Rand<bool>().
  randBool(): boolean {
    return this.randRange(0, 1) === 1;
  }
}
