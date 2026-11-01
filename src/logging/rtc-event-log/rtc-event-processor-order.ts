// Port of logging/rtc_event_log/rtc_event_processor_order.h @ M154.
//
// The C++ TieBreaker<T> specializations become the TypeOrder values and the
// two direction-dependent helpers below; events without a transport sequence
// number use no accessor.

import type {LoggedRtpPacket} from "./events/logged-rtp-rtcp.js";

export enum TypeOrder {
  Start,
  // Connectivity and stream configurations before incoming packets
  StreamConfig,
  IceCondidateConfig,
  IceCandidateEvent,
  DtlsTransportState,
  DtlsWritable,
  RouteChange,
  // Incoming packets
  RtpIn,
  RtcpIn,
  GenericPacketIn,
  GenericAckIn,
  // BWE depends on incoming feedback (send side estimation)
  // or incoming media packets (receive side estimation).
  // Delay-based BWE depends on probe results.
  // Loss-based BWE depends on delay-based BWE.
  // Loss-based BWE may trigger new probes.
  BweRemoteEstimate,
  BweProbeFailure,
  BweProbeSuccess,
  BweDelayBased,
  BweLossBased,
  BweProbeCreated,
  BweScream,
  // General processing events. No obvious order.
  AudioNetworkAdaptation,
  NetEqSetMinDelay,
  AudioPlayout,
  FrameDecoded,
  // Outgoing packets and feedback depends on BWE and might depend on
  // processing.
  RtpOut,
  RtcpOut,
  GenericPacketOut,
  // Alr is updated after a packet is sent.
  AlrState,
  Stop,
}

// `direction` is a PacketDirection (rtc-event-log-parser.ts): 0 = incoming.

// TieBreaker<LoggedRtpPacket> / <LoggedPacketInfo>::type_order(direction).
export function rtpTypeOrder(direction: number): number {
  return direction === 0 ? TypeOrder.RtpIn : TypeOrder.RtpOut;
}

// TieBreaker<LoggedRtcp*>::type_order(direction) for the parsed RTCP blocks.
export function rtcpTypeOrder(direction: number): number {
  return direction === 0 ? TypeOrder.RtcpIn : TypeOrder.RtcpOut;
}

// TieBreaker<LoggedRtpPacket>::transport_seq_num_accessor.
export function rtpTransportSeqNum(p: LoggedRtpPacket): number | undefined {
  return p.header.extension.hasTransportSequenceNumber ? p.header.extension.transportSequenceNumber : undefined;
}
