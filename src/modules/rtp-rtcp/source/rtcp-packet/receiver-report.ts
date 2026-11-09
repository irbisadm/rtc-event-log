// Port of modules/rtp_rtcp/source/rtcp_packet/receiver_report.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";
import {ReportBlock} from "./report-block.js";

export class ReceiverReport extends RtcpPacket {
  static readonly kPacketType = 201;
  static readonly kMaxNumberOfReportBlocks = 0x1f;

  private static readonly kRrBaseLength = 4;

  private reportBlocksValue: ReportBlock[] = [];

  // Parse assumes header is already parsed and validated.
  parse(packet: CommonHeader): boolean {
    const reportBlocksCount = packet.count();
    if (packet.payloadSizeBytes() < ReceiverReport.kRrBaseLength + reportBlocksCount * ReportBlock.kLength) {
      return false;
    }

    this.setSenderSsrc(ByteReader.u32(packet.payload(), 0));

    let nextReportBlock = ReceiverReport.kRrBaseLength;

    this.reportBlocksValue = [];
    for (let i = 0; i < reportBlocksCount; ++i) {
      const block = new ReportBlock();
      block.parse(packet.payload().subarray(nextReportBlock), ReportBlock.kLength);
      this.reportBlocksValue.push(block);
      nextReportBlock += ReportBlock.kLength;
    }
    return true;
  }

  addReportBlock(block: ReportBlock): boolean {
    if (this.reportBlocksValue.length >= ReceiverReport.kMaxNumberOfReportBlocks) {
      return false;
    }
    this.reportBlocksValue.push(block.clone());
    return true;
  }

  setReportBlocks(blocks: ReportBlock[]): boolean {
    if (blocks.length > ReceiverReport.kMaxNumberOfReportBlocks) {
      return false;
    }
    this.reportBlocksValue = blocks.map((b) => b.clone());
    return true;
  }

  reportBlocks(): readonly ReportBlock[] {
    return this.reportBlocksValue;
  }

  blockLength(): number {
    return RtcpPacket.kHeaderLength + ReceiverReport.kRrBaseLength + this.reportBlocksValue.length * ReportBlock.kLength;
  }

  create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    while (index.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(packet, index, callback)) return false;
    }
    RtcpPacket.createHeader(this.reportBlocksValue.length, ReceiverReport.kPacketType, this.headerLength(), packet, index);
    ByteWriter.u32(packet, index.value, this.senderSsrc());
    index.value += ReceiverReport.kRrBaseLength;
    for (const block of this.reportBlocksValue) {
      block.create(packet.subarray(index.value));
      index.value += ReportBlock.kLength;
    }
    return true;
  }
}
