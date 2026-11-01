// Port of modules/rtp_rtcp/source/rtcp_packet/report_block.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";

// A ReportBlock represents the Sender Report packet from
// RFC 3550 section 6.4.1.
export class ReportBlock {
  static readonly kLength = 24;

  private sourceSsrcValue = 0; // 32 bits
  private fractionLostValue = 0; // 8 bits representing a fixed point value 0..1
  private cumulativeLostValue = 0; // Signed 24-bit value
  private extendedHighSeqNumValue = 0; // 32 bits
  private jitterValue = 0; // 32 bits
  private lastSrValue = 0; // 32 bits
  private delaySinceLastSrValue = 0; // 32 bits, units of 1/65536 seconds

  // Parse assumes `buffer` holds at least `length` bytes.
  parse(buffer: Uint8Array, length = buffer.length): boolean {
    if (length < ReportBlock.kLength) {
      return false;
    }

    this.sourceSsrcValue = ByteReader.u32(buffer, 0);
    this.fractionLostValue = buffer[4];
    this.cumulativeLostValue = ByteReader.i24(buffer, 5);
    this.extendedHighSeqNumValue = ByteReader.u32(buffer, 8);
    this.jitterValue = ByteReader.u32(buffer, 12);
    this.lastSrValue = ByteReader.u32(buffer, 16);
    this.delaySinceLastSrValue = ByteReader.u32(buffer, 20);

    return true;
  }

  // Fills buffer with the ReportBlock.
  // Consumes ReportBlock::kLength bytes.
  create(buffer: Uint8Array): void {
    ByteWriter.u32(buffer, 0, this.sourceSsrc());
    ByteWriter.u8(buffer, 4, this.fractionLost());
    ByteWriter.u24(buffer, 5, this.cumulativeLost());
    ByteWriter.u32(buffer, 8, this.extendedHighSeqNum());
    ByteWriter.u32(buffer, 12, this.jitter());
    ByteWriter.u32(buffer, 16, this.lastSr());
    ByteWriter.u32(buffer, 20, this.delaySinceLastSr());
  }

  setMediaSsrc(ssrc: number): void {
    this.sourceSsrcValue = ssrc >>> 0;
  }
  setFractionLost(fractionLost: number): void {
    this.fractionLostValue = fractionLost & 0xff;
  }
  setCumulativeLost(cumulativeLost: number): boolean {
    // We have only 3 bytes to store it, and it's a signed value.
    if (cumulativeLost >= 1 << 23 || cumulativeLost < -(1 << 23)) {
      return false;
    }
    this.cumulativeLostValue = cumulativeLost;
    return true;
  }
  setExtHighestSeqNum(extHighestSeqNum: number): void {
    this.extendedHighSeqNumValue = extHighestSeqNum >>> 0;
  }
  setJitter(jitter: number): void {
    this.jitterValue = jitter >>> 0;
  }
  setLastSr(lastSr: number): void {
    this.lastSrValue = lastSr >>> 0;
  }
  setDelayLastSr(delayLastSr: number): void {
    this.delaySinceLastSrValue = delayLastSr >>> 0;
  }

  sourceSsrc(): number {
    return this.sourceSsrcValue;
  }
  fractionLost(): number {
    return this.fractionLostValue;
  }
  cumulativeLost(): number {
    return this.cumulativeLostValue;
  }
  extendedHighSeqNum(): number {
    return this.extendedHighSeqNumValue;
  }
  jitter(): number {
    return this.jitterValue;
  }
  lastSr(): number {
    return this.lastSrValue;
  }
  delaySinceLastSr(): number {
    return this.delaySinceLastSrValue;
  }

  // C++ copies report blocks by value.
  clone(): ReportBlock {
    const copy = new ReportBlock();
    Object.assign(copy, this);
    return copy;
  }
}
