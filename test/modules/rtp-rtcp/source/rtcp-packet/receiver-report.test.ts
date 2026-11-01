// Port of modules/rtp_rtcp/source/rtcp_packet/receiver_report_unittest.cc @ M154.

import {ReceiverReport} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/receiver-report.js";
import {ReportBlock} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/report-block.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const kSenderSsrc = 0x12345678;
const kRemoteSsrc = 0x23456789;
const kFractionLost = 55;
const kCumulativeLost = 0x111213;
const kExtHighestSeqNum = 0x22232425;
const kJitter = 0x33343536;
const kLastSr = 0x44454647;
const kDelayLastSr = 0x55565758;
// RTCP receiver report with one report block.
const kPacket = Uint8Array.from([
  0x81, 201, 0x00, 0x07, 0x12, 0x34, 0x56, 0x78, 0x23, 0x45, 0x67, 0x89, 55, 0x11, 0x12, 0x13, 0x22, 0x23, 0x24, 0x25, 0x33, 0x34,
  0x35, 0x36, 0x44, 0x45, 0x46, 0x47, 0x55, 0x56, 0x57, 0x58,
]);

const blocks = (n: number) => Array.from({length: n}, () => new ReportBlock());

describe("RtcpPacketReceiverReportTest", () => {
  test("ParseWithOneReportBlock", () => {
    const rr = new ReceiverReport();
    expect(parseSinglePacket(kPacket, rr)).toBe(true);
    const parsed = rr;

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.reportBlocks()).toHaveLength(1);
    const rb = parsed.reportBlocks()[0];
    expect(rb.sourceSsrc()).toBe(kRemoteSsrc);
    expect(rb.fractionLost()).toBe(kFractionLost);
    expect(rb.cumulativeLost()).toBe(kCumulativeLost);
    expect(rb.extendedHighSeqNum()).toBe(kExtHighestSeqNum);
    expect(rb.jitter()).toBe(kJitter);
    expect(rb.lastSr()).toBe(kLastSr);
    expect(rb.delaySinceLastSr()).toBe(kDelayLastSr);
  });

  test("ParseFailsOnIncorrectSize", () => {
    const damagedPacket = kPacket.slice();
    damagedPacket[0]++; // Damage the packet: increase count field.
    const rr = new ReceiverReport();
    expect(parseSinglePacket(damagedPacket, rr)).toBe(false);
  });

  test("CreateWithOneReportBlock", () => {
    const rr = new ReceiverReport();
    rr.setSenderSsrc(kSenderSsrc);
    const rb = new ReportBlock();
    rb.setMediaSsrc(kRemoteSsrc);
    rb.setFractionLost(kFractionLost);
    rb.setCumulativeLost(kCumulativeLost);
    rb.setExtHighestSeqNum(kExtHighestSeqNum);
    rb.setJitter(kJitter);
    rb.setLastSr(kLastSr);
    rb.setDelayLastSr(kDelayLastSr);
    rr.addReportBlock(rb);

    expect(rr.build()).toEqual(kPacket);
  });

  test("CreateAndParseWithoutReportBlocks", () => {
    const rr = new ReceiverReport();
    rr.setSenderSsrc(kSenderSsrc);

    const raw = rr.build();
    const parsed = new ReceiverReport();
    expect(parseSinglePacket(raw, parsed)).toBe(true);

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.reportBlocks()).toHaveLength(0);
  });

  test("CreateAndParseWithTwoReportBlocks", () => {
    const rr = new ReceiverReport();
    const rb1 = new ReportBlock();
    rb1.setMediaSsrc(kRemoteSsrc);
    const rb2 = new ReportBlock();
    rb2.setMediaSsrc(kRemoteSsrc + 1);

    rr.setSenderSsrc(kSenderSsrc);
    expect(rr.addReportBlock(rb1)).toBe(true);
    expect(rr.addReportBlock(rb2)).toBe(true);

    const raw = rr.build();
    const parsed = new ReceiverReport();
    expect(parseSinglePacket(raw, parsed)).toBe(true);

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.reportBlocks()).toHaveLength(2);
    expect(parsed.reportBlocks()[0].sourceSsrc()).toBe(kRemoteSsrc);
    expect(parsed.reportBlocks()[1].sourceSsrc()).toBe(kRemoteSsrc + 1);
  });

  test("CreateWithTooManyReportBlocks", () => {
    const rr = new ReceiverReport();
    rr.setSenderSsrc(kSenderSsrc);
    const rb = new ReportBlock();
    for (let i = 0; i < ReceiverReport.kMaxNumberOfReportBlocks; ++i) {
      rb.setMediaSsrc(kRemoteSsrc + i);
      expect(rr.addReportBlock(rb)).toBe(true);
    }
    rb.setMediaSsrc(kRemoteSsrc + ReceiverReport.kMaxNumberOfReportBlocks);
    expect(rr.addReportBlock(rb)).toBe(false);
  });

  test("SetReportBlocksOverwritesOldBlocks", () => {
    const rr = new ReceiverReport();
    const reportBlock = new ReportBlock();
    reportBlock.setJitter(1001);
    rr.addReportBlock(reportBlock);
    expect(rr.reportBlocks()).toHaveLength(1);
    expect(rr.reportBlocks()[0].jitter()).toBe(1001);

    const three = blocks(3);
    three[0].setJitter(2001);
    three[1].setJitter(3001);
    three[2].setJitter(4001);
    expect(rr.setReportBlocks(three)).toBe(true);
    expect(rr.reportBlocks()).toHaveLength(3);
    expect(rr.reportBlocks()[0].jitter()).toBe(2001);
    expect(rr.reportBlocks()[1].jitter()).toBe(3001);
    expect(rr.reportBlocks()[2].jitter()).toBe(4001);
  });

  test("SetReportBlocksMaxLimit", () => {
    const rr = new ReceiverReport();
    expect(rr.setReportBlocks(blocks(ReceiverReport.kMaxNumberOfReportBlocks))).toBe(true);
    expect(rr.setReportBlocks(blocks(ReceiverReport.kMaxNumberOfReportBlocks + 1))).toBe(false);
  });
});
