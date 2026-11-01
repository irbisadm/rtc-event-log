// Port of system_wrappers/include/ntp_time.h @ M154 (NtpTime).

export class NtpTime {
  static readonly kFractionsPerSecond = 0x100000000n;

  private value: bigint;

  // NtpTime(), NtpTime(uint64_t value) or NtpTime(seconds, fractions).
  constructor(valueOrSeconds: bigint | number = 0n, fractions?: number) {
    this.value =
      fractions === undefined
        ? BigInt.asUintN(64, BigInt(valueOrSeconds))
        : BigInt(Number(valueOrSeconds) >>> 0) * NtpTime.kFractionsPerSecond + BigInt(fractions >>> 0);
  }

  // explicit operator uint64_t()
  toBigInt(): bigint {
    return this.value;
  }

  set(seconds: number, fractions: number): void {
    this.value = BigInt(seconds >>> 0) * NtpTime.kFractionsPerSecond + BigInt(fractions >>> 0);
  }

  reset(): void {
    this.value = 0n;
  }

  toMs(): number {
    const kNtpFracPerMs = 4.294967296e6; // 2^32 / 1000.
    const fracMs = this.fractions() / kNtpFracPerMs;
    return 1000 * this.seconds() + Math.trunc(fracMs + 0.5);
  }

  valid(): boolean {
    return this.value !== 0n;
  }

  seconds(): number {
    return Number(this.value / NtpTime.kFractionsPerSecond);
  }

  fractions(): number {
    return Number(this.value % NtpTime.kFractionsPerSecond);
  }

  equals(other: NtpTime): boolean {
    return this.value === other.value;
  }

  clone(): NtpTime {
    return new NtpTime(this.value);
  }
}
