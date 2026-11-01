// Port of modules/rtp_rtcp/source/rtcp_packet/fir_unittest.cc @ M154.

import {Fir} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/fir.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const kSenderSsrc = 0x12345678;
const kRemoteSsrc = 0x23456789;
const kSeqNr = 13;
// Manually created Fir packet matching constants above.
const kPacket = Uint8Array.from([
  0x84, 206, 0x00, 0x04, 0x12, 0x34, 0x56, 0x78, 0x00, 0x00, 0x00, 0x00, 0x23, 0x45, 0x67, 0x89, 0x0d, 0x00, 0x00, 0x00,
]);
const c = (ch: string) => ch.charCodeAt(0);

describe("RtcpPacketFirTest", () => {
  test("Parse", () => {
    const mutableParsed = new Fir();
    expect(parseSinglePacket(kPacket, mutableParsed)).toBe(true);
    const parsed = mutableParsed; // Read values from constant object.

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.requests().map((r) => [r.ssrc, r.seqNr])).toEqual([[kRemoteSsrc, kSeqNr]]);
  });

  test("Create", () => {
    const fir = new Fir();
    fir.setSenderSsrc(kSenderSsrc);
    fir.addRequestTo(kRemoteSsrc, kSeqNr);

    expect(fir.build()).toEqual(kPacket);
  });

  test("TwoFciEntries", () => {
    const fir = new Fir();
    fir.setSenderSsrc(kSenderSsrc);
    fir.addRequestTo(kRemoteSsrc, kSeqNr);
    fir.addRequestTo(kRemoteSsrc + 1, kSeqNr + 1);

    const packet = fir.build();
    const parsed = new Fir();
    expect(parseSinglePacket(packet, parsed)).toBe(true);

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.requests().map((r) => [r.ssrc, r.seqNr])).toEqual([
      [kRemoteSsrc, kSeqNr],
      [kRemoteSsrc + 1, kSeqNr + 1],
    ]);
  });

  test("ParseFailsOnZeroFciEntries", () => {
    const kPacketWithoutFci = Uint8Array.from([0x84, 206, 0x00, 0x02, 0x12, 0x34, 0x56, 0x78, 0x00, 0x00, 0x00, 0x00]);
    const parsed = new Fir();
    expect(parseSinglePacket(kPacketWithoutFci, parsed)).toBe(false);
  });

  test("ParseFailsOnFractionalFciEntries", () => {
    const kPacketWithOneAndHalfFci = Uint8Array.from([
      0x84, 206, 0x00, 0x05, 0x12, 0x34, 0x56, 0x78, 0x00, 0x00, 0x00, 0x00, 0x23, 0x45, 0x67, 0x89, 0x0d, 0x00, 0x00, 0x00, c("h"),
      c("a"), c("l"), c("f"),
    ]);

    const parsed = new Fir();
    expect(parseSinglePacket(kPacketWithOneAndHalfFci, parsed)).toBe(false);
  });
});
