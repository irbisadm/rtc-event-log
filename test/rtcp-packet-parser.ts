// Port of test/rtcp_packet_parser.h @ M154 (ParseSinglePacket; RtcpPacketParser
// grows with the ported packet types).

import {CommonHeader} from "../src/modules/rtp-rtcp/source/rtcp-packet/common-header.js";

export interface ParsablePacket {
  parse(header: CommonHeader): boolean;
}

export function parseSinglePacket(buffer: Uint8Array, packet: ParsablePacket): boolean {
  const header = new CommonHeader();
  if (!header.parse(buffer)) throw new Error("RTC_CHECK(header.Parse(buffer, size))");
  if (buffer.length !== header.nextPacketOffset()) throw new Error("RTC_CHECK_EQ(size, header.NextPacket() - buffer)");
  return packet.parse(header);
}
