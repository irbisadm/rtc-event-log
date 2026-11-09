// Port of modules/rtp_rtcp/source/ntp_time_util.h @ M154 (CompactNtpIntervalToTimeDelta).

import type {TimeDelta} from "../../../api/units/time-delta.js";

// Converts interval from compact ntp (1/2^16 seconds) resolution to TimeDelta.
// This interval can be up to ~9.1 hours (2^15 seconds).
// Values close to 2^16 seconds are considered negative and are converted to
// minimum value of 1ms.
export function compactNtpIntervalToTimeDelta(compactNtpInterval: number): TimeDelta {
  // Convert to 64bit value to avoid multiplication overflow.
  let value = BigInt(compactNtpInterval >>> 0);
  if (compactNtpInterval >>> 0 > 0x80000000) {
    value -= 1n << 32n;
  }
  // To convert to TimeDelta need to divide by 2^16 to get seconds,
  // then multiply by 1'000'000 to get microseconds. To avoid float operations,
  // multiplication and division are swapped.
  return divideRoundToNearest(value * 1000000n, 1n << 16n);
}

// rtc_base/numerics/divide_round.h
function divideRoundToNearest(dividend: bigint, divisor: bigint): number {
  if (dividend < 0n) {
    const halfOfDivisor = divisor / 2n;
    let quotient = dividend / divisor;
    const remainder = dividend % divisor;
    if (-remainder > halfOfDivisor) {
      --quotient;
    }
    return Number(quotient);
  }
  const halfOfDivisor = (divisor - 1n) / 2n;
  let quotient = dividend / divisor;
  const remainder = dividend % divisor;
  if (remainder > halfOfDivisor) {
    ++quotient;
  }
  return Number(quotient);
}
