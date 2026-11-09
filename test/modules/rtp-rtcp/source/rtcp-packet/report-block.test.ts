// Port of modules/rtp_rtcp/source/rtcp_packet/report_block_unittest.cc @ M154.

import {ReportBlock} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/report-block.js";
import {Random} from "../../../../rtc-base/random.js";

const kRemoteSsrc = 0x23456789;
const kFractionLost = 55;
// Use values that are streamed differently LE and BE.
const kCumulativeLost = 0x111213;
const kExtHighestSeqNum = 0x22232425;
const kJitter = 0x33343536;
const kLastSr = 0x44454647;
const kDelayLastSr = 0x55565758;
const kBufferLength = ReportBlock.kLength;

describe("RtcpPacketReportBlockTest", () => {
  test("ParseChecksLength", () => {
    const buffer = new Uint8Array(kBufferLength);
    const rb = new ReportBlock();
    expect(rb.parse(buffer, kBufferLength - 1)).toBe(false);
    expect(rb.parse(buffer, kBufferLength)).toBe(true);
  });

  test("ParseAnyData", () => {
    const buffer = new Uint8Array(kBufferLength);
    // Fill buffer with semi-random data.
    const generator = new Random(0x256f8a285ec829n);
    for (let i = 0; i < kBufferLength; ++i) buffer[i] = generator.randRange(0, 0xff);

    const rb = new ReportBlock();
    expect(rb.parse(buffer, kBufferLength)).toBe(true);
  });

  test("ParseMatchCreate", () => {
    const rb = new ReportBlock();
    rb.setMediaSsrc(kRemoteSsrc);
    rb.setFractionLost(kFractionLost);
    rb.setCumulativeLost(kCumulativeLost);
    rb.setExtHighestSeqNum(kExtHighestSeqNum);
    rb.setJitter(kJitter);
    rb.setLastSr(kLastSr);
    rb.setDelayLastSr(kDelayLastSr);

    const buffer = new Uint8Array(kBufferLength);
    rb.create(buffer);

    const parsed = new ReportBlock();
    expect(parsed.parse(buffer, kBufferLength)).toBe(true);

    expect(parsed.sourceSsrc()).toBe(kRemoteSsrc);
    expect(parsed.fractionLost()).toBe(kFractionLost);
    expect(parsed.cumulativeLost()).toBe(kCumulativeLost);
    expect(parsed.extendedHighSeqNum()).toBe(kExtHighestSeqNum);
    expect(parsed.jitter()).toBe(kJitter);
    expect(parsed.lastSr()).toBe(kLastSr);
    expect(parsed.delaySinceLastSr()).toBe(kDelayLastSr);
  });

  test("ValidateCumulativeLost", () => {
    // CumulativeLost is a signed 24-bit integer.
    // However, existing code expects it to be an unsigned integer.
    // The case of negative values should be unusual; we return 0
    // when caller wants to treat it as unsigned.
    const kMaxCumulativeLost = 0x7fffff;
    const kMinCumulativeLost = -0x800000;
    const rb = new ReportBlock();
    expect(rb.setCumulativeLost(kMaxCumulativeLost + 1)).toBe(false);
    expect(rb.setCumulativeLost(kMaxCumulativeLost)).toBe(true);
    expect(rb.setCumulativeLost(kMinCumulativeLost - 1)).toBe(false);
    expect(rb.setCumulativeLost(kMinCumulativeLost)).toBe(true);
    expect(rb.cumulativeLost()).toBe(kMinCumulativeLost);
  });

  test("ParseNegativeCumulativeLost", () => {
    // CumulativeLost is a signed 24-bit integer.
    const kNegativeCumulativeLost = -123;
    const rb = new ReportBlock();
    expect(rb.setCumulativeLost(kNegativeCumulativeLost)).toBe(true);

    const buffer = new Uint8Array(kBufferLength);
    rb.create(buffer);

    const parsed = new ReportBlock();
    expect(parsed.parse(buffer, kBufferLength)).toBe(true);

    expect(parsed.cumulativeLost()).toBe(kNegativeCumulativeLost);
  });
});
