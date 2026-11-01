// Port of api/units/time_delta.h @ M154 (the parts the parser uses).
// A TimeDelta is microseconds as a number; ±Infinity are the infinities.

export type TimeDelta = number;

export const TimeDelta = {
  micros(us: number | bigint): TimeDelta {
    return Number(us);
  },
  millis(ms: number | bigint): TimeDelta {
    return Number(ms) * 1000;
  },
  us(delta: TimeDelta): number {
    return delta;
  },
  // Rounds to the nearest millisecond (halves up).
  ms(delta: TimeDelta): number {
    return Math.round(delta / 1000);
  },
} as const;
