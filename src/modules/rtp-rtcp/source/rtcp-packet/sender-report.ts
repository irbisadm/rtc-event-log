// Port of modules/rtp_rtcp/source/rtcp_packet/sender_report.h @ M154.

import {NtpTime} from "../../../../system-wrappers/include/ntp-time.js";
import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";
import {ReportBlock} from "./report-block.js";

export class SenderReport extends RtcpPacket {
  static readonly kPacketType = 200;
  static readonly kMaxNumberOfReportBlocks = 0x1f;

  private static readonly kSenderBaseLength = 24;

  private ntpValue = new NtpTime();
  private rtpTimestampValue = 0;
  private senderPacketCountValue = 0;
  private senderOctetCountValue = 0;
  private reportBlocksValue: ReportBlock[] = [];

  // Parse assumes header is already parsed and validated.
  parse(packet: CommonHeader): boolean {
    const reportBlockCount = packet.count();
    if (packet.payloadSizeBytes() < SenderReport.kSenderBaseLength + reportBlockCount * ReportBlock.kLength) {
      return false;
    }
    // Read SenderReport header.
    const payload = packet.payload();
    this.setSenderSsrc(ByteReader.u32(payload, 0));
    const secs = ByteReader.u32(payload, 4);
    const frac = ByteReader.u32(payload, 8);
    this.ntpValue.set(secs, frac);
    this.rtpTimestampValue = ByteReader.u32(payload, 12);
    this.senderPacketCountValue = ByteReader.u32(payload, 16);
    this.senderOctetCountValue = ByteReader.u32(payload, 20);
    this.reportBlocksValue = [];
    let nextBlock = SenderReport.kSenderBaseLength;
    for (let i = 0; i < reportBlockCount; ++i) {
      const block = new ReportBlock();
      block.parse(payload.subarray(nextBlock), ReportBlock.kLength);
      this.reportBlocksValue.push(block);
      nextBlock += ReportBlock.kLength;
    }
    return true;
  }

  setNtp(ntp: NtpTime): void {
    this.ntpValue = ntp.clone();
  }
  setRtpTimestamp(rtpTimestamp: number): void {
    this.rtpTimestampValue = rtpTimestamp >>> 0;
  }
  setPacketCount(packetCount: number): void {
    this.senderPacketCountValue = packetCount >>> 0;
  }
  setOctetCount(octetCount: number): void {
    this.senderOctetCountValue = octetCount >>> 0;
  }

  addReportBlock(block: ReportBlock): boolean {
    if (this.reportBlocksValue.length >= SenderReport.kMaxNumberOfReportBlocks) {
      return false;
    }
    this.reportBlocksValue.push(block.clone());
    return true;
  }
  setReportBlocks(blocks: ReportBlock[]): boolean {
    if (blocks.length > SenderReport.kMaxNumberOfReportBlocks) {
      return false;
    }
    this.reportBlocksValue = blocks.map((b) => b.clone());
    return true;
  }
  clearReportBlocks(): void {
    this.reportBlocksValue = [];
  }

  ntp(): NtpTime {
    return this.ntpValue;
  }
  rtpTimestamp(): number {
    return this.rtpTimestampValue;
  }
  senderPacketCount(): number {
    return this.senderPacketCountValue;
  }
  senderOctetCount(): number {
    return this.senderOctetCountValue;
  }

  reportBlocks(): readonly ReportBlock[] {
    return this.reportBlocksValue;
  }

  blockLength(): number {
    return RtcpPacket.kHeaderLength + SenderReport.kSenderBaseLength + this.reportBlocksValue.length * ReportBlock.kLength;
  }

  create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    while (index.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(packet, index, callback)) return false;
    }
    RtcpPacket.createHeader(this.reportBlocksValue.length, SenderReport.kPacketType, this.headerLength(), packet, index);
    // Write SenderReport header.
    ByteWriter.u32(packet, index.value + 0, this.senderSsrc());
    ByteWriter.u32(packet, index.value + 4, this.ntpValue.seconds());
    ByteWriter.u32(packet, index.value + 8, this.ntpValue.fractions());
    ByteWriter.u32(packet, index.value + 12, this.rtpTimestampValue);
    ByteWriter.u32(packet, index.value + 16, this.senderPacketCountValue);
    ByteWriter.u32(packet, index.value + 20, this.senderOctetCountValue);
    index.value += SenderReport.kSenderBaseLength;
    // Write report blocks.
    for (const block of this.reportBlocksValue) {
      block.create(packet.subarray(index.value));
      index.value += ReportBlock.kLength;
    }
    return true;
  }
}
