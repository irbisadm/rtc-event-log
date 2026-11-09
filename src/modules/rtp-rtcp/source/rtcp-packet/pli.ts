// Port of modules/rtp_rtcp/source/rtcp_packet/pli.h @ M154.

import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";
import {Psfb} from "./psfb.js";

// Picture loss indication (PLI) (RFC 4585).
export class Pli extends Psfb {
  static readonly kFeedbackMessageType = 1;

  parse(packet: CommonHeader): boolean {
    if (packet.payloadSizeBytes() < Psfb.kCommonFeedbackLength) {
      return false;
    }

    this.parseCommonFeedback(packet.payload());
    return true;
  }

  blockLength(): number {
    return RtcpPacket.kHeaderLength + Psfb.kCommonFeedbackLength;
  }

  create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    while (index.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(packet, index, callback)) return false;
    }

    RtcpPacket.createHeader(Pli.kFeedbackMessageType, Psfb.kPacketType, this.headerLength(), packet, index);
    this.createCommonFeedback(packet, index.value);
    index.value += Psfb.kCommonFeedbackLength;
    return true;
  }
}
