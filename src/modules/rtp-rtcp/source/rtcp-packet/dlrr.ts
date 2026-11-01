// Port of modules/rtp_rtcp/source/rtcp_packet/dlrr.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";

export class ReceiveTimeInfo {
  constructor(
    public ssrc = 0,
    public lastRr = 0,
    public delaySinceLastRr = 0,
  ) {}

  equals(rhs: ReceiveTimeInfo): boolean {
    return this.ssrc === rhs.ssrc && this.lastRr === rhs.lastRr && this.delaySinceLastRr === rhs.delaySinceLastRr;
  }

  clone(): ReceiveTimeInfo {
    return new ReceiveTimeInfo(this.ssrc, this.lastRr, this.delaySinceLastRr);
  }
}

// DLRR Report Block: Delay since the Last Receiver Report (RFC 3611).
export class Dlrr {
  static readonly kBlockType = 5;

  private static readonly kBlockHeaderLength = 4;
  private static readonly kSubBlockLength = 12;

  private subBlocksValue: ReceiveTimeInfo[] = [];

  // Dlrr without items treated same as no dlrr block (C++ operator bool).
  isSet(): boolean {
    return this.subBlocksValue.length !== 0;
  }

  // Second parameter is value read from block header,
  // i.e. size of block in 32bits excluding block header itself.
  parse(buffer: Uint8Array, blockLength32bits: number): boolean {
    if (blockLength32bits % 3 !== 0) {
      return false;
    }
    const blocksCount = blockLength32bits / 3;
    let readAt = Dlrr.kBlockHeaderLength;
    this.subBlocksValue = [];
    for (let i = 0; i < blocksCount; ++i) {
      this.subBlocksValue.push(
        new ReceiveTimeInfo(ByteReader.u32(buffer, readAt), ByteReader.u32(buffer, readAt + 4), ByteReader.u32(buffer, readAt + 8)),
      );
      readAt += Dlrr.kSubBlockLength;
    }
    return true;
  }

  blockLength(): number {
    if (this.subBlocksValue.length === 0) return 0;
    return Dlrr.kBlockHeaderLength + Dlrr.kSubBlockLength * this.subBlocksValue.length;
  }

  // Fills buffer with the Dlrr.
  // Consumes BlockLength() bytes.
  create(buffer: Uint8Array): void {
    if (this.subBlocksValue.length === 0) {
      // No subblocks, no need to write header either.
      return;
    }
    // Create block header.
    const kReserved = 0;
    buffer[0] = Dlrr.kBlockType;
    buffer[1] = kReserved;
    ByteWriter.u16(buffer, 2, 3 * this.subBlocksValue.length);
    // Create sub blocks.
    let writeAt = Dlrr.kBlockHeaderLength;
    for (const subBlock of this.subBlocksValue) {
      ByteWriter.u32(buffer, writeAt, subBlock.ssrc);
      ByteWriter.u32(buffer, writeAt + 4, subBlock.lastRr);
      ByteWriter.u32(buffer, writeAt + 8, subBlock.delaySinceLastRr);
      writeAt += Dlrr.kSubBlockLength;
    }
  }

  clearItems(): void {
    this.subBlocksValue = [];
  }
  addDlrrItem(timeInfo: ReceiveTimeInfo): void {
    this.subBlocksValue.push(timeInfo.clone());
  }

  subBlocks(): readonly ReceiveTimeInfo[] {
    return this.subBlocksValue;
  }
}
