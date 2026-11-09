// Port of modules/rtp_rtcp/source/rtcp_packet/extended_reports_unittest.cc @ M154.

import {ReceiveTimeInfo} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/dlrr.js";
import {ExtendedReports} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/extended-reports.js";
import {Rrtr} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/rrtr.js";
import {NtpTime} from "../../../../../src/system-wrappers/include/ntp-time.js";
import {Random} from "../../../../rtc-base/random.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const kSenderSsrc = 0x12345678;
const kEmptyPacket = Uint8Array.from([0x80, 207, 0x00, 0x01, 0x12, 0x34, 0x56, 0x78]);

describe("RtcpPacketExtendedReportsTest", () => {
  let random: Random;
  beforeEach(() => {
    random = new Random(0x123456789n);
  });
  const randTimeInfo = () => {
    const ssrc = random.randU32();
    const lastRr = random.randU32();
    const delaySinceLastRr = random.randU32();
    return new ReceiveTimeInfo(ssrc, lastRr, delaySinceLastRr);
  };
  const randNtp = () => {
    const secs = random.randU32();
    const frac = random.randU32();
    return new NtpTime(secs, frac);
  };
  const randRrtr = () => {
    const rrtr = new Rrtr();
    rrtr.setNtp(randNtp());
    return rrtr;
  };
  const timeInfos = (infos: readonly ReceiveTimeInfo[]) => infos.map((i) => [i.ssrc, i.lastRr, i.delaySinceLastRr]);

  test("CreateWithoutReportBlocks", () => {
    const xr = new ExtendedReports();
    xr.setSenderSsrc(kSenderSsrc);

    expect(xr.build()).toEqual(kEmptyPacket);
  });

  test("ParseWithoutReportBlocks", () => {
    const parsed = new ExtendedReports();
    expect(parseSinglePacket(kEmptyPacket, parsed)).toBe(true);
    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.rrtr()).toBeUndefined();
    expect(parsed.dlrr().isSet()).toBe(false);
  });

  test("CreateAndParseWithRrtrBlock", () => {
    const kRrtr = randRrtr();
    const xr = new ExtendedReports();
    xr.setSenderSsrc(kSenderSsrc);
    xr.setRrtr(kRrtr);
    const packet = xr.build();

    const mparsed = new ExtendedReports();
    expect(parseSinglePacket(packet, mparsed)).toBe(true);
    const parsed = mparsed;

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.rrtr()?.equals(kRrtr)).toBe(true);
  });

  test("CreateAndParseWithDlrrWithOneSubBlock", () => {
    const kTimeInfo = randTimeInfo();
    const xr = new ExtendedReports();
    xr.setSenderSsrc(kSenderSsrc);
    xr.addDlrrItem(kTimeInfo);

    const packet = xr.build();

    const mparsed = new ExtendedReports();
    expect(parseSinglePacket(packet, mparsed)).toBe(true);
    const parsed = mparsed;

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(timeInfos(parsed.dlrr().subBlocks())).toEqual(timeInfos([kTimeInfo]));
  });

  test("CreateAndParseWithDlrrWithTwoSubBlocks", () => {
    const kTimeInfo1 = randTimeInfo();
    const kTimeInfo2 = randTimeInfo();
    const xr = new ExtendedReports();
    xr.setSenderSsrc(kSenderSsrc);
    xr.addDlrrItem(kTimeInfo1);
    xr.addDlrrItem(kTimeInfo2);

    const packet = xr.build();

    const mparsed = new ExtendedReports();
    expect(parseSinglePacket(packet, mparsed)).toBe(true);
    const parsed = mparsed;

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(timeInfos(parsed.dlrr().subBlocks())).toEqual(timeInfos([kTimeInfo1, kTimeInfo2]));
  });

  test("CreateLimitsTheNumberOfDlrrSubBlocks", () => {
    const kTimeInfo = randTimeInfo();
    const xr = new ExtendedReports();

    for (let i = 0; i < ExtendedReports.kMaxNumberOfDlrrItems; ++i) expect(xr.addDlrrItem(kTimeInfo)).toBe(true);
    expect(xr.addDlrrItem(kTimeInfo)).toBe(false);

    expect(xr.dlrr().subBlocks()).toHaveLength(ExtendedReports.kMaxNumberOfDlrrItems);
  });

  test("CreateAndParseWithMaximumReportBlocks", () => {
    const kRrtr = randRrtr();

    const xr = new ExtendedReports();
    xr.setSenderSsrc(kSenderSsrc);
    xr.setRrtr(kRrtr);
    for (let i = 0; i < ExtendedReports.kMaxNumberOfDlrrItems; ++i) xr.addDlrrItem(randTimeInfo());

    const packet = xr.build();

    const mparsed = new ExtendedReports();
    expect(parseSinglePacket(packet, mparsed)).toBe(true);
    const parsed = mparsed;

    expect(parsed.senderSsrc()).toBe(kSenderSsrc);
    expect(parsed.rrtr()?.equals(kRrtr)).toBe(true);
    expect(timeInfos(parsed.dlrr().subBlocks())).toEqual(timeInfos(xr.dlrr().subBlocks()));
  });
});
