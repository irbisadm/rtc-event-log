// Port of api/units/data_size.h @ M154 (the parts the parser uses).
// A DataSize is bytes as a number.

export type DataSize = number;

export const DataSize = {
  bytes(bytes: number | bigint): DataSize {
    return Number(bytes);
  },
} as const;
