// Port of modules/rtp_rtcp/source/rtcp_packet/fir.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";
import {Psfb} from "./psfb.js";

export class FirRequest {
  constructor(
    public ssrc = 0,
    public seqNr = 0,
  ) {}
}

// Full intra request (FIR) (RFC 5104). The media SSRC of the common feedback
// is unused (zero).
export class Fir extends Psfb {
  static readonly kFeedbackMessageType = 4;

  private static readonly kFciLength = 8;

  private items: FirRequest[] = [];

  // Parse assumes header is already parsed and validated.
  parse(packet: CommonHeader): boolean {
    // The FCI field MUST contain one or more FIR entries.
    if (packet.payloadSizeBytes() < Psfb.kCommonFeedbackLength + Fir.kFciLength) {
      return false;
    }

    if ((packet.payloadSizeBytes() - Psfb.kCommonFeedbackLength) % Fir.kFciLength !== 0) {
      return false;
    }

    this.parseCommonFeedback(packet.payload());

    const numberOfFciItems = (packet.payloadSizeBytes() - Psfb.kCommonFeedbackLength) / Fir.kFciLength;
    let nextFci = Psfb.kCommonFeedbackLength;
    this.items = [];
    for (let i = 0; i < numberOfFciItems; ++i) {
      this.items.push(new FirRequest(ByteReader.u32(packet.payload(), nextFci), ByteReader.u8(packet.payload(), nextFci + 4)));
      nextFci += Fir.kFciLength;
    }
    return true;
  }

  addRequestTo(ssrc: number, seqNum: number): void {
    this.items.push(new FirRequest(ssrc >>> 0, seqNum & 0xff));
  }

  requests(): readonly FirRequest[] {
    return this.items;
  }

  blockLength(): number {
    return RtcpPacket.kHeaderLength + Psfb.kCommonFeedbackLength + Fir.kFciLength * this.items.length;
  }

  create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    while (index.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(packet, index, callback)) return false;
    }
    const indexEnd = index.value + this.blockLength();
    RtcpPacket.createHeader(Fir.kFeedbackMessageType, Psfb.kPacketType, this.headerLength(), packet, index);
    this.createCommonFeedback(packet, index.value);
    index.value += Psfb.kCommonFeedbackLength;

    const kReserved = 0;
    for (const request of this.items) {
      ByteWriter.u32(packet, index.value, request.ssrc);
      ByteWriter.u8(packet, index.value + 4, request.seqNr);
      ByteWriter.u24(packet, index.value + 5, kReserved);
      index.value += Fir.kFciLength;
    }
    if (index.value !== indexEnd) throw new Error("RTC_CHECK_EQ(*index, index_end)");
    return true;
  }
}
