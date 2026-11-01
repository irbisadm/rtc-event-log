// Port of modules/rtp_rtcp/source/rtcp_packet/nack_unittest.cc @ M154.

import {Nack} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/nack.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const kSenderSsrc = 0x12345678;
const kRemoteSsrc = 0x23456789;
const kRtpVersionBits = 2 << 6;

const kList = [0, 1, 3, 8, 16];
// prettier-ignore
const kPacket = Uint8Array.from([
  kRtpVersionBits | Nack.kFeedbackMessageType, Nack.kPacketType, 0, 3,
  0x12, 0x34, 0x56, 0x78,
  0x23, 0x45, 0x67, 0x89,
  0x00, 0x00, 0x80, 0x85,
]);

const kWrapList = [0xffdc, 0xffec, 0xfffe, 0xffff, 0x0000, 0x0001, 0x0003, 0x0014, 0x0064];
// prettier-ignore
const kWrapPacket = Uint8Array.from([
  kRtpVersionBits | Nack.kFeedbackMessageType, Nack.kPacketType, 0, 6,
  0x12, 0x34, 0x56, 0x78,
  0x23, 0x45, 0x67, 0x89,
  0xff, 0xdc, 0x80, 0x00,
  0xff, 0xfe, 0x00, 0x17,
  0x00, 0x14, 0x00, 0x00,
  0x00, 0x64, 0x00, 0x00,
]);
// prettier-ignore
const kTooSmallPacket = Uint8Array.from([
  kRtpVersionBits | Nack.kFeedbackMessageType, Nack.kPacketType, 0, 2,
  0x12, 0x34, 0x56, 0x78,
  0x23, 0x45, 0x67, 0x89,
]);

describe("RtcpPacketNackTest", () => {
  test("Create", () => {
    const nack = new Nack();
    nack.setSenderSsrc(kSenderSsrc);
    nack.setMediaSsrc(kRemoteSsrc);
    nack.setPacketIds(kList);

    expect(nack.build()).toEqual(kPacket);
  });

  test("Parse", () => {
    const parsed = new Nack();
    expect(parseSinglePacket(kPacket, parsed)).toBe(true);
    const constParsed = parsed;

    expect(constParsed.senderSsrc()).toBe(kSenderSsrc);
    expect(constParsed.mediaSsrc()).toBe(kRemoteSsrc);
    expect(constParsed.packetIds()).toEqual(kList);
  });

  test("CreateWrap", () => {
    const nack = new Nack();
    nack.setSenderSsrc(kSenderSsrc);
    nack.setMediaSsrc(kRemoteSsrc);
    nack.setPacketIds(kWrapList);

    expect(nack.build()).toEqual(kWrapPacket);
  });

  test("ParseWrap", () => {
    const parsed = new Nack();
    expect(parseSinglePacket(kWrapPacket, parsed)).toBe(true);

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.mediaSsrc()).toBe(kRemoteSsrc);
    expect(parsed.packetIds()).toEqual(kWrapList);
  });

  test("BadOrder", () => {
    // Does not guarantee optimal packing, but should guarantee correctness.
    const kUnorderedList = [1, 25, 13, 12, 9, 27, 29];
    const nack = new Nack();
    nack.setSenderSsrc(kSenderSsrc);
    nack.setMediaSsrc(kRemoteSsrc);
    nack.setPacketIds(kUnorderedList);

    const packet = nack.build();

    const parsed = new Nack();
    expect(parseSinglePacket(packet, parsed)).toBe(true);

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.mediaSsrc()).toBe(kRemoteSsrc);
    expect([...parsed.packetIds()].sort((a, b) => a - b)).toEqual([...kUnorderedList].sort((a, b) => a - b));
  });

  test("CreateFragmented", () => {
    const nack = new Nack();
    const kFragmentedList = [1, 100, 200, 300, 400];
    nack.setSenderSsrc(kSenderSsrc);
    nack.setMediaSsrc(kRemoteSsrc);
    nack.setPacketIds(kFragmentedList);

    const kBufferSize = 12 + 3 * 4; // Fits common header + 3 nack items

    const received: number[][] = [];
    const callback = (packet: Uint8Array) => {
      const parsedNack = new Nack();
      expect(parseSinglePacket(packet, parsedNack)).toBe(true);
      expect(parsedNack.senderSsrc()).toBe(kSenderSsrc);
      expect(parsedNack.mediaSsrc()).toBe(kRemoteSsrc);
      received.push([...parsedNack.packetIds()]);
    };
    expect(nack.build(kBufferSize, callback)).toBe(true);
    expect(received).toEqual([
      [1, 100, 200],
      [300, 400],
    ]);
  });

  test("CreateFailsWithTooSmallBuffer", () => {
    const kSmallList = [1];
    const kMinNackBlockSize = 16;
    const nack = new Nack();
    nack.setSenderSsrc(kSenderSsrc);
    nack.setMediaSsrc(kRemoteSsrc);
    nack.setPacketIds(kSmallList);

    let calls = 0;
    expect(nack.build(kMinNackBlockSize - 1, () => ++calls)).toBe(false);
    expect(calls).toBe(0);
  });

  test("ParseFailsWithTooSmallBuffer", () => {
    const parsed = new Nack();
    expect(parseSinglePacket(kTooSmallPacket, parsed)).toBe(false);
  });
});
