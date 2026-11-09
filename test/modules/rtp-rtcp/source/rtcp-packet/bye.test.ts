// Port of modules/rtp_rtcp/source/rtcp_packet/bye_unittest.cc @ M154.

import {Bye} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/bye.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const kSenderSsrc = 0x12345678;
const kCsrc1 = 0x22232425;
const kCsrc2 = 0x33343536;

describe("RtcpPacketByeTest", () => {
  test("CreateAndParseWithoutReason", () => {
    const bye = new Bye();
    bye.setSenderSsrc(kSenderSsrc);

    const raw = bye.build();
    const parsedBye = new Bye();
    expect(parseSinglePacket(raw, parsedBye)).toBe(true);

    expect(parsedBye.senderSsrc()).toBe(kSenderSsrc);
    expect(parsedBye.csrcs()).toHaveLength(0);
    expect(parsedBye.reason()).toBe("");
  });

  test("CreateAndParseWithCsrcs", () => {
    const bye = new Bye();
    bye.setSenderSsrc(kSenderSsrc);
    expect(bye.setCsrcs([kCsrc1, kCsrc2])).toBe(true);
    expect(bye.reason()).toBe("");

    const raw = bye.build();
    const parsedBye = new Bye();
    expect(parseSinglePacket(raw, parsedBye)).toBe(true);

    expect(parsedBye.senderSsrc()).toBe(kSenderSsrc);
    expect(parsedBye.csrcs()).toEqual([kCsrc1, kCsrc2]);
    expect(parsedBye.reason()).toBe("");
  });

  test("CreateAndParseWithCsrcsAndAReason", () => {
    const bye = new Bye();
    const kReason = "Some Reason";

    bye.setSenderSsrc(kSenderSsrc);
    expect(bye.setCsrcs([kCsrc1, kCsrc2])).toBe(true);
    bye.setReason(kReason);

    const raw = bye.build();
    const parsedBye = new Bye();
    expect(parseSinglePacket(raw, parsedBye)).toBe(true);

    expect(parsedBye.senderSsrc()).toBe(kSenderSsrc);
    expect(parsedBye.csrcs()).toEqual([kCsrc1, kCsrc2]);
    expect(parsedBye.reason()).toBe(kReason);
  });

  test("CreateWithTooManyCsrcs", () => {
    const bye = new Bye();
    bye.setSenderSsrc(kSenderSsrc);
    const kMaxCsrcs = (1 << 5) - 2; // 5 bit len, first item is sender SSRC.
    expect(bye.setCsrcs(new Array(kMaxCsrcs).fill(kCsrc1))).toBe(true);
    expect(bye.setCsrcs(new Array(kMaxCsrcs + 1).fill(kCsrc1))).toBe(false);
  });

  test("CreateAndParseWithAReason", () => {
    const bye = new Bye();
    const kReason = "Some Random Reason";

    bye.setSenderSsrc(kSenderSsrc);
    bye.setReason(kReason);

    const raw = bye.build();
    const parsedBye = new Bye();
    expect(parseSinglePacket(raw, parsedBye)).toBe(true);

    expect(parsedBye.senderSsrc()).toBe(kSenderSsrc);
    expect(parsedBye.csrcs()).toHaveLength(0);
    expect(parsedBye.reason()).toBe(kReason);
  });

  test("CreateAndParseWithReasons", () => {
    // Test that packet creation/parsing behave with reasons of different length
    // both when it require padding and when it does not.
    for (let reminder = 0; reminder < 4; ++reminder) {
      const kReason = String.fromCharCode("a".charCodeAt(0) + reminder).repeat(4 + reminder);
      const bye = new Bye();
      bye.setSenderSsrc(kSenderSsrc);
      bye.setReason(kReason);

      const raw = bye.build();
      const parsedBye = new Bye();
      expect(parseSinglePacket(raw, parsedBye)).toBe(true);

      expect(parsedBye.reason()).toBe(kReason);
    }
  });

  test("ParseEmptyPacket", () => {
    const kEmptyPacket = Uint8Array.from([0x80, Bye.kPacketType, 0, 0]);
    const parsedBye = new Bye();
    expect(parseSinglePacket(kEmptyPacket, parsedBye)).toBe(true);
    expect(parsedBye.senderSsrc()).toBe(0);
    expect(parsedBye.csrcs()).toHaveLength(0);
    expect(parsedBye.reason()).toBe("");
  });

  test("ParseFailOnInvalidSrcCount", () => {
    const bye = new Bye();
    bye.setSenderSsrc(kSenderSsrc);

    const raw = bye.build();
    raw[0]++; // Damage the packet: increase ssrc count by one.

    const parsedBye = new Bye();
    expect(parseSinglePacket(raw, parsedBye)).toBe(false);
  });

  test("ParseFailOnInvalidReasonLength", () => {
    const bye = new Bye();
    bye.setSenderSsrc(kSenderSsrc);
    bye.setReason("18 characters long");

    const raw = bye.build();
    // Damage the packet: decrease payload size by 4 bytes
    raw[3]--;
    const shortened = raw.subarray(0, raw.length - 4);

    const parsedBye = new Bye();
    expect(parseSinglePacket(shortened, parsedBye)).toBe(false);
  });
});
