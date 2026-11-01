// Port of modules/rtp_rtcp/source/rtcp_packet/target_bitrate_unittest.cc @ M154.

import {ExtendedReports} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/extended-reports.js";
import {BitrateItem, TargetBitrate} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/target-bitrate.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const kSsrc = 0x12345678;

// clang-format off
const kPacket = Uint8Array.from([
  TargetBitrate.kBlockType, // Block ID.
  0x00, // Reserved.
  0x00, 0x04, // Length = 4 words.
  0x00, 0x01, 0x02, 0x03, // S0T0 0x010203 kbps.
  0x01, 0x02, 0x03, 0x04, // S0T1 0x020304 kbps.
  0x10, 0x03, 0x04, 0x05, // S1T0 0x030405 kbps.
  0x11, 0x04, 0x05, 0x06, // S1T1 0x040506 kbps.
]);
const kPacketLengthBlocks = Math.floor((kPacket.length + 3) / 4) - 1;

function expectBirateItemEquals(expected: BitrateItem, actual: BitrateItem): void {
  expect(actual.spatialLayer).toBe(expected.spatialLayer);
  expect(actual.temporalLayer).toBe(expected.temporalLayer);
  expect(actual.targetBitrateKbps).toBe(expected.targetBitrateKbps);
}

function checkBitrateItems(bitrates: readonly BitrateItem[]): void {
  expect(bitrates).toHaveLength(4);
  expectBirateItemEquals(new BitrateItem(0, 0, 0x010203), bitrates[0]);
  expectBirateItemEquals(new BitrateItem(0, 1, 0x020304), bitrates[1]);
  expectBirateItemEquals(new BitrateItem(1, 0, 0x030405), bitrates[2]);
  expectBirateItemEquals(new BitrateItem(1, 1, 0x040506), bitrates[3]);
}

describe("TargetBitrateTest", () => {
  test("Parse", () => {
    const targetBitrate = new TargetBitrate();
    targetBitrate.parse(kPacket, kPacketLengthBlocks);
    checkBitrateItems(targetBitrate.getTargetBitrates());
  });

  test("FullPacket", () => {
    const kXRHeaderSize = 8; // RTCP header (4) + SSRC (4).
    const kTotalSize = kXRHeaderSize + kPacket.length;
    const kRtcpPacket = new Uint8Array(kTotalSize);
    kRtcpPacket.set([2 << 6, 207, 0x00, kTotalSize / 4 - 1, 0x12, 0x34, 0x56, 0x78]); // SSRC.
    kRtcpPacket.set(kPacket, kXRHeaderSize);
    const xr = new ExtendedReports();
    expect(parseSinglePacket(kRtcpPacket, xr)).toBe(true);
    expect(xr.senderSsrc()).toBe(kSsrc);
    const targetBitrate = xr.targetBitrate();
    expect(targetBitrate).toBeDefined();
    checkBitrateItems(targetBitrate!.getTargetBitrates());
  });

  test("Create", () => {
    const targetBitrate = new TargetBitrate();
    targetBitrate.addTargetBitrate(0, 0, 0x010203);
    targetBitrate.addTargetBitrate(0, 1, 0x020304);
    targetBitrate.addTargetBitrate(1, 0, 0x030405);
    targetBitrate.addTargetBitrate(1, 1, 0x040506);

    const buffer = new Uint8Array(kPacket.length);
    expect(targetBitrate.blockLength()).toBe(kPacket.length);
    targetBitrate.create(buffer);

    expect(buffer).toEqual(kPacket);
  });

  test("ParseNullBitratePacket", () => {
    const kNullPacket = Uint8Array.from([TargetBitrate.kBlockType, 0x00, 0x00, 0x00]);
    const targetBitrate = new TargetBitrate();
    targetBitrate.parse(kNullPacket, 0);
    expect(targetBitrate.getTargetBitrates()).toHaveLength(0);
  });
});
