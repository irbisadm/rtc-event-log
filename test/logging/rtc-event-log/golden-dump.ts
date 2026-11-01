// The port's side of tools/cpp-golden/golden.cc: dumps a parsed log in the
// same JSON shape as the C++ Dump() there (times in microseconds, infinities
// as "inf"/"-inf").

import type {LoggedRtpPacket} from "../../../src/logging/rtc-event-log/events/logged-rtp-rtcp.js";
import {
  type LoggedPacketInfo,
  PacketDirection,
  type ParsedRtcEventLog,
} from "../../../src/logging/rtc-event-log/rtc-event-log-parser.js";
import type {StreamConfig} from "../../../src/logging/rtc-event-log/rtc-stream-config.js";
import type {ReportBlock} from "../../../src/modules/rtp-rtcp/source/rtcp-packet/report-block.js";

type Json = null | boolean | number | string | Json[] | {[key: string]: Json};

const time = (t: number): Json => (t === Infinity ? "inf" : t === -Infinity ? "-inf" : t);
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const opt = <T>(v: T | undefined, f: (v: T) => Json = (x) => x as Json): Json => (v === undefined ? null : f(v));

function config(t: number, c: StreamConfig): Json {
  return {
    t: time(t),
    local_ssrc: c.localSsrc,
    remote_ssrc: c.remoteSsrc,
    rtx_ssrc: c.rtxSsrc,
    extensions: c.rtpExtensions.map((e) => [e.uri, e.id]),
  };
}

function rtp(p: LoggedRtpPacket): Json {
  const h = p.header;
  const e = h.extension;
  const level = e.audioLevel();
  return {
    t: time(p.timestamp),
    marker: h.markerBit,
    pt: h.payloadType,
    seq: h.sequenceNumber,
    ts: h.timestamp,
    ssrc: h.ssrc,
    header_length: h.headerLength,
    padding: h.paddingLength,
    total_length: p.totalLength,
    tseq: e.hasTransportSequenceNumber ? e.transportSequenceNumber : null,
    tto: e.hasTransmissionTimeOffset ? e.transmissionTimeOffset : null,
    abs: e.hasAbsoluteSendTime ? e.absoluteSendTime : null,
    rotation: e.hasVideoRotation ? e.videoRotation : null,
    audio_level: level ? [level.voiceActivity(), level.level()] : null,
    rtx_osn: opt(p.rtxOriginalSequenceNumber),
    dd: hex(p.dependencyDescriptorWireFormat),
  };
}

const reportBlocks = (blocks: readonly ReportBlock[]): Json =>
  blocks.map((b) => [b.sourceSsrc(), b.fractionLost(), b.cumulativeLost(), b.extendedHighSeqNum(), b.jitter(), b.lastSr(), b.delaySinceLastSr()]);

function rtcpBlocks(log: ParsedRtcEventLog, d: PacketDirection): Json {
  return {
    sr: log.senderReports(d).map((e) => ({
      t: time(e.timestamp),
      ssrc: e.sr.senderSsrc(),
      ntp: [e.sr.ntp().seconds(), e.sr.ntp().fractions()],
      rtp_ts: e.sr.rtpTimestamp(),
      packets: e.sr.senderPacketCount(),
      octets: e.sr.senderOctetCount(),
      blocks: reportBlocks(e.sr.reportBlocks()),
    })),
    rr: log.receiverReports(d).map((e) => ({t: time(e.timestamp), ssrc: e.rr.senderSsrc(), blocks: reportBlocks(e.rr.reportBlocks())})),
    xr: log.extendedReports(d).map((e) => {
      const rrtr = e.xr.rrtr();
      const tb = e.xr.targetBitrate();
      return {
        t: time(e.timestamp),
        ssrc: e.xr.senderSsrc(),
        rrtr: rrtr ? [rrtr.ntp().seconds(), rrtr.ntp().fractions()] : null,
        dlrr: e.xr.dlrr().subBlocks().map((i) => [i.ssrc, i.lastRr, i.delaySinceLastRr]),
        target_bitrate: tb ? tb.getTargetBitrates().map((b) => [b.spatialLayer, b.temporalLayer, b.targetBitrateKbps]) : null,
      };
    }),
    remb: log.rembs(d).map((e) => ({t: time(e.timestamp), ssrc: e.remb.senderSsrc(), bitrate: e.remb.bitrateBps(), ssrcs: [...e.remb.ssrcs()]})),
    nack: log.nacks(d).map((e) => ({
      t: time(e.timestamp),
      ssrc: e.nack.senderSsrc(),
      media_ssrc: e.nack.mediaSsrc(),
      ids: [...e.nack.packetIds()],
    })),
    fir: log.firs(d).map((e) => ({t: time(e.timestamp), ssrc: e.fir.senderSsrc(), requests: e.fir.requests().map((r) => [r.ssrc, r.seqNr])})),
    pli: log.plis(d).map((e) => ({t: time(e.timestamp), ssrc: e.pli.senderSsrc(), media_ssrc: e.pli.mediaSsrc()})),
    bye: log.byes(d).map((e) => ({
      t: time(e.timestamp),
      ssrc: e.bye.senderSsrc(),
      csrcs: [...e.bye.csrcs()],
      reason: hex(Uint8Array.from(e.bye.reason(), (c) => c.charCodeAt(0))),
    })),
    transport_feedback: log.transportFeedbacks(d).map((e) => {
      const f = e.transportFeedback;
      return {
        t: time(e.timestamp),
        ssrc: f.senderSsrc(),
        media_ssrc: f.mediaSsrc(),
        base_seq: f.getBaseSequence(),
        status_count: f.getPacketStatusCount(),
        base_time: time(f.baseTime()),
        include_timestamps: f.includeTimestamps(),
        packets: f.getReceivedPackets().map((p) => [p.sequenceNumber(), p.deltaTicks()]),
      };
    }),
    congestion_feedback: log.congestionFeedback(d).map((e) => {
      const f = e.congestionFeedback;
      return {
        t: time(e.timestamp),
        ssrc: f.senderSsrc(),
        ntp: f.reportTimestampCompactNtp(),
        packets: f.packets().map((p) => [p.ssrc, p.sequenceNumber, time(p.arrivalTimeOffset), p.ecn]),
      };
    }),
    loss_notification: log.lossNotifications(d).map((e) => {
      const n = e.lossNotification;
      return {
        t: time(e.timestamp),
        ssrc: n.senderSsrc(),
        media_ssrc: n.mediaSsrc(),
        last_decoded: n.lastDecoded(),
        last_received: n.lastReceived(),
        decodability: n.decodabilityFlag(),
      };
    }),
  };
}

const packetInfos = (infos: readonly LoggedPacketInfo[]): Json =>
  infos.map((p) => ({
    ssrc: p.ssrc,
    seq: p.streamSeqNo,
    size: p.size,
    payload: p.payloadSize,
    padding: p.paddingSize,
    overhead: p.overhead,
    pt: p.payloadType,
    media_type: p.mediaType,
    rtx: p.rtx,
    marker: p.markerBit,
    has_tseq: p.hasTransportSeqNo,
    tseq: p.transportSeqNo,
    last_in_feedback: p.lastInFeedback,
    capture_time: time(p.captureTime),
    log_packet_time: time(p.logPacketTime),
    reported_send_time: time(p.reportedSendTime),
    reported_recv_time: time(p.reportedRecvTime),
    log_feedback_time: time(p.logFeedbackTime),
    feedback_hold_duration: time(p.feedbackHoldDuration),
  }));

export function dump(log: ParsedRtcEventLog): Json {
  return {
    start: log.startLogEvents().map((e) => [time(e.timestamp), time(e.utcStartTime)]),
    stop: log.stopLogEvents().map((e) => time(e.timestamp)),
    audio_recv_configs: log.audioRecvConfigs().map((e) => config(e.timestamp, e.config)),
    audio_send_configs: log.audioSendConfigs().map((e) => config(e.timestamp, e.config)),
    video_recv_configs: log.videoRecvConfigs().map((e) => config(e.timestamp, e.config)),
    video_send_configs: log.videoSendConfigs().map((e) => config(e.timestamp, e.config)),
    alr: log.alrStateEvents().map((e) => [time(e.timestamp), e.inAlr]),
    route_changes: log.routeChangeEvents().map((e) => [time(e.timestamp), e.connected, e.overhead]),
    remote_estimates: log.remoteEstimateEvents().map((e) => [time(e.timestamp), opt(e.linkCapacityLower), opt(e.linkCapacityUpper)]),
    delay_based: log.bweDelayUpdates().map((e) => [time(e.timestamp), e.bitrateBps, e.detectorState]),
    loss_based: log.bweLossUpdates().map((e) => [time(e.timestamp), e.bitrateBps, e.fractionLost, e.expectedPackets]),
    scream: log
      .bweScreamUpdates()
      .map((e) => [time(e.timestamp), e.refWindow, e.dataInFlight, e.targetRate, time(e.smoothedRtt), time(e.avgQueueDelay), e.l4sMarkedPermille]),
    probe_clusters: log.bweProbeClusterCreatedEvents().map((e) => [time(e.timestamp), e.id, e.bitrateBps, e.minPackets, e.minBytes]),
    probe_success: log.bweProbeSuccessEvents().map((e) => [time(e.timestamp), e.id, e.bitrateBps]),
    probe_failure: log.bweProbeFailureEvents().map((e) => [time(e.timestamp), e.id, e.failureReason]),
    dtls_transport: log.dtlsTransportStates().map((e) => [time(e.timestamp), e.dtlsTransportState]),
    dtls_writable: log.dtlsWritableStates().map((e) => [time(e.timestamp), e.writable]),
    ice_configs: log
      .iceCandidatePairConfigs()
      .map((e) => [
        time(e.timestamp),
        e.type,
        e.candidatePairId,
        e.localCandidateType,
        e.localRelayProtocol,
        e.localNetworkType,
        e.localAddressFamily,
        e.remoteCandidateType,
        e.remoteAddressFamily,
        e.candidatePairProtocol,
      ]),
    ice_events: log.iceCandidatePairEvents().map((e) => [time(e.timestamp), e.type, e.candidatePairId, e.transactionId]),
    audio_playout: [...log.audioPlayoutEvents()].map(([ssrc, events]) => [ssrc, events.map((e) => time(e.timestamp))]),
    neteq: [...log.neteqSetMinimumDelayEvents()].map(([ssrc, events]) => [ssrc, events.map((e) => [time(e.timestamp), e.minimumDelayMs])]),
    ana: log.audioNetworkAdaptationEvents().map((e) => {
      const c = e.config;
      return [
        time(e.timestamp),
        opt(c.bitrateBps),
        opt(c.frameLengthMs),
        opt(c.uplinkPacketLossFraction),
        opt(c.enableFec),
        opt(c.enableDtx),
        opt(c.numChannels),
      ];
    }),
    frames: [...log.decodedFrames()].map(([ssrc, frames]) => [
      ssrc,
      frames.map((f) => [time(f.timestamp), Number(f.renderTimeMs), f.ssrc, f.width, f.height, f.codec, f.qp]),
    ]),
    rtp_in: log.incomingRtpPacketsBySsrc().map((s) => [s.ssrc, s.incomingPackets.map((p) => rtp(p.rtp))]),
    rtp_out: log.outgoingRtpPacketsBySsrc().map((s) => [s.ssrc, s.outgoingPackets.map((p) => rtp(p.rtp))]),
    rtcp_in: log.incomingRtcpPackets().map((p) => [time(p.rtcp.timestamp), hex(p.rtcp.rawData)]),
    rtcp_out: log.outgoingRtcpPackets().map((p) => [time(p.rtcp.timestamp), hex(p.rtcp.rawData)]),
    rtcp_blocks_in: rtcpBlocks(log, PacketDirection.kIncomingPacket),
    rtcp_blocks_out: rtcpBlocks(log, PacketDirection.kOutgoingPacket),
    first_timestamp: time(log.firstTimestamp()),
    last_timestamp: time(log.lastTimestamp()),
    first_log_segment: [time(log.firstLogSegment().startTime()), time(log.firstLogSegment().stopTime())],
    packet_infos_in: packetInfos(log.getIncomingPacketInfos()),
    packet_infos_out: packetInfos(log.getOutgoingPacketInfos()),
    ice_log_events: log.getIceEvents().map((e) => [e.candidatePairId, time(e.logTime), e.eventType]),
    route_change_inferred: log.getRouteChanges().map((e) => [e.routeId, time(e.logTime), e.sendOverhead, e.returnOverhead]),
  };
}
