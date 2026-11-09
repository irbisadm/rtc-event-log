// Port of rtc_base/numerics/sequence_number_unwrapper.h @ M154.

import {aheadOrAt, forwardDiff, type SeqNumBits} from "./sequence-number-util.js";

// A sequence number unwrapper where the first unwrapped value equals the
// first value being unwrapped.
export class SeqNumUnwrapper {
  private lastUnwrapped = 0;
  private lastValue: number | undefined = undefined;

  constructor(private readonly bits: SeqNumBits) {}

  unwrap(value: number): number {
    if (this.lastValue === undefined) {
      this.lastUnwrapped = value;
    } else {
      this.lastUnwrapped += this.delta(this.lastValue, value);
    }
    this.lastValue = value;
    return this.lastUnwrapped;
  }

  peekUnwrap(value: number): number {
    if (this.lastValue === undefined) {
      return value;
    }
    return this.lastUnwrapped + this.delta(this.lastValue, value);
  }

  reset(): void {
    this.lastUnwrapped = 0;
    this.lastValue = undefined;
  }

  private delta(lastValue: number, newValue: number): number {
    const kBackwardAdjustment = this.bits === 16 ? 0x10000 : 0x100000000;
    let result = forwardDiff(lastValue, newValue, this.bits);
    if (!aheadOrAt(newValue, lastValue, this.bits)) {
      result -= kBackwardAdjustment;
    }
    return result;
  }
}

export class RtpSequenceNumberUnwrapper extends SeqNumUnwrapper {
  constructor() {
    super(16);
  }
}

export class RtpTimestampUnwrapper extends SeqNumUnwrapper {
  constructor() {
    super(32);
  }
}
