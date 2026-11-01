// Port of logging/rtc_event_log/encoder/bit_writer.h @ M154.
//
// Writes bits MSB-first into a buffer of a fixed byte count (the upper bound
// computed by the caller); `getBytes()` returns only the bytes written.

export class BitWriter {
  private buffer: Uint8Array;
  private writtenBits = 0;
  private valid = true;

  constructor(byteCount: number) {
    this.buffer = new Uint8Array(byteCount);
  }

  // Writes the low `bitCount` bits of `val` (0 <= bitCount <= 64).
  writeBits(val: bigint, bitCount: number): void {
    if (bitCount > 32) {
      this.writeBitsNumber(Number((val >> 32n) & 0xffffffffn), bitCount - 32);
      this.writeBitsNumber(Number(val & 0xffffffffn), 32);
    } else {
      this.writeBitsNumber(Number(val & 0xffffffffn), bitCount);
    }
  }

  // Writes the low `bitCount` bits of a non-negative `val` (bitCount <= 32).
  writeBitsNumber(val: number, bitCount: number): void {
    if (!this.valid) throw new Error("BitWriter used after getBytes()");
    if (this.writtenBits + bitCount > this.buffer.length * 8) {
      throw new Error("BitWriter overflow");
    }
    let remaining = bitCount;
    while (remaining > 0) {
      const byteIndex = this.writtenBits >> 3;
      const freeInByte = 8 - (this.writtenBits & 7);
      const take = Math.min(freeInByte, remaining);
      remaining -= take;
      const chunk = Math.floor(val / 2 ** remaining) & ((1 << take) - 1);
      this.buffer[byteIndex] |= chunk << (freeInByte - take);
      this.writtenBits += take;
    }
  }

  // WriteBits(absl::string_view).
  writeBytes(input: Uint8Array): void {
    for (const byte of input) {
      this.writeBitsNumber(byte, 8);
    }
  }

  // GetString(). Nothing more may be written afterwards.
  getBytes(): Uint8Array {
    if (!this.valid) throw new Error("BitWriter used after getBytes()");
    this.valid = false;
    const result = this.buffer.slice(0, Math.ceil(this.writtenBits / 8));
    this.buffer = new Uint8Array(0);
    this.writtenBits = 0;
    return result;
  }
}
