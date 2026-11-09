// Port of modules/rtp_rtcp/source/rtcp_packet/pli_unittest.cc @ M154.

import {Pli} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/pli.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const kSenderSsrc = 0x12345678;
const kRemoteSsrc = 0x23456789;
// Manually created Pli packet matching constants above.
const kPacket = Uint8Array.from([0x81, 206, 0x00, 0x02, 0x12, 0x34, 0x56, 0x78, 0x23, 0x45, 0x67, 0x89]);

describe("RtcpPacketPliTest", () => {
  test("Parse", () => {
    const mutableParsed = new Pli();
    expect(parseSinglePacket(kPacket, mutableParsed)).toBe(true);
    const parsed = mutableParsed; // Read values from constant object.

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.mediaSsrc()).toBe(kRemoteSsrc);
  });

  test("Create", () => {
    const pli = new Pli();
    pli.setSenderSsrc(kSenderSsrc);
    pli.setMediaSsrc(kRemoteSsrc);

    expect(pli.build()).toEqual(kPacket);
  });

  test("ParseFailsOnTooSmallPacket", () => {
    const kTooSmallPacket = Uint8Array.from([0x81, 206, 0x00, 0x01, 0x12, 0x34, 0x56, 0x78]);

    const parsed = new Pli();
    expect(parseSinglePacket(kTooSmallPacket, parsed)).toBe(false);
  });
});
