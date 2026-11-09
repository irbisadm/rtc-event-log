// Port of modules/rtp_rtcp/source/rtcp_packet/extended_reports.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";
import {Dlrr, type ReceiveTimeInfo} from "./dlrr.js";
import {Rrtr} from "./rrtr.js";
import {TargetBitrate} from "./target-bitrate.js";

// From RFC 3611: RTP Control Protocol Extended Reports (RTCP XR).
export class ExtendedReports extends RtcpPacket {
  static readonly kPacketType = 207;
  static readonly kMaxNumberOfDlrrItems = 50;

  private static readonly kXrBaseLength = 4;

  private rrtrBlock: Rrtr | undefined = undefined;
  private dlrrBlock = new Dlrr(); // Dlrr without items treated same as no dlrr block.
  private targetBitrateValue: TargetBitrate | undefined = undefined;

  // Parse assumes header is already parsed and validated.
  parse(packet: CommonHeader): boolean {
    if (packet.payloadSizeBytes() < ExtendedReports.kXrBaseLength) {
      return false;
    }

    const payload = packet.payload();
    this.setSenderSsrc(ByteReader.u32(payload, 0));
    this.rrtrBlock = undefined;
    this.dlrrBlock.clearItems();
    this.targetBitrateValue = undefined;

    let currentBlock = ExtendedReports.kXrBaseLength;
    const packetEnd = packet.payloadSizeBytes();
    const kBlockHeaderSizeBytes = 4;
    while (currentBlock + kBlockHeaderSizeBytes <= packetEnd) {
      const blockType = ByteReader.u8(payload, currentBlock);
      const blockLength = ByteReader.u16(payload, currentBlock + 2);
      const nextBlock = currentBlock + kBlockHeaderSizeBytes + blockLength * 4;
      if (nextBlock > packetEnd) {
        return false;
      }

      const block = payload.subarray(currentBlock, nextBlock);
      switch (blockType) {
        case Rrtr.kBlockType:
          this.parseRrtrBlock(block, blockLength);
          break;
        case Dlrr.kBlockType:
          this.parseDlrrBlock(block, blockLength);
          break;
        case TargetBitrate.kBlockType:
          this.parseTargetBitrateBlock(block, blockLength);
          break;
        default:
          // Unknown block, ignore.
          break;
      }

      currentBlock = nextBlock;
    }

    return true;
  }

  setRrtr(rrtr: Rrtr): void {
    this.rrtrBlock = rrtr.clone();
  }
  addDlrrItem(timeInfo: ReceiveTimeInfo): boolean {
    if (this.dlrrBlock.subBlocks().length >= ExtendedReports.kMaxNumberOfDlrrItems) {
      return false;
    }
    this.dlrrBlock.addDlrrItem(timeInfo);
    return true;
  }
  setTargetBitrate(targetBitrate: TargetBitrate): void {
    this.targetBitrateValue = targetBitrate.clone();
  }

  rrtr(): Rrtr | undefined {
    return this.rrtrBlock;
  }
  dlrr(): Dlrr {
    return this.dlrrBlock;
  }
  targetBitrate(): TargetBitrate | undefined {
    return this.targetBitrateValue;
  }

  blockLength(): number {
    return (
      RtcpPacket.kHeaderLength + ExtendedReports.kXrBaseLength + this.rrtrLength() + this.dlrrLength() + this.targetBitrateLength()
    );
  }

  create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    while (index.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(packet, index, callback)) return false;
    }
    const indexEnd = index.value + this.blockLength();
    const kReserved = 0;
    RtcpPacket.createHeader(kReserved, ExtendedReports.kPacketType, this.headerLength(), packet, index);
    ByteWriter.u32(packet, index.value, this.senderSsrc());
    index.value += 4;
    if (this.rrtrBlock !== undefined) {
      this.rrtrBlock.create(packet.subarray(index.value));
      index.value += Rrtr.kLength;
    }
    if (this.dlrrBlock.isSet()) {
      this.dlrrBlock.create(packet.subarray(index.value));
      index.value += this.dlrrBlock.blockLength();
    }
    if (this.targetBitrateValue !== undefined) {
      this.targetBitrateValue.create(packet.subarray(index.value));
      index.value += this.targetBitrateValue.blockLength();
    }
    if (index.value !== indexEnd) throw new Error("RTC_CHECK_EQ(*index, index_end)");
    return true;
  }

  private rrtrLength(): number {
    return this.rrtrBlock !== undefined ? Rrtr.kLength : 0;
  }
  private dlrrLength(): number {
    return this.dlrrBlock.blockLength();
  }
  private targetBitrateLength(): number {
    return this.targetBitrateValue !== undefined ? this.targetBitrateValue.blockLength() : 0;
  }

  private parseRrtrBlock(block: Uint8Array, blockLength: number): void {
    if (blockLength !== Rrtr.kBlockLength) {
      return;
    }
    if (this.rrtrBlock !== undefined) {
      return;
    }
    this.rrtrBlock = new Rrtr();
    this.rrtrBlock.parse(block);
  }

  private parseDlrrBlock(block: Uint8Array, blockLength: number): void {
    if (this.dlrrBlock.isSet()) {
      return;
    }
    this.dlrrBlock.parse(block, blockLength);
  }

  private parseTargetBitrateBlock(block: Uint8Array, blockLength: number): void {
    this.targetBitrateValue = new TargetBitrate();
    this.targetBitrateValue.parse(block, blockLength);
  }
}
