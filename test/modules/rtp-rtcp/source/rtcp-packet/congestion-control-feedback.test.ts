// Port of modules/rtp_rtcp/source/rtcp_packet/congestion_control_feedback_unittest.cc @ M154.

import {EcnMarking} from "../../../../../src/api/transport/ecn-marking.js";
import {CommonHeader} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/common-header.js";
import {
  CongestionControlFeedback,
  CongestionControlPacketInfo as PacketInfo,
} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/congestion-control-feedback.js";
import {Rtpfb} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/rtpfb.js";

const ms = (v: number) => v * 1000;

function packetInfoEqual(a: PacketInfo, b: PacketInfo): boolean {
  const arrivalTimeOffsetEqual =
    (!Number.isFinite(a.arrivalTimeOffset) && !Number.isFinite(b.arrivalTimeOffset)) ||
    (Number.isFinite(a.arrivalTimeOffset) &&
      Number.isFinite(b.arrivalTimeOffset) &&
      Math.abs(a.arrivalTimeOffset - b.arrivalTimeOffset) < Math.trunc(1_000_000 / 1024));
  return a.ssrc === b.ssrc && a.sequenceNumber === b.sequenceNumber && arrivalTimeOffsetEqual && a.ecn === b.ecn;
}

function expectPacketInfoEqual(actual: readonly PacketInfo[], expected: readonly PacketInfo[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((a, i) => expect({i, equal: packetInfoEqual(a, expected[i])}).toEqual({i, equal: true}));
}

function buildAndParse(fb: CongestionControlFeedback): {header: CommonHeader; parsed: CongestionControlFeedback} {
  const buffer = fb.build();
  const parsed = new CongestionControlFeedback();
  const header = new CommonHeader();
  expect(header.parse(buffer)).toBe(true);
  expect(parsed.parse(header)).toBe(true);
  return {header, parsed};
}

describe("CongestionControlFeedbackTest", () => {
  test("BlockLengthNoPackets", () => {
    const fb = new CongestionControlFeedback([], /*compact_ntp_timestamp=*/ 1);
    expect(fb.blockLength()).toBe(/*common header */ 4 /*sender ssrc*/ + 4 + /*timestamp*/ 4);
  });

  test("BlockLengthTwoSsrcOnePacketEach", () => {
    const packets = [new PacketInfo(1, 1), new PacketInfo(2, 1)];
    const fb = new CongestionControlFeedback(packets, /*compact_ntp_timestamp=*/ 1);
    expect(fb.blockLength()).toBe(4 + 4 + 4 + /*per ssrc header*/ 2 * 8 + /* padded packet info per ssrc*/ 2 * 4);
  });

  test("BlockLengthTwoSsrcTwoPacketsEach", () => {
    const packets = [new PacketInfo(1, 1), new PacketInfo(1, 2), new PacketInfo(2, 1), new PacketInfo(2, 2)];
    const fb = new CongestionControlFeedback(packets, /*compact_ntp_timestamp=*/ 1);
    expect(fb.blockLength()).toBe(4 + 4 + 4 + /*per ssrc header*/ 2 * 8 + /*packet info per ssrc*/ 2 * 4);
  });

  test("BlockLengthMissingPackets", () => {
    const packets = [new PacketInfo(1, 1), new PacketInfo(1, 4)];
    const fb = new CongestionControlFeedback(packets, /*compact_ntp_timestamp=*/ 1);
    expect(fb.blockLength()).toBe(4 + 4 + 4 + /*per ssrc header*/ 1 * 8 + /*packet info per ssrc*/ 2 * 4);
  });

  test("CreateReturnsTrueForBasicPacket", () => {
    const packets = [new PacketInfo(1, 1, ms(1)), new PacketInfo(2, 2, ms(2))];
    const fb = new CongestionControlFeedback(packets, /*compact_ntp_timestamp=*/ 1);
    const buf = new Uint8Array(fb.blockLength());
    const position = {value: 0};
    expect(fb.create(buf, position, buf.length, null)).toBe(true);
  });

  test("CanCreateAndParseWithoutPackets", () => {
    const kPackets: PacketInfo[] = [];
    const kCompactNtp = 1234;
    const {parsed} = buildAndParse(new CongestionControlFeedback([...kPackets], kCompactNtp));
    expect(parsed.packets()).toHaveLength(0);
    expect(parsed.reportTimestampCompactNtp()).toBe(kCompactNtp);
    expectPacketInfoEqual(parsed.packets(), kPackets);
  });

  test("CanCreateAndParsePacketsWithTwoSsrc", () => {
    const kPackets = [new PacketInfo(1, 1, ms(1)), new PacketInfo(2, 1, ms(3))];
    const kCompactNtp = 1234;
    const {header, parsed} = buildAndParse(new CongestionControlFeedback([...kPackets], kCompactNtp));
    expect(header.fmt()).toBe(CongestionControlFeedback.kFeedbackMessageType);
    expect(header.type()).toBe(Rtpfb.kPacketType);
    expect(parsed.reportTimestampCompactNtp()).toBe(kCompactNtp);
    expectPacketInfoEqual(parsed.packets(), kPackets);
  });

  test("CanCreateAndParsePacketWithEcnCe", () => {
    const kPackets = [new PacketInfo(1, 1, ms(1), EcnMarking.kCe)];
    const {parsed} = buildAndParse(new CongestionControlFeedback([...kPackets], 1234));
    expectPacketInfoEqual(parsed.packets(), kPackets);
  });

  test("CanCreateAndParsePacketWithEct1", () => {
    const kPackets = [new PacketInfo(1, 1, ms(1), EcnMarking.kEct1)];
    const {parsed} = buildAndParse(new CongestionControlFeedback([...kPackets], 1234));
    expectPacketInfoEqual(parsed.packets(), kPackets);
  });

  test("CanCreateAndParseWithMissingPackets", () => {
    const kPackets = [
      new PacketInfo(1, 0xfffe, ms(1)),
      new PacketInfo(1, 0xffff, -Infinity),
      new PacketInfo(1, 0, -Infinity),
      new PacketInfo(1, 1, ms(1)),
    ];
    const {parsed} = buildAndParse(new CongestionControlFeedback([...kPackets], 1234));
    expectPacketInfoEqual(parsed.packets(), kPackets);
  });
});
