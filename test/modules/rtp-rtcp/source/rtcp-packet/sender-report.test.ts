// Port of modules/rtp_rtcp/source/rtcp_packet/sender_report_unittest.cc @ M154.

import {ReportBlock} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/report-block.js";
import {SenderReport} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/sender-report.js";
import {NtpTime} from "../../../../../src/system-wrappers/include/ntp-time.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const kSenderSsrc = 0x12345678;
const kRemoteSsrc = 0x23456789;
const kNtp = new NtpTime(0x11121418, 0x22242628);
const kRtpTimestamp = 0x33343536;
const kPacketCount = 0x44454647;
const kOctetCount = 0x55565758;
const kPacket = Uint8Array.from([
  0x80, 200, 0x00, 0x06, 0x12, 0x34, 0x56, 0x78, 0x11, 0x12, 0x14, 0x18, 0x22, 0x24, 0x26, 0x28, 0x33, 0x34, 0x35, 0x36, 0x44, 0x45,
  0x46, 0x47, 0x55, 0x56, 0x57, 0x58,
]);

const blocks = (n: number) => Array.from({length: n}, () => new ReportBlock());

describe("RtcpPacketSenderReportTest", () => {
  test("CreateWithoutReportBlocks", () => {
    const sr = new SenderReport();
    sr.setSenderSsrc(kSenderSsrc);
    sr.setNtp(kNtp);
    sr.setRtpTimestamp(kRtpTimestamp);
    sr.setPacketCount(kPacketCount);
    sr.setOctetCount(kOctetCount);

    const raw = sr.build();
    expect(raw).toEqual(kPacket);
  });

  test("ParseWithoutReportBlocks", () => {
    const parsed = new SenderReport();
    expect(parseSinglePacket(kPacket, parsed)).toBe(true);

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.ntp().equals(kNtp)).toBe(true);
    expect(parsed.rtpTimestamp()).toBe(kRtpTimestamp);
    expect(parsed.senderPacketCount()).toBe(kPacketCount);
    expect(parsed.senderOctetCount()).toBe(kOctetCount);
    expect(parsed.reportBlocks()).toHaveLength(0);
  });

  test("CreateAndParseWithOneReportBlock", () => {
    const rb = new ReportBlock();
    rb.setMediaSsrc(kRemoteSsrc);

    const sr = new SenderReport();
    sr.setSenderSsrc(kSenderSsrc);
    expect(sr.addReportBlock(rb)).toBe(true);

    const raw = sr.build();
    const parsed = new SenderReport();
    expect(parseSinglePacket(raw, parsed)).toBe(true);

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.reportBlocks()).toHaveLength(1);
    expect(parsed.reportBlocks()[0].sourceSsrc()).toBe(kRemoteSsrc);
  });

  test("CreateAndParseWithTwoReportBlocks", () => {
    const rb1 = new ReportBlock();
    rb1.setMediaSsrc(kRemoteSsrc);
    const rb2 = new ReportBlock();
    rb2.setMediaSsrc(kRemoteSsrc + 1);

    const sr = new SenderReport();
    sr.setSenderSsrc(kSenderSsrc);
    expect(sr.addReportBlock(rb1)).toBe(true);
    expect(sr.addReportBlock(rb2)).toBe(true);

    const raw = sr.build();
    const parsed = new SenderReport();
    expect(parseSinglePacket(raw, parsed)).toBe(true);

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.reportBlocks()).toHaveLength(2);
    expect(parsed.reportBlocks()[0].sourceSsrc()).toBe(kRemoteSsrc);
    expect(parsed.reportBlocks()[1].sourceSsrc()).toBe(kRemoteSsrc + 1);
  });

  test("CreateWithTooManyReportBlocks", () => {
    const sr = new SenderReport();
    sr.setSenderSsrc(kSenderSsrc);
    const rb = new ReportBlock();
    for (let i = 0; i < SenderReport.kMaxNumberOfReportBlocks; ++i) {
      rb.setMediaSsrc(kRemoteSsrc + i);
      expect(sr.addReportBlock(rb)).toBe(true);
    }
    rb.setMediaSsrc(kRemoteSsrc + SenderReport.kMaxNumberOfReportBlocks);
    expect(sr.addReportBlock(rb)).toBe(false);
  });

  test("SetReportBlocksOverwritesOldBlocks", () => {
    const sr = new SenderReport();
    const reportBlock = new ReportBlock();
    reportBlock.setJitter(1001);
    sr.addReportBlock(reportBlock);
    expect(sr.reportBlocks()).toHaveLength(1);
    expect(sr.reportBlocks()[0].jitter()).toBe(1001);

    const three = blocks(3);
    three[0].setJitter(2001);
    three[1].setJitter(3001);
    three[2].setJitter(4001);
    expect(sr.setReportBlocks(three)).toBe(true);
    expect(sr.reportBlocks()).toHaveLength(3);
    expect(sr.reportBlocks()[0].jitter()).toBe(2001);
    expect(sr.reportBlocks()[1].jitter()).toBe(3001);
    expect(sr.reportBlocks()[2].jitter()).toBe(4001);
  });

  test("SetReportBlocksMaxLimit", () => {
    const sr = new SenderReport();
    expect(sr.setReportBlocks(blocks(SenderReport.kMaxNumberOfReportBlocks))).toBe(true);
    expect(sr.setReportBlocks(blocks(SenderReport.kMaxNumberOfReportBlocks + 1))).toBe(false);
  });
});
