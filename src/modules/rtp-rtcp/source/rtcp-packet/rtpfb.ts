// Port of modules/rtp_rtcp/source/rtcp_packet/rtpfb.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";
import {RtcpPacket} from "../rtcp-packet.js";

// RTPFB: Transport layer feedback message.
// RFC 4585, Section 6.2
export abstract class Rtpfb extends RtcpPacket {
  static readonly kPacketType = 205;

  protected static readonly kCommonFeedbackLength = 8;

  private mediaSsrcValue = 0;

  setMediaSsrc(ssrc: number): void {
    this.mediaSsrcValue = ssrc >>> 0;
  }
  mediaSsrc(): number {
    return this.mediaSsrcValue;
  }

  protected parseCommonFeedback(payload: Uint8Array): void {
    this.setSenderSsrc(ByteReader.u32(payload, 0));
    this.setMediaSsrc(ByteReader.u32(payload, 4));
  }

  protected createCommonFeedback(payload: Uint8Array, offset: number): void {
    ByteWriter.u32(payload, offset, this.senderSsrc());
    ByteWriter.u32(payload, offset + 4, this.mediaSsrc());
  }
}
