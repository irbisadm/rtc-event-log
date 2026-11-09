// Port of modules/rtp_rtcp/source/rtcp_packet/bye.h @ M154.
//
// The reason is a byte string in C++; here a string with one char per byte
// (latin1), so arbitrary bytes round-trip.

import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";

export class Bye extends RtcpPacket {
  static readonly kPacketType = 203;

  private static readonly kMaxNumberOfCsrcs = 0x1f - 1; // First item is sender SSRC.

  private csrcsValue: number[] = [];
  private reasonValue = "";

  // Parse assumes header is already parsed and validated.
  parse(packet: CommonHeader): boolean {
    const srcCount = packet.count();
    // Validate packet.
    if (packet.payloadSizeBytes() < 4 * srcCount) {
      return false;
    }
    const payload = packet.payload();
    const hasReason = packet.payloadSizeBytes() > 4 * srcCount;
    let reasonLength = 0;
    if (hasReason) {
      reasonLength = payload[4 * srcCount];
      if (packet.payloadSizeBytes() - 4 * srcCount < 1 + reasonLength) {
        return false;
      }
    }
    // Once sure packet is valid, copy values.
    if (srcCount === 0) {
      // A count value of zero is valid, but useless.
      this.setSenderSsrc(0);
      this.csrcsValue = [];
    } else {
      this.setSenderSsrc(ByteReader.u32(payload, 0));
      this.csrcsValue = [];
      for (let i = 1; i < srcCount; ++i) this.csrcsValue.push(ByteReader.u32(payload, 4 * i));
    }

    if (hasReason) {
      const start = 4 * srcCount + 1;
      this.reasonValue = String.fromCharCode(...payload.subarray(start, start + reasonLength));
    } else {
      this.reasonValue = "";
    }

    return true;
  }

  setCsrcs(csrcs: number[]): boolean {
    if (csrcs.length > Bye.kMaxNumberOfCsrcs) {
      return false;
    }
    this.csrcsValue = csrcs.map((c) => c >>> 0);
    return true;
  }

  // Bytes of the reason: char codes are taken modulo 256.
  setReason(reason: string): void {
    this.reasonValue = reason;
  }

  csrcs(): readonly number[] {
    return this.csrcsValue;
  }
  reason(): string {
    return this.reasonValue;
  }

  blockLength(): number {
    const srcCount = 1 + this.csrcsValue.length;
    const reasonSizeIn32bits = this.reasonValue.length === 0 ? 0 : Math.floor(this.reasonValue.length / 4) + 1;
    return RtcpPacket.kHeaderLength + 4 * (srcCount + reasonSizeIn32bits);
  }

  create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    while (index.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(packet, index, callback)) return false;
    }
    const indexEnd = index.value + this.blockLength();

    RtcpPacket.createHeader(1 + this.csrcsValue.length, Bye.kPacketType, this.headerLength(), packet, index);
    // Store srcs of the leaving clients.
    ByteWriter.u32(packet, index.value, this.senderSsrc());
    index.value += 4;
    for (const csrc of this.csrcsValue) {
      ByteWriter.u32(packet, index.value, csrc);
      index.value += 4;
    }
    // Store the reason to leave.
    if (this.reasonValue.length !== 0) {
      const reasonLength = this.reasonValue.length & 0xff;
      packet[index.value++] = reasonLength;
      for (let i = 0; i < reasonLength; ++i) packet[index.value + i] = this.reasonValue.charCodeAt(i) & 0xff;
      index.value += reasonLength;
      // Add padding bytes if needed.
      const bytesToPad = indexEnd - index.value;
      if (bytesToPad > 0) {
        packet.fill(0, index.value, index.value + bytesToPad);
        index.value += bytesToPad;
      }
    }

    return true;
  }
}
