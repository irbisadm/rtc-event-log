// Port of api/units/data_rate.h @ M154 (the parts the parser uses).
// A DataRate is bits per second as a number.

export type DataRate = number;

export const DataRate = {
  bitsPerSec(bps: number | bigint): DataRate {
    return Number(bps);
  },
  kilobitsPerSec(kbps: number | bigint): DataRate {
    return Number(kbps) * 1000;
  },
  bps(rate: DataRate): number {
    return rate;
  },
  // Rounds to the nearest kbps (halves up), like upstream kbps().
  kbps(rate: DataRate): number {
    return Math.round(rate / 1000);
  },
} as const;
