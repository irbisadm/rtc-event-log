// Port of rtc_base/bitstream_reader.h @ M154.
//
// Reads bits MSB-first. A read past the end invalidates the reader
// (`ok()` turns false) and returns 0, like upstream. Only the parts used by
// the event log decoders are ported (no Exp-Golomb / non-symmetric reads).

export class BitstreamReader {
  private readonly bytes: Uint8Array;
  // Index of the byte holding the next unread bit.
  private byteIndex = 0;
  private remainingBits: number;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.remainingBits = bytes.length * 8;
  }

  ok(): boolean {
    return this.remainingBits >= 0;
  }

  invalidate(): void {
    this.remainingBits = -1;
  }

  remainingBitCount(): number {
    return this.remainingBits;
  }

  // Reads up to 32 bits as a non-negative number.
  readBitsNumber(bits: number): number {
    if (this.remainingBits < bits) {
      this.invalidate();
      return 0;
    }
    const remainingBitsInFirstByte = this.remainingBits % 8;
    this.remainingBits -= bits;
    if (bits < remainingBitsInFirstByte) {
      const offset = remainingBitsInFirstByte - bits;
      return (this.bytes[this.byteIndex] >> offset) & ((1 << bits) - 1);
    }
    let result = 0;
    if (remainingBitsInFirstByte > 0) {
      bits -= remainingBitsInFirstByte;
      const mask = (1 << remainingBitsInFirstByte) - 1;
      result = (this.bytes[this.byteIndex] & mask) * 2 ** bits;
      ++this.byteIndex;
    }
    while (bits >= 8) {
      bits -= 8;
      result += this.bytes[this.byteIndex] * 2 ** bits;
      ++this.byteIndex;
    }
    if (bits > 0) {
      result += this.bytes[this.byteIndex] >> (8 - bits);
    }
    return result;
  }

  // ReadBits(bits), 0 <= bits <= 64.
  readBits(bits: number): bigint {
    if (bits <= 32) {
      return BigInt(this.readBitsNumber(bits));
    }
    if (this.remainingBits < bits) {
      this.invalidate();
      return 0n;
    }
    const high = this.readBitsNumber(bits - 32);
    const low = this.readBitsNumber(32);
    return (BigInt(high) << 32n) | BigInt(low);
  }

  readBit(): number {
    if (this.remainingBits <= 0) {
      this.invalidate();
      return 0;
    }
    --this.remainingBits;
    const bitPosition = this.remainingBits % 8;
    if (bitPosition === 0) {
      return this.bytes[this.byteIndex++] & 0x01;
    }
    return (this.bytes[this.byteIndex] >> bitPosition) & 0x01;
  }

  // Read<bool>().
  readBool(): boolean {
    return this.readBit() !== 0;
  }

  // Read<uint8_t>().
  readUint8(): number {
    return this.readBitsNumber(8);
  }

  consumeBits(bits: number): void {
    if (this.remainingBits < bits) {
      this.invalidate();
      return;
    }
    const remainingBytes = Math.ceil(this.remainingBits / 8);
    this.remainingBits -= bits;
    const newRemainingBytes = Math.ceil(this.remainingBits / 8);
    this.byteIndex += remainingBytes - newRemainingBytes;
  }

  readLeb128(): bigint {
    let decoded = 0n;
    let i = 0;
    let byte: number;
    do {
      byte = this.readUint8();
      decoded = BigInt.asUintN(64, decoded + (BigInt(byte & 0x7f) << BigInt(7 * i)));
      ++i;
    } while (i < 10 && (byte & 0x80) !== 0);
    if (i === 10 && byte > 1) {
      this.invalidate();
    }
    return this.ok() ? decoded : 0n;
  }

  readString(numBytes: number): Uint8Array {
    const result = new Uint8Array(numBytes);
    for (let i = 0; i < numBytes; ++i) {
      result[i] = this.readUint8();
    }
    return this.ok() ? result : new Uint8Array(0);
  }
}
