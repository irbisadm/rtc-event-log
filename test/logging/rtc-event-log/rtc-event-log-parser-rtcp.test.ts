// Parser tests for the RTCP block parsing (StoreRtcpBlocks) and the analysis
// helpers built on it: GetPacketInfos and GetIceEvents.

import {EcnMarking} from "../../../src/api/transport/ecn-marking.js";
import {
  IceCandidatePairConfig_AddressFamily as AddressFamily,
  IceCandidatePairConfig_IceCandidatePairConfigType as ConfigType,
  IceCandidatePairConfig_IceCandidateType as CandidateType,
  IceCandidatePairConfig_NetworkType as NetworkType,
  IceCandidatePairConfig_Protocol as Protocol,
  IceCandidatePairEvent_IceCandidatePairEventType as CheckType,
} from "../../../src/gen/rtc_event_log2_pb.js";
import {
  LoggedIceEventType,
  LoggedMediaType,
  PacketDirection,
  ParsedRtcEventLog,
} from "../../../src/logging/rtc-event-log/rtc-event-log-parser.js";
import {Bye} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/bye.js";
import {
  CongestionControlFeedback,
  CongestionControlPacketInfo,
} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/congestion-control-feedback.js";
import {ReceiveTimeInfo} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/dlrr.js";
import {ExtendedReports} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/extended-reports.js";
import {Fir} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/fir.js";
import {LossNotification} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/loss-notification.js";
import {Nack} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/nack.js";
import {Pli} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/pli.js";
import {Remb} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/remb.js";
import {ReportBlock} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/report-block.js";
import type {RtcpPacket} from "../../../src/modules/rtp-rtcp/source/rtcp-packet.js";
import {SenderReport} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/sender-report.js";
import {TransportFeedback} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/transport-feedback.js";
import {NtpTime} from "../../../src/system-wrappers/include/ntp-time.js";
import {
  concatBytes,
  eventStreamBytes,
  incomingRtcpBatch,
  outgoingRtcpBatch,
  outgoingRtpBatch,
  type RtpPacketSpec,
} from "./new-format-builder.js";

const compound = (...packets: RtcpPacket[]) => concatBytes(...packets.map((p) => p.build()));

function parse(log: Uint8Array): ParsedRtcEventLog {
  const parsed = new ParsedRtcEventLog();
  const status = parsed.parseString(log);
  if (!status.ok()) throw new Error(status.message());
  return parsed;
}

describe("RTCP blocks", () => {
  test("CompoundPacketIsSplitIntoBlocks", () => {
    const sr = new SenderReport();
    sr.setSenderSsrc(0x1111);
    sr.setNtp(new NtpTime(10, 20));
    const rb = new ReportBlock();
    rb.setMediaSsrc(0x2222);
    rb.setFractionLost(12);
    sr.addReportBlock(rb);
    const remb = new Remb();
    remb.setBitrateBps(1_500_000);
    remb.setSsrcs([0x2222]);
    const nack = new Nack();
    nack.setMediaSsrc(0x2222);
    nack.setPacketIds([5, 7, 30]);
    const pli = new Pli();
    pli.setMediaSsrc(0x2222);
    const fir = new Fir();
    fir.addRequestTo(0x2222, 3);
    const xr = new ExtendedReports();
    xr.addDlrrItem(new ReceiveTimeInfo(0x2222, 1, 2));
    const lntf = new LossNotification();
    expect(lntf.set(100, 110, true)).toBe(true);
    const bye = new Bye();
    bye.setSenderSsrc(0x1111);
    const twcc = new TransportFeedback();
    twcc.setBase(1, 1_000_000);
    twcc.addReceivedPacket(1, 1_000_000);
    twcc.addReceivedPacket(3, 1_004_000);
    const ccfb = new CongestionControlFeedback([new CongestionControlPacketInfo(0x2222, 9, 1000, EcnMarking.kEct1)], 0x10000);

    const packet = compound(sr, remb, nack, pli, fir, xr, lntf, bye, twcc, ccfb);
    const parsed = parse(
      concatBytes(incomingRtcpBatch([{timestampMs: 500, packet}]), outgoingRtcpBatch([{timestampMs: 600, packet: compound(pli)}])),
    );

    const IN = PacketDirection.kIncomingPacket;
    expect(parsed.senderReports(IN)).toHaveLength(1);
    expect(parsed.senderReports(IN)[0].logTimeMs()).toBe(500);
    expect(parsed.senderReports(IN)[0].sr.ntp().seconds()).toBe(10);
    expect(parsed.senderReports(IN)[0].sr.reportBlocks()[0].fractionLost()).toBe(12);
    expect(parsed.receiverReports(IN)).toHaveLength(0);
    expect(parsed.rembs(IN)[0].remb.bitrateBps()).toBe(1_500_000);
    expect(parsed.nacks(IN)[0].nack.packetIds()).toEqual([5, 7, 30]);
    expect(parsed.plis(IN)[0].pli.mediaSsrc()).toBe(0x2222);
    expect(parsed.firs(IN)[0].fir.requests()[0].seqNr).toBe(3);
    expect(parsed.extendedReports(IN)[0].xr.dlrr().subBlocks()[0].lastRr).toBe(1);
    expect(parsed.lossNotifications(IN)[0].lossNotification.lastReceived()).toBe(110);
    expect(parsed.byes(IN)[0].bye.senderSsrc()).toBe(0x1111);
    const feedback = parsed.transportFeedbacks(IN)[0].transportFeedback;
    expect(feedback.getReceivedPackets().map((p) => p.sequenceNumber())).toEqual([1, 3]);
    expect(feedback.getPacketStatusCount()).toBe(3);
    const cc = parsed.congestionFeedback(IN)[0].congestionFeedback;
    expect(cc.packets().map((p) => [p.ssrc, p.sequenceNumber, p.ecn])).toEqual([[0x2222, 9, EcnMarking.kEct1]]);

    const OUT = PacketDirection.kOutgoingPacket;
    expect(parsed.plis(OUT)).toHaveLength(1);
    expect(parsed.plis(OUT)[0].logTimeMs()).toBe(600);
    expect(parsed.senderReports(OUT)).toHaveLength(0);
  });

  test("InvalidRtcpFailsTheParse", () => {
    const status = new ParsedRtcEventLog().parseString(incomingRtcpBatch([{timestampMs: 1, packet: Uint8Array.from([1, 2, 3, 4])}]));
    expect(status.message()).toBe("header.Parse(block, packet_end - block)");
  });

  test("MalformedBlockFailsTheParse", () => {
    // An SR too short for its sender info.
    const status = new ParsedRtcEventLog().parseString(
      incomingRtcpBatch([{timestampMs: 1, packet: Uint8Array.from([0x80, 200, 0x00, 0x01, 0, 0, 0, 1])}]),
    );
    expect(status.message()).toBe("parsed_block.sr.Parse(header)");
  });
});

describe("GetPacketInfos", () => {
  const videoConfig = eventStreamBytes({videoSendStreamConfigs: [{timestampMs: 1n, ssrc: 1, rtxSsrc: 2}]});
  const rtp = (timestampMs: number, seq: number, extra: Partial<RtpPacketSpec>): RtpPacketSpec => ({
    timestampMs,
    payloadType: 96,
    sequenceNumber: seq,
    rtpTimestamp: 9000 * seq,
    ssrc: 1,
    payloadSize: 1000,
    headerSize: 24,
    paddingSize: 0,
    ...extra,
  });

  test("TransportWideFeedback", () => {
    const packets = [10, 11, 12, 13].map((tseq, i) => rtp(100 + 10 * i, i, {transportSequenceNumber: tseq, absoluteSendTime: 1 << 18}));
    const twcc = new TransportFeedback();
    twcc.setBase(10, 1_000_000);
    twcc.addReceivedPacket(10, 1_000_000);
    twcc.addReceivedPacket(11, 1_005_000);
    twcc.addReceivedPacket(13, 1_020_000);
    const parsed = parse(concatBytes(videoConfig, outgoingRtpBatch(packets), incomingRtcpBatch([{timestampMs: 150, packet: twcc.build()}])));

    const infos = parsed.getOutgoingPacketInfos();
    expect(infos.map((p) => p.transportSeqNo)).toEqual([10, 11, 12, 13]);
    expect(infos.every((p) => p.mediaType === LoggedMediaType.kVideo && !p.rtx && p.overhead === 38)).toBe(true);
    expect(infos[0].size).toBe(1024);
    expect(infos[0].payloadSize).toBe(1000);
    expect(infos[0].reportedSendTime).toBe(1_000_000); // abs-send-time of 1 s
    expect(infos[1].captureTime - infos[0].captureTime).toBe(100_000); // 9000 ticks at 90 kHz
    // The first feedback's base is its log time; 40 ms after the base time
    // for the first packet.
    expect(infos.map((p) => p.reportedRecvTime)).toEqual([190_000, 195_000, Infinity, 210_000]);
    expect(infos.map((p) => p.logFeedbackTime)).toEqual([150_000, 150_000, 150_000, 150_000]);
    expect(infos.map((p) => p.lastInFeedback)).toEqual([false, false, false, true]);
    expect(infos.map((p) => p.feedbackHoldDuration)).toEqual([20_000, 15_000, -Infinity, 0]);

    // No feedback for incoming packets in this log.
    expect(parsed.getIncomingPacketInfos()).toHaveLength(0);
  });

  test("CongestionControlFeedback", () => {
    const packets = [rtp(100, 100, {ssrc: 5}), rtp(110, 101, {ssrc: 5})];
    const ccfb = new CongestionControlFeedback(
      [new CongestionControlPacketInfo(5, 100, 30_000), new CongestionControlPacketInfo(5, 101, -Infinity)],
      0x10000,
    );
    const parsed = parse(concatBytes(outgoingRtpBatch(packets), incomingRtcpBatch([{timestampMs: 200, packet: ccfb.build()}])));

    const infos = parsed.getOutgoingPacketInfos();
    expect(infos.map((p) => p.streamSeqNo)).toEqual([100, 101]);
    expect(infos[0].mediaType).toBe(LoggedMediaType.kUnknown);
    // 30 ms is sent as 30/1024 s.
    const ato = Math.trunc((30 * 1_000_000) / 1024);
    expect(infos[0].feedbackHoldDuration).toBe(ato);
    expect(infos[0].reportedRecvTime).toBe(200_000 - ato);
    expect(infos[0].logFeedbackTime).toBe(200_000);
    expect(infos[1].reportedRecvTime).toBe(Infinity);
    expect(infos[1].logFeedbackTime).toBe(200_000);
  });
});

describe("GetIceEvents", () => {
  const config = (timestampMs: bigint, id: number, type: ConfigType) =>
    eventStreamBytes({
      iceCandidateConfigs: [
        {
          timestampMs,
          configType: type,
          candidatePairId: id,
          localCandidateType: CandidateType.LOCAL,
          localRelayProtocol: Protocol.UDP,
          localNetworkType: NetworkType.ETHERNET,
          localAddressFamily: AddressFamily.IPV4,
          remoteCandidateType: CandidateType.STUN,
          remoteAddressFamily: AddressFamily.IPV4,
          candidatePairProtocol: Protocol.UDP,
        },
      ],
    });
  const check = (timestampMs: bigint, id: number, type: CheckType) =>
    eventStreamBytes({iceCandidateEvents: [{timestampMs, eventType: type, candidatePairId: id}]});

  test("ChecksAndConfigsMergedInTimeOrder", () => {
    const parsed = parse(
      concatBytes(
        config(1n, 7, ConfigType.ADDED),
        check(2n, 7, CheckType.CHECK_SENT),
        check(3n, 7, CheckType.CHECK_RESPONSE_RECEIVED),
        config(3n, 7, ConfigType.SELECTED),
      ),
    );
    // At equal times configs (IceCondidateConfig) come before checks.
    expect(parsed.getIceEvents().map((e) => [e.logTime / 1000, e.eventType])).toEqual([
      [1, LoggedIceEventType.kAdded],
      [2, LoggedIceEventType.kCheckSent],
      [3, LoggedIceEventType.kSelected],
      [3, LoggedIceEventType.kCheckResponseReceived],
    ]);
  });
});
