// Port of api/units/timestamp.h @ M154 (the parts the parser uses).
//
// A Timestamp is a number of microseconds; ±Infinity are the upstream
// PlusInfinity()/MinusInfinity(). Event log times (milliseconds since an
// arbitrary epoch) stay well within the exact integer range of a double.

export type Timestamp = number;

export const Timestamp = {
  micros(us: number | bigint): Timestamp {
    return Number(us);
  },
  millis(ms: number | bigint): Timestamp {
    return Number(ms) * 1000;
  },
  seconds(s: number | bigint): Timestamp {
    return Number(s) * 1_000_000;
  },
  zero(): Timestamp {
    return 0;
  },
  plusInfinity(): Timestamp {
    return Infinity;
  },
  minusInfinity(): Timestamp {
    return -Infinity;
  },
  isFinite(t: Timestamp): boolean {
    return Number.isFinite(t);
  },
  isPlusInfinity(t: Timestamp): boolean {
    return t === Infinity;
  },
  isMinusInfinity(t: Timestamp): boolean {
    return t === -Infinity;
  },
  us(t: Timestamp): number {
    return t;
  },
  // Rounds to the nearest millisecond (halves up), like DivideRoundToNearest.
  ms(t: Timestamp): number {
    return Math.round(t / 1000);
  },
  // us_or(fallback).
  usOr(t: Timestamp, fallback: number): number {
    return Number.isFinite(t) ? t : fallback;
  },
} as const;
