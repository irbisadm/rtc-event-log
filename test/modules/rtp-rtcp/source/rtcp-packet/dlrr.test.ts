// Port of modules/rtp_rtcp/source/rtcp_packet/dlrr_unittest.cc @ M154.

import {ByteReader} from "../../../../../src/modules/rtp-rtcp/source/byte-io.js";
import {Dlrr, ReceiveTimeInfo} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/dlrr.js";

const kSsrc = 0x12345678;
const kLastRR = 0x23344556;
const kDelay = 0x33343536;
const kBlock = Uint8Array.from([0x05, 0x00, 0x00, 0x03, 0x12, 0x34, 0x56, 0x78, 0x23, 0x34, 0x45, 0x56, 0x33, 0x34, 0x35, 0x36]);
const kBlockSizeBytes = kBlock.length;

describe("RtcpPacketDlrrTest", () => {
  test("Empty", () => {
    const dlrr = new Dlrr();
    expect(dlrr.blockLength()).toBe(0);
  });

  test("Create", () => {
    const dlrr = new Dlrr();
    dlrr.addDlrrItem(new ReceiveTimeInfo(kSsrc, kLastRR, kDelay));

    expect(dlrr.blockLength()).toBe(kBlockSizeBytes);
    const buffer = new Uint8Array(kBlockSizeBytes);

    dlrr.create(buffer);
    expect(buffer).toEqual(kBlock);
  });

  test("Parse", () => {
    const dlrr = new Dlrr();
    const blockLength = ByteReader.u16(kBlock, 2);
    expect(dlrr.parse(kBlock, blockLength)).toBe(true);

    expect(dlrr.subBlocks()).toHaveLength(1);
    const block = dlrr.subBlocks()[0];
    expect(block.ssrc).toBe(kSsrc);
    expect(block.lastRr).toBe(kLastRR);
    expect(block.delaySinceLastRr).toBe(kDelay);
  });

  test("ParseFailsOnBadSize", () => {
    const kBigBufferSize = 0x100; // More than enough.
    const buffer = new Uint8Array(kBigBufferSize);
    buffer[0] = Dlrr.kBlockType;
    buffer[1] = 0; // Reserved.
    buffer[2] = 0; // Most significant size byte.
    for (let size = 3; size < 6; ++size) {
      buffer[3] = size;
      const dlrr = new Dlrr();
      // Parse should be successful only when size is multiple of 3.
      expect(dlrr.parse(buffer, size)).toBe(size % 3 === 0);
    }
  });

  test("CreateAndParseManySubBlocks", () => {
    const kBufferSize = 0x1000; // More than enough.
    const kManyDlrrItems = 50;
    const buffer = new Uint8Array(kBufferSize);

    const dlrr = new Dlrr();
    for (let i = 1; i <= kManyDlrrItems; ++i) dlrr.addDlrrItem(new ReceiveTimeInfo(kSsrc + i, kLastRR + i, kDelay + i));
    const usedBufferSize = dlrr.blockLength();
    expect(usedBufferSize).toBeLessThanOrEqual(kBufferSize);
    dlrr.create(buffer);

    const parsed = new Dlrr();
    const blockLength = ByteReader.u16(buffer, 2);
    expect((blockLength + 1) * 4).toBe(usedBufferSize);
    expect(parsed.parse(buffer, blockLength)).toBe(true);
    expect(parsed.subBlocks()).toHaveLength(kManyDlrrItems);
  });
});
