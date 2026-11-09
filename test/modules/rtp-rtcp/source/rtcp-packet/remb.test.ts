// Port of modules/rtp_rtcp/source/rtcp_packet/remb_unittest.cc @ M154.

import {Remb} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/remb.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const kSenderSsrc = 0x12345678;
const kRemoteSsrcs = [0x23456789, 0x2345678a, 0x2345678b];
const kBitrateBps = 0x3fb93 * 2; // 522022;
const kBitrateBps64bit = 0x3fb93 * 2 ** 30;
const c = (ch: string) => ch.charCodeAt(0);
const kPacket = Uint8Array.from([
  0x8f, 206, 0x00, 0x07, 0x12, 0x34, 0x56, 0x78, 0x00, 0x00, 0x00, 0x00, c("R"), c("E"), c("M"), c("B"), 0x03, 0x07, 0xfb, 0x93, 0x23,
  0x45, 0x67, 0x89, 0x23, 0x45, 0x67, 0x8a, 0x23, 0x45, 0x67, 0x8b,
]);
const kPacketLength = kPacket.length;

describe("RtcpPacketRembTest", () => {
  test("Create", () => {
    const remb = new Remb();
    remb.setSenderSsrc(kSenderSsrc);
    remb.setSsrcs(kRemoteSsrcs);
    remb.setBitrateBps(kBitrateBps);

    expect(remb.build()).toEqual(kPacket);
  });

  test("Parse", () => {
    const remb = new Remb();
    expect(parseSinglePacket(kPacket, remb)).toBe(true);
    const parsed = remb;

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.bitrateBps()).toBe(kBitrateBps);
    expect(parsed.ssrcs()).toEqual(kRemoteSsrcs);
  });

  test("CreateAndParseWithoutSsrcs", () => {
    const remb = new Remb();
    remb.setSenderSsrc(kSenderSsrc);
    remb.setBitrateBps(kBitrateBps);
    const packet = remb.build();

    const parsed = new Remb();
    expect(parseSinglePacket(packet, parsed)).toBe(true);
    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.bitrateBps()).toBe(kBitrateBps);
    expect(parsed.ssrcs()).toHaveLength(0);
  });

  test("CreateAndParse64bitBitrate", () => {
    const remb = new Remb();
    remb.setBitrateBps(kBitrateBps64bit);
    const packet = remb.build();

    const parsed = new Remb();
    expect(parseSinglePacket(packet, parsed)).toBe(true);
    expect(parsed.bitrateBps()).toBe(kBitrateBps64bit);
  });

  test("ParseFailsOnTooSmallPacketToBeRemb", () => {
    // Make it too small.
    const kTooSmallSize = (1 + 3) * 4;
    const packet = kPacket.slice(0, kTooSmallSize);
    packet[3] = 3;

    const remb = new Remb();
    expect(parseSinglePacket(packet, remb)).toBe(false);
  });

  test("ParseFailsWhenUniqueIdentifierIsNotRemb", () => {
    const packet = kPacket.slice(0, kPacketLength);
    packet[12] = c("N"); // Swap 'R' -> 'N' in the 'REMB' unique identifier.

    const remb = new Remb();
    expect(parseSinglePacket(packet, remb)).toBe(false);
  });

  test("ParseFailsWhenBitrateDoNotFitIn64bits", () => {
    const packet = kPacket.slice();
    packet[17] |= 0xfc; // Set exponent component to maximum of 63.
    packet[19] |= 0x02; // Ensure mantissa is at least 2.

    const remb = new Remb();
    expect(parseSinglePacket(packet, remb)).toBe(false);
  });

  test("ParseFailsWhenBitrateDoNotFitIn63bits", () => {
    const packet = kPacket.slice();
    packet[17] = 56 << 2; // Set exponent component to 56.
    packet[18] = 0; // Set mantissa to 200 > 128
    packet[19] = 200;

    // Result value 200 * 2^56 can't be represented with int64_t and thus should
    // be rejected.
    const remb = new Remb();
    expect(parseSinglePacket(packet, remb)).toBe(false);
  });

  test("ParseFailsWhenSsrcCountMismatchLength", () => {
    const packet = kPacket.slice();
    packet[16]++; // Swap 3 -> 4 in the ssrcs count.

    const remb = new Remb();
    expect(parseSinglePacket(packet, remb)).toBe(false);
  });

  test("TooManySsrcs", () => {
    const remb = new Remb();
    expect(remb.setSsrcs(new Array(Remb.kMaxNumberOfSsrcs + 1).fill(kRemoteSsrcs[0]))).toBe(false);
    expect(remb.setSsrcs(new Array(Remb.kMaxNumberOfSsrcs).fill(kRemoteSsrcs[0]))).toBe(true);
  });
});
