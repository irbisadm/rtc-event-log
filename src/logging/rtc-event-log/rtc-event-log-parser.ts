// Port of logging/rtc_event_log/rtc_event_log_parser.h @ M154.
//
// Status of the port: the legacy, new (protobuf) and v3
// formats, including the parsed RTCP blocks. As upstream, the v3 format only
// yields the events whose v3 parser is implemented (begin/end log, ALR state,
// audio playout, delay-based BWE updates).

import {create, type DescMessage, fromBinary, type MessageShape} from "@bufbuild/protobuf";
import {RtcEventType} from "../../api/rtc-event-log/rtc-event.js";

import * as rtclog from "../../gen/rtc_event_log_pb.js";
import {RtpHeaderExtensionMap} from "../../modules/rtp-rtcp/include/rtp-header-extension-map.js";
import {RtpPacketReceived} from "../../modules/rtp-rtcp/source/rtp-packet-received.js";
import {RtcpMode} from "../../api/rtp-headers.js";
import {StreamConfig, StreamConfigCodec} from "./rtc-stream-config.js";
import {RtcEventLogParseStatusOr} from "./events/rtc-event-log-parse-status.js";

import {IceCandidateType} from "../../api/candidate.js";
import {DtlsTransportState} from "../../api/dtls-transport-interface.js";
import {AudioLevel, RTPHeader} from "../../api/rtp-headers.js";
import {TimeDelta} from "../../api/units/time-delta.js";
import {Bye} from "../../modules/rtp-rtcp/source/rtcp-packet/bye.js";
import {CommonHeader} from "../../modules/rtp-rtcp/source/rtcp-packet/common-header.js";
import {CongestionControlFeedback} from "../../modules/rtp-rtcp/source/rtcp-packet/congestion-control-feedback.js";
import {ExtendedReports} from "../../modules/rtp-rtcp/source/rtcp-packet/extended-reports.js";
import {Fir} from "../../modules/rtp-rtcp/source/rtcp-packet/fir.js";
import {Nack} from "../../modules/rtp-rtcp/source/rtcp-packet/nack.js";
import {Pli} from "../../modules/rtp-rtcp/source/rtcp-packet/pli.js";
import {Psfb} from "../../modules/rtp-rtcp/source/rtcp-packet/psfb.js";
import {ReceiverReport} from "../../modules/rtp-rtcp/source/rtcp-packet/receiver-report.js";
import {Rtpfb} from "../../modules/rtp-rtcp/source/rtcp-packet/rtpfb.js";
import {SenderReport} from "../../modules/rtp-rtcp/source/rtcp-packet/sender-report.js";
import {TransportFeedback} from "../../modules/rtp-rtcp/source/rtcp-packet/transport-feedback.js";
import {compactNtpIntervalToTimeDelta} from "../../modules/rtp-rtcp/source/ntp-time-util.js";
import {RtpSequenceNumberUnwrapper, RtpTimestampUnwrapper} from "../../rtc-base/numerics/sequence-number-unwrapper.js";
import {RtpExtension} from "../../api/rtp-parameters.js";
import {VideoCodecType} from "../../api/video/video-codec-type.js";
import {AudioEncoderRuntimeConfig} from "../../modules/audio-coding/audio-network-adaptor/include/audio-network-adaptor-config.js";
import {BandwidthUsage} from "../../api/transport/bandwidth-usage.js";
import {DataRate} from "../../api/units/data-rate.js";
import {Timestamp} from "../../api/units/timestamp.js";
import {
  type AlrState,
  AlrStateSchema,
  type AudioNetworkAdaptations,
  AudioNetworkAdaptationsSchema,
  type AudioPlayoutEvents,
  AudioPlayoutEventsSchema,
  type AudioRecvStreamConfig,
  AudioRecvStreamConfigSchema,
  type AudioSendStreamConfig,
  AudioSendStreamConfigSchema,
  type DtlsTransportStateEvent,
  DtlsTransportStateEvent_DtlsTransportState,
  DtlsTransportStateEventSchema,
  type DtlsWritableState,
  DtlsWritableStateSchema,
  type FrameDecodedEvents,
  FrameDecodedEvents_Codec,
  FrameDecodedEventsSchema,
  type IceCandidatePairConfig,
  IceCandidatePairConfig_AddressFamily,
  IceCandidatePairConfig_IceCandidatePairConfigType,
  IceCandidatePairConfig_IceCandidateType,
  IceCandidatePairConfig_NetworkType,
  IceCandidatePairConfig_Protocol,
  IceCandidatePairConfigSchema,
  type IceCandidatePairEvent,
  IceCandidatePairEvent_IceCandidatePairEventType,
  IceCandidatePairEventSchema,
  type NetEqSetMinimumDelay,
  NetEqSetMinimumDelaySchema,
  type RtpHeaderExtensionConfig,
  RtpHeaderExtensionConfigSchema,
  type VideoRecvStreamConfig,
  VideoRecvStreamConfigSchema,
  type VideoSendStreamConfig,
  VideoSendStreamConfigSchema,
  type BeginLogEvent,
  BeginLogEventSchema,
  type BweProbeCluster,
  BweProbeClusterSchema,
  type BweProbeResultFailure,
  BweProbeResultFailure_FailureReason,
  BweProbeResultFailureSchema,
  type BweProbeResultSuccess,
  BweProbeResultSuccessSchema,
  type DelayBasedBweUpdates,
  DelayBasedBweUpdates_DetectorState,
  DelayBasedBweUpdatesSchema,
  type EndLogEvent,
  EndLogEventSchema,
  type EventStream,
  EventStreamSchema,
  type LossBasedBweUpdates,
  LossBasedBweUpdatesSchema,
  type RemoteEstimates,
  RemoteEstimatesSchema,
  type RouteChange,
  RouteChangeSchema,
  type ScreamBweUpdates,
  ScreamBweUpdatesSchema,
  type IncomingRtcpPackets,
  IncomingRtcpPacketsSchema,
  type IncomingRtpPackets,
  IncomingRtpPacketsSchema,
  type OutgoingRtcpPackets,
  OutgoingRtcpPacketsSchema,
  type OutgoingRtpPackets,
  OutgoingRtpPacketsSchema,
} from "../../gen/rtc_event_log2_pb.js";
import {has} from "../../proto/presence.js";
import {convertCVOByteToVideoRotation} from "../../modules/rtp-rtcp/include/rtp-cvo.js";
import {RtcEventLogDependencyDescriptorEncoderDecoder} from "./dependency-descriptor-encoder-decoder.js";
import {decodeBlobs} from "./encoder/blob-encoding.js";
import {decodeDeltas, type OptionalU64} from "./encoder/delta-encoding.js";
import {
  parsePacketLossFractionFromProtoFormat,
  toSigned,
  toUnsigned,
} from "./encoder/rtc-event-log-encoder-common.js";
import {decodeVarInt} from "./encoder/var-int.js";
import {
  LoggedRtcpCongestionControlFeedback,
  LoggedRtcpPacketBye,
  LoggedRtcpPacketExtendedReports,
  LoggedRtcpPacketFir,
  LoggedRtcpPacketIncoming,
  LoggedRtcpPacketLossNotification,
  LoggedRtcpPacketNack,
  LoggedRtcpPacketOutgoing,
  LoggedRtcpPacketPli,
  LoggedRtcpPacketReceiverReport,
  LoggedRtcpPacketRemb,
  LoggedRtcpPacketSenderReport,
  LoggedRtcpPacketTransportFeedback,
  type LoggedRtpPacket,
  LoggedRtpPacketIncoming,
  LoggedRtpPacketOutgoing,
} from "./events/logged-rtp-rtcp.js";
import {RtcEventProcessor} from "./rtc-event-processor.js";
import {rtcpTypeOrder, rtpTransportSeqNum, rtpTypeOrder, TypeOrder} from "./rtc-event-processor-order.js";
import {LoggedAlrStateEvent, RtcEventAlrState} from "./events/rtc-event-alr-state.js";
import {LoggedAudioNetworkAdaptationEvent} from "./events/rtc-event-audio-network-adaptation.js";
import {LoggedAudioPlayoutEvent, RtcEventAudioPlayout} from "./events/rtc-event-audio-playout.js";
import {LoggedAudioRecvConfig} from "./events/rtc-event-audio-receive-stream-config.js";
import {LoggedAudioSendConfig} from "./events/rtc-event-audio-send-stream-config.js";
import {LoggedDtlsTransportState} from "./events/rtc-event-dtls-transport-state.js";
import {LoggedDtlsWritableState} from "./events/rtc-event-dtls-writable-state.js";
import {LoggedFrameDecoded} from "./events/rtc-event-frame-decoded.js";
import {
  IceCandidateNetworkType,
  IceCandidatePairAddressFamily,
  IceCandidatePairConfigType,
  IceCandidatePairProtocol,
  LoggedIceCandidatePairConfig,
} from "./events/rtc-event-ice-candidate-pair-config.js";
import {IceCandidatePairEventType, LoggedIceCandidatePairEvent} from "./events/rtc-event-ice-candidate-pair.js";
import {LoggedNetEqSetMinimumDelayEvent} from "./events/rtc-event-neteq-set-minimum-delay.js";
import {LoggedVideoRecvConfig} from "./events/rtc-event-video-receive-stream-config.js";
import {LoggedVideoSendConfig} from "./events/rtc-event-video-send-stream-config.js";
import {LoggedStartEvent, RtcEventBeginLog} from "./events/rtc-event-begin-log.js";
import {LoggedBweDelayBasedUpdate, RtcEventBweUpdateDelayBased} from "./events/rtc-event-bwe-update-delay-based.js";
import {LoggedBweLossBasedUpdate} from "./events/rtc-event-bwe-update-loss-based.js";
import {LoggedBweScreamUpdate} from "./events/rtc-event-bwe-update-scream.js";
import {LoggedStopEvent, RtcEventEndLog} from "./events/rtc-event-end-log.js";
import {LoggedBweProbeClusterCreatedEvent} from "./events/rtc-event-probe-cluster-created.js";
import {LoggedBweProbeFailureEvent, ProbeFailureReason} from "./events/rtc-event-probe-result-failure.js";
import {LoggedBweProbeSuccessEvent} from "./events/rtc-event-probe-result-success.js";
import {LoggedRemoteEstimateEvent} from "./events/rtc-event-remote-estimate.js";
import {LoggedRouteChangeEvent} from "./events/rtc-event-route-change.js";
import {RtcEventLogParseStatus} from "./events/rtc-event-log-parse-status.js";

export type ParseStatus = RtcEventLogParseStatus;
const ParseStatus = RtcEventLogParseStatus;

const kIpv4Overhead = 20;
const kIpv6Overhead = 40;
const kUdpOverhead = 8;
const kSrtpOverhead = 10;
const kStunOverhead = 4;
const kDefaultOverhead = kUdpOverhead + kSrtpOverhead + kIpv4Overhead;

const kIncompleteLogError = "Could not parse the entire log. Only the beginning will be used.";


const kU8Max = 0xffn;
const kU16Max = 0xffffn;
const kU32Max = 0xffffffffn;
const kI32Max = 0x7fffffffn;

export enum PacketDirection {
  kIncomingPacket = 0,
  kOutgoingPacket,
}

export enum LoggedMediaType {
  kUnknown,
  kAudio,
  kVideo,
}

export enum MediaType {
  ANY,
  AUDIO,
  VIDEO,
  DATA,
}

export enum UnconfiguredHeaderExtensions {
  kDontParse,
  kAttemptWebrtcDefaultConfig,
}

export class LoggedRtpStreamIncoming {
  ssrc = 0;
  incomingPackets: LoggedRtpPacketIncoming[] = [];
}

export class LoggedRtpStreamOutgoing {
  ssrc = 0;
  outgoingPackets: LoggedRtpPacketOutgoing[] = [];
}

// Direction-independent view of the RTP packets of one SSRC.
export class LoggedRtpStreamView {
  constructor(
    public ssrc: number,
    public packetView: LoggedRtpPacket[],
  ) {}
}

export class LogSegment {
  constructor(
    private readonly startTimeUsValue: number,
    private readonly stopTimeUsValue: number,
  ) {}

  startTime(): Timestamp {
    return Timestamp.micros(this.startTimeUsValue);
  }
  startTimeMs(): number {
    return Math.trunc(this.startTimeUsValue / 1000);
  }
  startTimeUs(): number {
    return this.startTimeUsValue;
  }
  stopTime(): Timestamp {
    return Timestamp.micros(this.stopTimeUsValue);
  }
  stopTimeMs(): number {
    return Math.trunc(this.stopTimeUsValue / 1000);
  }
  stopTimeUs(): number {
    return this.stopTimeUsValue;
  }
}

export class LoggedPacketInfo {
  ssrc: number;
  // The RTP header sequence number.
  streamSeqNo: number;
  size: number; // uint16_t
  payloadSize: number; // uint16_t
  paddingSize: number; // uint16_t
  overhead = 0;
  payloadType: number;
  mediaType: LoggedMediaType = LoggedMediaType.kUnknown;
  rtx = false;
  markerBit = false;
  hasTransportSeqNo = false;
  lastInFeedback = false;
  transportSeqNo = 0;
  // The RTP header timestamp unwrapped and converted from tick count to seconds
  // based timestamp.
  captureTime: Timestamp;
  // The time the packet was logged. This is the receive time for incoming
  // packets and send time for outgoing.
  logPacketTime: Timestamp;
  // Send time as reported by abs-send-time extension, For outgoing packets this
  // corresponds to log_packet_time, but might be measured using another clock.
  reportedSendTime: Timestamp;
  // The receive time that was reported in feedback. For incoming packets this
  // corresponds to log_packet_time, but might be measured using another clock.
  // PlusInfinity indicates that the packet was lost.
  reportedRecvTime: Timestamp = Timestamp.minusInfinity();
  // The time feedback message was logged. This is the feedback send time for
  // incoming packets and feedback receive time for outgoing.
  // PlusInfinity indicates that feedback was expected but not received.
  logFeedbackTime: Timestamp = Timestamp.minusInfinity();
  // The delay between receiving an RTP packet and sending feedback for
  // incoming packets. For outgoing packets we don't know the feedback send
  // time, and this is instead calculated as the difference in reported receive
  // time between this packet and the last packet in the same feedback message.
  feedbackHoldDuration: TimeDelta = -Infinity;

  constructor(rtp: LoggedRtpPacket, mediaType: LoggedMediaType, rtx: boolean, captureTime: Timestamp) {
    this.ssrc = rtp.header.ssrc;
    this.streamSeqNo = rtp.header.sequenceNumber;
    this.size = rtp.totalLength & 0xffff;
    this.payloadSize = (rtp.totalLength - rtp.header.paddingLength - rtp.header.headerLength) & 0xffff;
    this.paddingSize = rtp.header.paddingLength & 0xffff;
    this.payloadType = rtp.header.payloadType;
    this.mediaType = mediaType;
    this.rtx = rtx;
    this.markerBit = rtp.header.markerBit;
    this.hasTransportSeqNo = rtp.header.extension.hasTransportSequenceNumber;
    this.transportSeqNo = this.hasTransportSeqNo ? rtp.header.extension.transportSequenceNumber : 0;
    this.captureTime = captureTime;
    this.logPacketTime = Timestamp.micros(rtp.logTimeUs());
    this.reportedSendTime = rtp.header.extension.hasAbsoluteSendTime
      ? rtp.header.extension.getAbsoluteSendTimestamp()
      : Timestamp.minusInfinity();
  }

  logTimeMs(): number {
    return Timestamp.ms(this.logPacketTime);
  }
  logTimeUs(): number {
    return Timestamp.us(this.logPacketTime);
  }
}

export enum LoggedIceEventType {
  kAdded,
  kUpdated,
  kDestroyed,
  kSelected,
  kCheckSent,
  kCheckReceived,
  kCheckResponseSent,
  kCheckResponseReceived,
}

export class LoggedIceEvent {
  constructor(
    public candidatePairId: number,
    public logTime: Timestamp,
    public eventType: LoggedIceEventType,
  ) {}
}

export class InferredRouteChangeEvent {
  routeId = 0;
  logTime: Timestamp = Timestamp.minusInfinity();
  sendOverhead = 0;
  returnOverhead = 0;

  logTimeMs(): number {
    return Timestamp.ms(this.logTime);
  }
  logTimeUs(): number {
    return Timestamp.us(this.logTime);
  }
}

interface HasLogTime {
  logTime(): Timestamp;
}

// int64_t max, the "no value" marker of the log segment computation.
const kInt64Max = Number.POSITIVE_INFINITY;

function identicalRtcpContents(lastRtcp: Uint8Array, newRtcp: Uint8Array): boolean {
  if (lastRtcp.length !== newRtcp.length) return false;
  for (let i = 0; i < newRtcp.length; ++i) {
    if (lastRtcp[i] !== newRtcp[i]) return false;
  }
  return true;
}

function check(condition: boolean, message: string): ParseStatus | null {
  return condition ? null : ParseStatus.error(message);
}

// DecodeDeltas + RTC_PARSE_CHECK_OR_RETURN_EQ(values.size(), number_of_deltas).
function decodeField(name: string, deltas: Uint8Array, base: OptionalU64, numberOfDeltas: number): OptionalU64[] | ParseStatus {
  const values = decodeDeltas(deltas, base, numberOfDeltas);
  if (values.length !== numberOfDeltas) {
    return ParseStatus.error(`${name}_values.size()==number_of_deltas`);
  }
  return values;
}

// RTC_PARSE_CHECK_OR_RETURN(values[i].has_value()) and, for timestamps,
// ToSigned<int64_t>.
function deltaTimestampMs(values: OptionalU64[], i: number): bigint | ParseStatus {
  const value = values[i];
  if (value === undefined) return ParseStatus.error("timestamp_ms_values[i].has_value()");
  const timestampMs = toSigned(value, 64);
  if (timestampMs === undefined) return ParseStatus.error("ToSigned(timestamp_ms_values[i].value(), &timestamp_ms)");
  return timestampMs;
}

// has_value() and RTC_PARSE_CHECK_OR_RETURN_LE(value, uint32 max).
function deltaU32(name: string, values: OptionalU64[], i: number): number | ParseStatus {
  const value = values[i];
  if (value === undefined) return ParseStatus.error(`${name}_values[i].has_value()`);
  if (value > kU32Max) return ParseStatus.error(`${name}_values[i].value()<=std::numeric_limits<uint32_t>::max()`);
  return Number(value);
}

const asInt32 = (v: number): number => v | 0;

export function getRuntimeDetectorState(detectorState: DelayBasedBweUpdates_DetectorState): BandwidthUsage {
  switch (detectorState) {
    case DelayBasedBweUpdates_DetectorState.BWE_NORMAL:
      return BandwidthUsage.kBwNormal;
    case DelayBasedBweUpdates_DetectorState.BWE_UNDERUSING:
      return BandwidthUsage.kBwUnderusing;
    case DelayBasedBweUpdates_DetectorState.BWE_OVERUSING:
      return BandwidthUsage.kBwOverusing;
    default:
      // BWE_UNKNOWN_STATE (RTC_DCHECK_NOTREACHED in upstream).
      return BandwidthUsage.kBwNormal;
  }
}

export function getRuntimeProbeFailureReason(failure: BweProbeResultFailure_FailureReason): ProbeFailureReason {
  switch (failure) {
    case BweProbeResultFailure_FailureReason.INVALID_SEND_RECEIVE_INTERVAL:
      return ProbeFailureReason.kInvalidSendReceiveInterval;
    case BweProbeResultFailure_FailureReason.INVALID_SEND_RECEIVE_RATIO:
      return ProbeFailureReason.kInvalidSendReceiveRatio;
    case BweProbeResultFailure_FailureReason.TIMEOUT:
      return ProbeFailureReason.kTimeout;
    default:
      // UNKNOWN (RTC_DCHECK_NOTREACHED in upstream).
      return ProbeFailureReason.kTimeout;
  }
}

export function getRuntimeDtlsTransportState(state: DtlsTransportStateEvent_DtlsTransportState): DtlsTransportState {
  switch (state) {
    case DtlsTransportStateEvent_DtlsTransportState.DTLS_TRANSPORT_NEW:
      return DtlsTransportState.kNew;
    case DtlsTransportStateEvent_DtlsTransportState.DTLS_TRANSPORT_CONNECTING:
      return DtlsTransportState.kConnecting;
    case DtlsTransportStateEvent_DtlsTransportState.DTLS_TRANSPORT_CONNECTED:
      return DtlsTransportState.kConnected;
    case DtlsTransportStateEvent_DtlsTransportState.DTLS_TRANSPORT_CLOSED:
      return DtlsTransportState.kClosed;
    case DtlsTransportStateEvent_DtlsTransportState.DTLS_TRANSPORT_FAILED:
      return DtlsTransportState.kFailed;
    default:
      // UNKNOWN_DTLS_TRANSPORT_STATE (RTC_DCHECK_NOTREACHED in upstream).
      return DtlsTransportState.kNumValues;
  }
}

export function getRuntimeIceCandidatePairConfigType(
  type: IceCandidatePairConfig_IceCandidatePairConfigType,
): IceCandidatePairConfigType {
  switch (type) {
    case IceCandidatePairConfig_IceCandidatePairConfigType.ADDED:
      return IceCandidatePairConfigType.kAdded;
    case IceCandidatePairConfig_IceCandidatePairConfigType.UPDATED:
      return IceCandidatePairConfigType.kUpdated;
    case IceCandidatePairConfig_IceCandidatePairConfigType.DESTROYED:
      return IceCandidatePairConfigType.kDestroyed;
    case IceCandidatePairConfig_IceCandidatePairConfigType.SELECTED:
      return IceCandidatePairConfigType.kSelected;
    default:
      // UNKNOWN_CONFIG_TYPE (RTC_DCHECK_NOTREACHED in upstream).
      return IceCandidatePairConfigType.kAdded;
  }
}

// The bool-returning overload: undefined for types without a runtime
// equivalent (the parser rejects those).
export function getRuntimeIceCandidateType(type: IceCandidatePairConfig_IceCandidateType): IceCandidateType | undefined {
  switch (type) {
    case IceCandidatePairConfig_IceCandidateType.LOCAL:
      return IceCandidateType.kHost;
    case IceCandidatePairConfig_IceCandidateType.STUN:
      return IceCandidateType.kSrflx;
    case IceCandidatePairConfig_IceCandidateType.PRFLX:
      return IceCandidateType.kPrflx;
    case IceCandidatePairConfig_IceCandidateType.RELAY:
      return IceCandidateType.kRelay;
    default:
      return undefined;
  }
}

export function getRuntimeIceCandidatePairProtocol(protocol: IceCandidatePairConfig_Protocol): IceCandidatePairProtocol {
  switch (protocol) {
    case IceCandidatePairConfig_Protocol.UDP:
      return IceCandidatePairProtocol.kUdp;
    case IceCandidatePairConfig_Protocol.TCP:
      return IceCandidatePairProtocol.kTcp;
    case IceCandidatePairConfig_Protocol.SSLTCP:
      return IceCandidatePairProtocol.kSsltcp;
    case IceCandidatePairConfig_Protocol.TLS:
      return IceCandidatePairProtocol.kTls;
    default:
      return IceCandidatePairProtocol.kUnknown;
  }
}

export function getRuntimeIceCandidatePairAddressFamily(
  addressFamily: IceCandidatePairConfig_AddressFamily,
): IceCandidatePairAddressFamily {
  switch (addressFamily) {
    case IceCandidatePairConfig_AddressFamily.IPV4:
      return IceCandidatePairAddressFamily.kIpv4;
    case IceCandidatePairConfig_AddressFamily.IPV6:
      return IceCandidatePairAddressFamily.kIpv6;
    default:
      return IceCandidatePairAddressFamily.kUnknown;
  }
}

export function getRuntimeIceCandidateNetworkType(networkType: IceCandidatePairConfig_NetworkType): IceCandidateNetworkType {
  switch (networkType) {
    case IceCandidatePairConfig_NetworkType.ETHERNET:
      return IceCandidateNetworkType.kEthernet;
    case IceCandidatePairConfig_NetworkType.LOOPBACK:
      return IceCandidateNetworkType.kLoopback;
    case IceCandidatePairConfig_NetworkType.WIFI:
      return IceCandidateNetworkType.kWifi;
    case IceCandidatePairConfig_NetworkType.VPN:
      return IceCandidateNetworkType.kVpn;
    case IceCandidatePairConfig_NetworkType.CELLULAR:
      return IceCandidateNetworkType.kCellular;
    default:
      return IceCandidateNetworkType.kUnknown;
  }
}

export function getRuntimeIceCandidatePairEventType(
  type: IceCandidatePairEvent_IceCandidatePairEventType,
): IceCandidatePairEventType {
  switch (type) {
    case IceCandidatePairEvent_IceCandidatePairEventType.CHECK_SENT:
      return IceCandidatePairEventType.kCheckSent;
    case IceCandidatePairEvent_IceCandidatePairEventType.CHECK_RECEIVED:
      return IceCandidatePairEventType.kCheckReceived;
    case IceCandidatePairEvent_IceCandidatePairEventType.CHECK_RESPONSE_SENT:
      return IceCandidatePairEventType.kCheckResponseSent;
    case IceCandidatePairEvent_IceCandidatePairEventType.CHECK_RESPONSE_RECEIVED:
      return IceCandidatePairEventType.kCheckResponseReceived;
    default:
      // UNKNOWN_CHECK_TYPE (RTC_DCHECK_NOTREACHED in upstream).
      return IceCandidatePairEventType.kCheckSent;
  }
}

export function getRuntimeCodecType(codec: FrameDecodedEvents_Codec): VideoCodecType {
  switch (codec) {
    case FrameDecodedEvents_Codec.GENERIC:
      return VideoCodecType.kVideoCodecGeneric;
    case FrameDecodedEvents_Codec.VP8:
      return VideoCodecType.kVideoCodecVP8;
    case FrameDecodedEvents_Codec.VP9:
      return VideoCodecType.kVideoCodecVP9;
    case FrameDecodedEvents_Codec.AV1:
      return VideoCodecType.kVideoCodecAV1;
    case FrameDecodedEvents_Codec.H264:
      return VideoCodecType.kVideoCodecH264;
    case FrameDecodedEvents_Codec.H265:
      return VideoCodecType.kVideoCodecH265;
    default:
      // CODEC_UNKNOWN: "Unknown codec type. Returning generic."
      return VideoCodecType.kVideoCodecGeneric;
  }
}

export function getRuntimeRtpHeaderExtensionConfig(protoHeaderExtensions: RtpHeaderExtensionConfig): RtpExtension[] {
  const S = RtpHeaderExtensionConfigSchema;
  const p = protoHeaderExtensions;
  const rtpExtensions: RtpExtension[] = [];
  if (has(S, p, "transmissionTimeOffsetId")) {
    rtpExtensions.push(new RtpExtension(RtpExtension.kTimestampOffsetUri, p.transmissionTimeOffsetId));
  }
  if (has(S, p, "absoluteSendTimeId")) {
    rtpExtensions.push(new RtpExtension(RtpExtension.kAbsSendTimeUri, p.absoluteSendTimeId));
  }
  if (has(S, p, "transportSequenceNumberId")) {
    rtpExtensions.push(new RtpExtension(RtpExtension.kTransportSequenceNumberUri, p.transportSequenceNumberId));
  }
  if (has(S, p, "audioLevelId")) {
    rtpExtensions.push(new RtpExtension(RtpExtension.kAudioLevelUri, p.audioLevelId));
  }
  if (has(S, p, "videoRotationId")) {
    rtpExtensions.push(new RtpExtension(RtpExtension.kVideoRotationUri, p.videoRotationId));
  }
  if (has(S, p, "dependencyDescriptorId")) {
    rtpExtensions.push(new RtpExtension(RtpExtension.kDependencyDescriptorUri, p.dependencyDescriptorId));
  }
  return rtpExtensions;
}

// Conversion functions for legacy wire format.
function getRuntimeRtcpModeLegacy(rtcpMode: rtclog.VideoReceiveConfig_RtcpMode): RtcpMode {
  switch (rtcpMode) {
    case rtclog.VideoReceiveConfig_RtcpMode.RTCP_COMPOUND:
      return RtcpMode.kCompound;
    case rtclog.VideoReceiveConfig_RtcpMode.RTCP_REDUCEDSIZE:
      return RtcpMode.kReducedSize;
    default:
      return RtcpMode.kOff;
  }
}

function getRuntimeDetectorStateLegacy(detectorState: rtclog.DelayBasedBweUpdate_DetectorState): BandwidthUsage {
  switch (detectorState) {
    case rtclog.DelayBasedBweUpdate_DetectorState.BWE_NORMAL:
      return BandwidthUsage.kBwNormal;
    case rtclog.DelayBasedBweUpdate_DetectorState.BWE_UNDERUSING:
      return BandwidthUsage.kBwUnderusing;
    case rtclog.DelayBasedBweUpdate_DetectorState.BWE_OVERUSING:
      return BandwidthUsage.kBwOverusing;
    default:
      return BandwidthUsage.kBwNormal;
  }
}

function getRuntimeIceCandidatePairConfigTypeLegacy(
  type: rtclog.IceCandidatePairConfig_IceCandidatePairConfigType,
): IceCandidatePairConfigType {
  switch (type) {
    case rtclog.IceCandidatePairConfig_IceCandidatePairConfigType.ADDED:
      return IceCandidatePairConfigType.kAdded;
    case rtclog.IceCandidatePairConfig_IceCandidatePairConfigType.UPDATED:
      return IceCandidatePairConfigType.kUpdated;
    case rtclog.IceCandidatePairConfig_IceCandidatePairConfigType.DESTROYED:
      return IceCandidatePairConfigType.kDestroyed;
    case rtclog.IceCandidatePairConfig_IceCandidatePairConfigType.SELECTED:
      return IceCandidatePairConfigType.kSelected;
    default:
      return IceCandidatePairConfigType.kAdded;
  }
}

// Undefined when the log type has no runtime equivalent.
function getRuntimeIceCandidateTypeLegacy(logType: rtclog.IceCandidatePairConfig_IceCandidateType): IceCandidateType | undefined {
  switch (logType) {
    case rtclog.IceCandidatePairConfig_IceCandidateType.LOCAL:
      return IceCandidateType.kHost;
    case rtclog.IceCandidatePairConfig_IceCandidateType.STUN:
      return IceCandidateType.kSrflx;
    case rtclog.IceCandidatePairConfig_IceCandidateType.PRFLX:
      return IceCandidateType.kPrflx;
    case rtclog.IceCandidatePairConfig_IceCandidateType.RELAY:
      return IceCandidateType.kRelay;
    default:
      return undefined;
  }
}

function getRuntimeIceCandidatePairProtocolLegacy(protocol: rtclog.IceCandidatePairConfig_Protocol): IceCandidatePairProtocol {
  switch (protocol) {
    case rtclog.IceCandidatePairConfig_Protocol.UDP:
      return IceCandidatePairProtocol.kUdp;
    case rtclog.IceCandidatePairConfig_Protocol.TCP:
      return IceCandidatePairProtocol.kTcp;
    case rtclog.IceCandidatePairConfig_Protocol.SSLTCP:
      return IceCandidatePairProtocol.kSsltcp;
    case rtclog.IceCandidatePairConfig_Protocol.TLS:
      return IceCandidatePairProtocol.kTls;
    default:
      return IceCandidatePairProtocol.kUnknown;
  }
}

function getRuntimeIceCandidatePairAddressFamilyLegacy(
  addressFamily: rtclog.IceCandidatePairConfig_AddressFamily,
): IceCandidatePairAddressFamily {
  switch (addressFamily) {
    case rtclog.IceCandidatePairConfig_AddressFamily.IPV4:
      return IceCandidatePairAddressFamily.kIpv4;
    case rtclog.IceCandidatePairConfig_AddressFamily.IPV6:
      return IceCandidatePairAddressFamily.kIpv6;
    default:
      return IceCandidatePairAddressFamily.kUnknown;
  }
}

function getRuntimeIceCandidateNetworkTypeLegacy(networkType: rtclog.IceCandidatePairConfig_NetworkType): IceCandidateNetworkType {
  switch (networkType) {
    case rtclog.IceCandidatePairConfig_NetworkType.ETHERNET:
      return IceCandidateNetworkType.kEthernet;
    case rtclog.IceCandidatePairConfig_NetworkType.LOOPBACK:
      return IceCandidateNetworkType.kLoopback;
    case rtclog.IceCandidatePairConfig_NetworkType.WIFI:
      return IceCandidateNetworkType.kWifi;
    case rtclog.IceCandidatePairConfig_NetworkType.VPN:
      return IceCandidateNetworkType.kVpn;
    case rtclog.IceCandidatePairConfig_NetworkType.CELLULAR:
      return IceCandidateNetworkType.kCellular;
    default:
      return IceCandidateNetworkType.kUnknown;
  }
}

function getRuntimeIceCandidatePairEventTypeLegacy(
  type: rtclog.IceCandidatePairEvent_IceCandidatePairEventType,
): IceCandidatePairEventType {
  switch (type) {
    case rtclog.IceCandidatePairEvent_IceCandidatePairEventType.CHECK_SENT:
      return IceCandidatePairEventType.kCheckSent;
    case rtclog.IceCandidatePairEvent_IceCandidatePairEventType.CHECK_RECEIVED:
      return IceCandidatePairEventType.kCheckReceived;
    case rtclog.IceCandidatePairEvent_IceCandidatePairEventType.CHECK_RESPONSE_SENT:
      return IceCandidatePairEventType.kCheckResponseSent;
    case rtclog.IceCandidatePairEvent_IceCandidatePairEventType.CHECK_RESPONSE_RECEIVED:
      return IceCandidatePairEventType.kCheckResponseReceived;
    default:
      return IceCandidatePairEventType.kCheckSent;
  }
}

function getHeaderExtensions(protoHeaderExtensions: readonly rtclog.RtpHeaderExtension[]): RtpExtension[] | ParseStatus {
  const headerExtensions: RtpExtension[] = [];
  for (const p of protoHeaderExtensions) {
    if (!has(rtclog.RtpHeaderExtensionSchema, p, "name")) return ParseStatus.error("p.has_name()");
    if (!has(rtclog.RtpHeaderExtensionSchema, p, "id")) return ParseStatus.error("p.has_id()");
    headerExtensions.push(new RtpExtension(p.name, p.id));
  }
  return headerExtensions;
}

// The oneof member `event.<name>()` of a legacy Event: the set message, or an
// empty one (whose fields all read as unset) when another member is set.
function legacySubtype<Desc extends DescMessage>(
  event: rtclog.Event,
  name: string,
  schema: Desc,
): MessageShape<Desc> {
  return event.subtype.case === name ? (event.subtype.value as unknown as MessageShape<Desc>) : create(schema);
}

const hasSubtype = (event: rtclog.Event, name: string) => event.subtype.case === name;

function pushToMap<T>(map: Map<number, T[]>, key: number, value: T): void {
  let list = map.get(key);
  if (list === undefined) {
    list = [];
    map.set(key, list);
  }
  list.push(value);
}

// std::map iterates in key order.
function sortedByKey<T>(map: Map<number, T>): Map<number, T> {
  return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
}

class MediaStreamInfo {
  unwrapCaptureTicks = new RtpTimestampUnwrapper();

  constructor(
    public mediaType: LoggedMediaType = LoggedMediaType.kUnknown,
    public rtx = false,
  ) {}
}

interface OverheadChangeEvent {
  timestamp: Timestamp;
  overhead: number;
}

function getOverheadChangingEvents(
  routeChanges: readonly InferredRouteChangeEvent[],
  direction: PacketDirection,
): OverheadChangeEvent[] {
  const overheads: OverheadChangeEvent[] = [];
  for (const event of routeChanges) {
    const newOverhead = direction === PacketDirection.kIncomingPacket ? event.returnOverhead : event.sendOverhead;
    if (overheads.length === 0 || newOverhead !== overheads[overheads.length - 1].overhead) {
      overheads.push({timestamp: event.logTime, overhead: newOverhead});
    }
  }
  return overheads;
}

class RtcpBlockLists {
  sr: LoggedRtcpPacketSenderReport[] = [];
  rr: LoggedRtcpPacketReceiverReport[] = [];
  xr: LoggedRtcpPacketExtendedReports[] = [];
  remb: LoggedRtcpPacketRemb[] = [];
  nack: LoggedRtcpPacketNack[] = [];
  fir: LoggedRtcpPacketFir[] = [];
  pli: LoggedRtcpPacketPli[] = [];
  bye: LoggedRtcpPacketBye[] = [];
  transportFeedback: LoggedRtcpPacketTransportFeedback[] = [];
  congestionFeedback: LoggedRtcpCongestionControlFeedback[] = [];
  lossNotification: LoggedRtcpPacketLossNotification[] = [];
}

function storeRtcpBlocks(timestampUs: number, packet: Uint8Array, lists: RtcpBlockLists): ParseStatus {
  const timestamp = Timestamp.micros(timestampUs);
  const header = new CommonHeader();
  for (let block = 0; block < packet.length; block += header.nextPacketOffset()) {
    if (!header.parse(packet.subarray(block))) return ParseStatus.error("header.Parse(block, packet_end - block)");

    if (header.type() === TransportFeedback.kPacketType && header.fmt() === TransportFeedback.kFeedbackMessageType) {
      const parsedBlock = new LoggedRtcpPacketTransportFeedback(timestamp);
      if (!parsedBlock.transportFeedback.parse(header)) {
        return ParseStatus.error("parsed_block.transport_feedback.Parse(header)");
      }
      // Upstream stores the block with push_back(std::move(parsed_block)), and
      // TransportFeedback's move constructor does not move the Rtpfb base: the
      // stored feedback has sender and media SSRC 0. Kept for parity.
      parsedBlock.transportFeedback.setSenderSsrc(0);
      parsedBlock.transportFeedback.setMediaSsrc(0);
      lists.transportFeedback.push(parsedBlock);
    } else if (header.type() === Rtpfb.kPacketType && header.fmt() === CongestionControlFeedback.kFeedbackMessageType) {
      const feedback = new CongestionControlFeedback();
      if (!feedback.parse(header)) return ParseStatus.error("feedback.Parse(header)");
      lists.congestionFeedback.push(new LoggedRtcpCongestionControlFeedback(timestamp, feedback));
    } else if (header.type() === SenderReport.kPacketType) {
      const parsedBlock = new LoggedRtcpPacketSenderReport(timestamp);
      if (!parsedBlock.sr.parse(header)) return ParseStatus.error("parsed_block.sr.Parse(header)");
      lists.sr.push(parsedBlock);
    } else if (header.type() === ReceiverReport.kPacketType) {
      const parsedBlock = new LoggedRtcpPacketReceiverReport(timestamp);
      if (!parsedBlock.rr.parse(header)) return ParseStatus.error("parsed_block.rr.Parse(header)");
      lists.rr.push(parsedBlock);
    } else if (header.type() === ExtendedReports.kPacketType) {
      const parsedBlock = new LoggedRtcpPacketExtendedReports(timestamp);
      if (!parsedBlock.xr.parse(header)) return ParseStatus.error("parsed_block.xr.Parse(header)");
      lists.xr.push(parsedBlock);
    } else if (header.type() === Fir.kPacketType && header.fmt() === Fir.kFeedbackMessageType) {
      const parsedBlock = new LoggedRtcpPacketFir(timestamp);
      if (!parsedBlock.fir.parse(header)) return ParseStatus.error("parsed_block.fir.Parse(header)");
      lists.fir.push(parsedBlock);
    } else if (header.type() === Pli.kPacketType && header.fmt() === Pli.kFeedbackMessageType) {
      const parsedBlock = new LoggedRtcpPacketPli(timestamp);
      if (!parsedBlock.pli.parse(header)) return ParseStatus.error("parsed_block.pli.Parse(header)");
      lists.pli.push(parsedBlock);
    } else if (header.type() === Bye.kPacketType) {
      const parsedBlock = new LoggedRtcpPacketBye(timestamp);
      if (!parsedBlock.bye.parse(header)) return ParseStatus.error("parsed_block.bye.Parse(header)");
      lists.bye.push(parsedBlock);
    } else if (header.type() === Psfb.kPacketType && header.fmt() === Psfb.kAfbMessageType) {
      let typeFound = false;
      if (!typeFound) {
        const parsedBlock = new LoggedRtcpPacketRemb(timestamp);
        if (parsedBlock.remb.parse(header)) {
          lists.remb.push(parsedBlock);
          typeFound = true;
        }
      }
      if (!typeFound) {
        const parsedBlock = new LoggedRtcpPacketLossNotification(timestamp);
        if (parsedBlock.lossNotification.parse(header)) {
          lists.lossNotification.push(parsedBlock);
          typeFound = true;
        }
      }
      // We ignore other application-layer feedback types.
    } else if (header.type() === Nack.kPacketType && header.fmt() === Nack.kFeedbackMessageType) {
      const parsedBlock = new LoggedRtcpPacketNack(timestamp);
      if (!parsedBlock.nack.parse(header)) return ParseStatus.error("parsed_block.nack.Parse(header)");
      lists.nack.push(parsedBlock);
    }
  }
  return ParseStatus.success();
}

type RtpPacketsProto = IncomingRtpPackets | OutgoingRtpPackets;
type RtpPacketsSchema = typeof IncomingRtpPacketsSchema | typeof OutgoingRtpPacketsSchema;
type LoggedRtpPacketCtor<T> = new (timestamp: Timestamp, header: RTPHeader, headerLength: number, totalLength: number) => T;

function storeRtpPackets<T extends {rtp: LoggedRtpPacket}>(
  schema: RtpPacketsSchema,
  proto: RtpPacketsProto,
  ctor: LoggedRtpPacketCtor<T>,
  rtpPacketsMap: Map<number, T[]>,
): ParseStatus {
  const hasField = (field: string & keyof RtpPacketsProto) =>
    has(schema as typeof IncomingRtpPacketsSchema, proto as IncomingRtpPackets, field);
  const push = (packet: T) => {
    const ssrc = packet.rtp.header.ssrc;
    let packets = rtpPacketsMap.get(ssrc);
    if (packets === undefined) {
      packets = [];
      rtpPacketsMap.set(ssrc, packets);
    }
    packets.push(packet);
  };

  for (const field of [
    "timestampMs",
    "marker",
    "payloadType",
    "sequenceNumber",
    "rtpTimestamp",
    "ssrc",
    "payloadSize",
    "headerSize",
    "paddingSize",
  ] as const) {
    if (!hasField(field)) return ParseStatus.error(`proto.has_${field}()`);
  }

  const numberOfDeltas = hasField("numberOfDeltas") ? Number(proto.numberOfDeltas) : 0;
  const totalPackets = numberOfDeltas + 1;

  let dependencyDescriptorWireFormat: Uint8Array[] = new Array(totalPackets).fill(new Uint8Array(0));
  if (proto.dependencyDescriptor !== undefined) {
    const statusOrDecoded = RtcEventLogDependencyDescriptorEncoderDecoder.decode(proto.dependencyDescriptor, totalPackets);
    if (!statusOrDecoded.ok()) {
      return statusOrDecoded.status();
    }
    dependencyDescriptorWireFormat = statusOrDecoded.value();
  }

  // Base event
  {
    const header = new RTPHeader();
    header.markerBit = proto.marker;
    let error =
      check(proto.payloadType <= 0xff, "IsValueInRangeForNumericType<uint8_t>(proto.payload_type())") ??
      check(proto.sequenceNumber <= 0xffff, "IsValueInRangeForNumericType<uint16_t>(proto.sequence_number())");
    if (error) return error;
    header.payloadType = proto.payloadType;
    header.sequenceNumber = proto.sequenceNumber;
    header.timestamp = proto.rtpTimestamp;
    header.ssrc = proto.ssrc;
    header.numCSRCs = 0; // TODO(terelius): Implement CSRC.
    header.paddingLength = proto.paddingSize;
    header.headerLength = proto.headerSize;
    if (hasField("transportSequenceNumber")) {
      header.extension.hasTransportSequenceNumber = true;
      error = check(
        proto.transportSequenceNumber <= 0xffff,
        "IsValueInRangeForNumericType<uint16_t>(proto.transport_sequence_number())",
      );
      if (error) return error;
      header.extension.transportSequenceNumber = proto.transportSequenceNumber;
    }
    if (hasField("transmissionTimeOffset")) {
      header.extension.hasTransmissionTimeOffset = true;
      header.extension.transmissionTimeOffset = proto.transmissionTimeOffset;
    }
    if (hasField("absoluteSendTime")) {
      header.extension.hasAbsoluteSendTime = true;
      header.extension.absoluteSendTime = proto.absoluteSendTime;
    }
    if (hasField("videoRotation")) {
      header.extension.hasVideoRotation = true;
      error = check(proto.videoRotation <= 0xff, "IsValueInRangeForNumericType<uint8_t>(proto.video_rotation())");
      if (error) return error;
      header.extension.videoRotation = convertCVOByteToVideoRotation(proto.videoRotation);
    }
    if (hasField("audioLevel")) {
      error =
        check(hasField("voiceActivity"), "proto.has_voice_activity()") ??
        check(proto.audioLevel <= 0x7fffffff, "IsValueInRangeForNumericType<int>(proto.audio_level())") ??
        check(proto.audioLevel <= 0x7f, "audio_level<=0x7F");
      if (error) return error;
      header.extension.setAudioLevel(new AudioLevel(proto.voiceActivity, proto.audioLevel));
    } else {
      error = check(!hasField("voiceActivity"), "!proto.has_voice_activity()");
      if (error) return error;
    }
    let baseRtxOsn: number | undefined = undefined;
    if (hasField("rtxOriginalSequenceNumber")) {
      error = check(
        proto.rtxOriginalSequenceNumber <= 0xffff,
        "IsValueInRangeForNumericType<uint16_t>(proto.rtx_original_sequence_number())",
      );
      if (error) return error;
      baseRtxOsn = proto.rtxOriginalSequenceNumber;
    }

    const loggedPacket = new ctor(
      Timestamp.millis(proto.timestampMs),
      header,
      proto.headerSize,
      proto.payloadSize + header.headerLength + header.paddingLength,
    );
    if (dependencyDescriptorWireFormat[0].length !== 0) {
      loggedPacket.rtp.dependencyDescriptorWireFormat = dependencyDescriptorWireFormat[0];
    }
    loggedPacket.rtp.rtxOriginalSequenceNumber = baseRtxOsn;
    push(loggedPacket);
  }

  if (numberOfDeltas === 0) {
    return ParseStatus.success();
  }

  const decodeChecked = (
    name: string,
    deltas: Uint8Array,
    base: OptionalU64,
  ): {values: OptionalU64[]; error: ParseStatus | null} => {
    const values = decodeDeltas(deltas, base, numberOfDeltas);
    return {values, error: check(values.length === numberOfDeltas, `${name}_values.size()==number_of_deltas`)};
  };
  const optionalBase = (present: boolean, value: number | bigint): OptionalU64 =>
    present ? BigInt(value) : undefined;

  const decoded = {
    // timestamp_ms (event)
    timestampMs: decodeChecked("timestamp_ms", proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64)),
    // RTP base
    marker: decodeChecked("marker", proto.markerDeltas, proto.marker ? 1n : 0n),
    payloadType: decodeChecked("payload_type", proto.payloadTypeDeltas, BigInt(proto.payloadType)),
    sequenceNumber: decodeChecked("sequence_number", proto.sequenceNumberDeltas, BigInt(proto.sequenceNumber)),
    rtpTimestamp: decodeChecked("rtp_timestamp", proto.rtpTimestampDeltas, BigInt(proto.rtpTimestamp)),
    ssrc: decodeChecked("ssrc", proto.ssrcDeltas, BigInt(proto.ssrc)),
    payloadSize: decodeChecked("payload_size", proto.payloadSizeDeltas, BigInt(proto.payloadSize)),
    headerSize: decodeChecked("header_size", proto.headerSizeDeltas, BigInt(proto.headerSize)),
    paddingSize: decodeChecked("padding_size", proto.paddingSizeDeltas, BigInt(proto.paddingSize)),
    // RTP extensions
    transportSequenceNumber: decodeChecked(
      "transport_sequence_number",
      proto.transportSequenceNumberDeltas,
      optionalBase(hasField("transportSequenceNumber"), proto.transportSequenceNumber),
    ),
    transmissionTimeOffset: decodeChecked(
      "transmission_time_offset",
      proto.transmissionTimeOffsetDeltas,
      hasField("transmissionTimeOffset") ? toUnsigned(BigInt(proto.transmissionTimeOffset), 32) : undefined,
    ),
    absoluteSendTime: decodeChecked(
      "absolute_send_time",
      proto.absoluteSendTimeDeltas,
      optionalBase(hasField("absoluteSendTime"), proto.absoluteSendTime),
    ),
    videoRotation: decodeChecked(
      "video_rotation",
      proto.videoRotationDeltas,
      optionalBase(hasField("videoRotation"), proto.videoRotation),
    ),
    audioLevel: decodeChecked(
      "audio_level",
      proto.audioLevelDeltas,
      optionalBase(hasField("audioLevel"), proto.audioLevel),
    ),
    voiceActivity: decodeChecked(
      "voice_activity",
      proto.voiceActivityDeltas,
      optionalBase(hasField("voiceActivity"), proto.voiceActivity ? 1 : 0),
    ),
    // RTX original sequence number.
    rtxOsn: decodeChecked(
      "rtx_osn",
      proto.rtxOriginalSequenceNumberDeltas,
      optionalBase(hasField("rtxOriginalSequenceNumber"), proto.rtxOriginalSequenceNumber),
    ),
  };
  for (const entry of Object.values(decoded)) {
    if (entry.error) return entry.error;
  }

  const timestampMsValues = decoded.timestampMs.values;
  const markerValues = decoded.marker.values;
  const payloadTypeValues = decoded.payloadType.values;
  const sequenceNumberValues = decoded.sequenceNumber.values;
  const rtpTimestampValues = decoded.rtpTimestamp.values;
  const ssrcValues = decoded.ssrc.values;
  const payloadSizeValues = decoded.payloadSize.values;
  const headerSizeValues = decoded.headerSize.values;
  const paddingSizeValues = decoded.paddingSize.values;
  const transportSequenceNumberValues = decoded.transportSequenceNumber.values;
  const transmissionTimeOffsetValues = decoded.transmissionTimeOffset.values;
  const absoluteSendTimeValues = decoded.absoluteSendTime.values;
  const videoRotationValues = decoded.videoRotation.values;
  const audioLevelValues = decoded.audioLevel.values;
  const voiceActivityValues = decoded.voiceActivity.values;
  const rtxOsnValues = decoded.rtxOsn.values;

  // Populate events from decoded deltas
  for (let i = 0; i < numberOfDeltas; ++i) {
    const timestampMsValue = timestampMsValues[i];
    const marker = markerValues[i];
    const payloadType = payloadTypeValues[i];
    const sequenceNumber = sequenceNumberValues[i];
    const rtpTimestamp = rtpTimestampValues[i];
    const ssrc = ssrcValues[i];
    const payloadSize = payloadSizeValues[i];
    const headerSize = headerSizeValues[i];
    const paddingSize = paddingSizeValues[i];
    if (timestampMsValue === undefined) return ParseStatus.error("timestamp_ms_values[i].has_value()");
    if (marker === undefined) return ParseStatus.error("marker_values[i].has_value()");
    if (payloadType === undefined) return ParseStatus.error("payload_type_values[i].has_value()");
    if (sequenceNumber === undefined) return ParseStatus.error("sequence_number_values[i].has_value()");
    if (rtpTimestamp === undefined) return ParseStatus.error("rtp_timestamp_values[i].has_value()");
    if (ssrc === undefined) return ParseStatus.error("ssrc_values[i].has_value()");
    if (payloadSize === undefined) return ParseStatus.error("payload_size_values[i].has_value()");
    if (headerSize === undefined) return ParseStatus.error("header_size_values[i].has_value()");
    if (paddingSize === undefined) return ParseStatus.error("padding_size_values[i].has_value()");

    const timestampMs = toSigned(timestampMsValue, 64);
    if (timestampMs === undefined) return ParseStatus.error("ToSigned(timestamp_ms_values[i].value(), &timestamp_ms)");

    const header = new RTPHeader();
    let error =
      check(marker <= 1n, "IsValueInRangeForNumericType<bool>(*marker_values[i])") ??
      check(payloadType <= kU8Max, "IsValueInRangeForNumericType<uint8_t>(*payload_type_values[i])") ??
      check(sequenceNumber <= kU16Max, "IsValueInRangeForNumericType<uint16_t>(*sequence_number_values[i])") ??
      check(rtpTimestamp <= kU32Max, "IsValueInRangeForNumericType<uint32_t>(*rtp_timestamp_values[i])") ??
      check(ssrc <= kU32Max, "IsValueInRangeForNumericType<uint32_t>(*ssrc_values[i])");
    if (error) return error;
    header.markerBit = marker === 1n;
    header.payloadType = Number(payloadType);
    header.sequenceNumber = Number(sequenceNumber);
    header.timestamp = Number(rtpTimestamp);
    header.ssrc = Number(ssrc);
    header.numCSRCs = 0; // TODO(terelius): Implement CSRC.
    header.paddingLength = Number(paddingSize);
    header.headerLength = Number(headerSize);

    const transportSequenceNumber = transportSequenceNumberValues[i];
    if (transportSequenceNumber !== undefined) {
      header.extension.hasTransportSequenceNumber = true;
      error = check(
        transportSequenceNumber <= kU16Max,
        "IsValueInRangeForNumericType<uint16_t>(transport_sequence_number_values[i].value())",
      );
      if (error) return error;
      header.extension.transportSequenceNumber = Number(transportSequenceNumber);
    }
    const transmissionTimeOffsetValue = transmissionTimeOffsetValues[i];
    if (transmissionTimeOffsetValue !== undefined) {
      header.extension.hasTransmissionTimeOffset = true;
      const transmissionTimeOffset = toSigned(transmissionTimeOffsetValue, 32);
      if (transmissionTimeOffset === undefined) {
        return ParseStatus.error("ToSigned(transmission_time_offset_values[i].value(), &transmission_time_offset)");
      }
      header.extension.transmissionTimeOffset = Number(transmissionTimeOffset);
    }
    const absoluteSendTime = absoluteSendTimeValues[i];
    if (absoluteSendTime !== undefined) {
      header.extension.hasAbsoluteSendTime = true;
      error = check(
        absoluteSendTime <= kU32Max,
        "IsValueInRangeForNumericType<uint32_t>(absolute_send_time_values[i].value())",
      );
      if (error) return error;
      header.extension.absoluteSendTime = Number(absoluteSendTime);
    }
    const videoRotation = videoRotationValues[i];
    if (videoRotation !== undefined) {
      header.extension.hasVideoRotation = true;
      error = check(videoRotation <= kU8Max, "IsValueInRangeForNumericType<uint8_t>(video_rotation_values[i].value())");
      if (error) return error;
      header.extension.videoRotation = convertCVOByteToVideoRotation(Number(videoRotation));
    }
    const audioLevel = audioLevelValues[i];
    const voiceActivity = voiceActivityValues[i];
    if (audioLevel !== undefined) {
      error =
        check(voiceActivity !== undefined, "voice_activity_values.size() > i && voice_activity_values[i].has_value()") ??
        check(
          voiceActivity !== undefined && voiceActivity <= 1n,
          "IsValueInRangeForNumericType<bool>(voice_activity_values[i].value())",
        ) ??
        check(audioLevel <= kI32Max, "IsValueInRangeForNumericType<int>(audio_level_values[i].value())") ??
        check(audioLevel <= 0x7fn, "audio_level<=0x7F");
      if (error) return error;
      header.extension.setAudioLevel(new AudioLevel(voiceActivity === 1n, Number(audioLevel)));
    } else {
      error = check(
        voiceActivity === undefined,
        "voice_activity_values.size() <= i || !voice_activity_values[i].has_value()",
      );
      if (error) return error;
    }
    let rtxOsn: number | undefined = undefined;
    const rtxOsnValue = rtxOsnValues[i];
    if (rtxOsnValue !== undefined) {
      error = check(rtxOsnValue <= kU16Max, "IsValueInRangeForNumericType<uint16_t>(rtx_osn_values[i].value())");
      if (error) return error;
      rtxOsn = Number(rtxOsnValue);
    }
    const loggedPacket = new ctor(
      Timestamp.millis(timestampMs),
      header,
      header.headerLength,
      Number(BigInt.asUintN(64, payloadSize + BigInt(header.headerLength) + BigInt(header.paddingLength))),
    );
    if (dependencyDescriptorWireFormat[i + 1].length !== 0) {
      loggedPacket.rtp.dependencyDescriptorWireFormat = dependencyDescriptorWireFormat[i + 1];
    }
    loggedPacket.rtp.rtxOriginalSequenceNumber = rtxOsn;
    push(loggedPacket);
  }
  return ParseStatus.success();
}

type RtcpPacketsProto = IncomingRtcpPackets | OutgoingRtcpPackets;
type RtcpPacketsSchema = typeof IncomingRtcpPacketsSchema | typeof OutgoingRtcpPacketsSchema;

function storeRtcpPackets<T extends {rtcp: {rawData: Uint8Array}}>(
  schema: RtcpPacketsSchema,
  proto: RtcpPacketsProto,
  ctor: new (timestamp: Timestamp, packet: Uint8Array) => T,
  rtcpPackets: T[],
  removeDuplicates: boolean,
): ParseStatus {
  const hasField = (field: string & keyof RtcpPacketsProto) =>
    has(schema as typeof IncomingRtcpPacketsSchema, proto as IncomingRtcpPackets, field);
  if (!hasField("timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
  if (!hasField("rawPacket")) return ParseStatus.error("proto.has_raw_packet()");

  // TODO(terelius): Incoming RTCP may be delivered once for audio and once
  // for video. As a work around, we remove the duplicated packets since they
  // cause problems when analyzing the log or feeding it into the transport
  // feedback adapter.
  if (
    !removeDuplicates ||
    rtcpPackets.length === 0 ||
    !identicalRtcpContents(rtcpPackets[rtcpPackets.length - 1].rtcp.rawData, proto.rawPacket)
  ) {
    // Base event
    rtcpPackets.push(new ctor(Timestamp.millis(proto.timestampMs), proto.rawPacket));
  }

  const numberOfDeltas = hasField("numberOfDeltas") ? Number(proto.numberOfDeltas) : 0;
  if (numberOfDeltas === 0) {
    return ParseStatus.success();
  }

  // timestamp_ms
  const timestampMsValues = decodeDeltas(proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64), numberOfDeltas);
  if (timestampMsValues.length !== numberOfDeltas) {
    return ParseStatus.error("timestamp_ms_values.size()==number_of_deltas");
  }

  // raw_packet
  if (!hasField("rawPacketBlobs")) return ParseStatus.error("proto.has_raw_packet_blobs()");
  const rawPacketValues = decodeBlobs(proto.rawPacketBlobs, numberOfDeltas);
  if (rawPacketValues.length !== numberOfDeltas) {
    return ParseStatus.error("raw_packet_values.size()==number_of_deltas");
  }

  // Populate events from decoded deltas
  for (let i = 0; i < numberOfDeltas; ++i) {
    const timestampMsValue = timestampMsValues[i];
    if (timestampMsValue === undefined) return ParseStatus.error("timestamp_ms_values[i].has_value()");
    const timestampMs = toSigned(timestampMsValue, 64);
    if (timestampMs === undefined) return ParseStatus.error("ToSigned(timestamp_ms_values[i].value(), &timestamp_ms)");

    // TODO(terelius): Incoming RTCP may be delivered once for audio and once
    // for video. As a work around, we remove the duplicated packets since they
    // cause problems when analyzing the log or feeding it into the transport
    // feedback adapter.
    if (
      removeDuplicates &&
      rtcpPackets.length !== 0 &&
      identicalRtcpContents(rtcpPackets[rtcpPackets.length - 1].rtcp.rawData, rawPacketValues[i])
    ) {
      continue;
    }
    rtcpPackets.push(new ctor(Timestamp.millis(timestampMs), rawPacketValues[i]));
  }
  return ParseStatus.success();
}

export class ParsedRtcEventLog {
  private readonly parseUnconfiguredHeaderExtensions: UnconfiguredHeaderExtensions;
  private readonly allowIncompleteLogs: boolean;

  private incomingRtpPacketsMap = new Map<number, LoggedRtpPacketIncoming[]>();
  private outgoingRtpPacketsMap = new Map<number, LoggedRtpPacketOutgoing[]>();
  private incomingRtpPacketsBySsrcValue: LoggedRtpStreamIncoming[] = [];
  private outgoingRtpPacketsBySsrcValue: LoggedRtpStreamOutgoing[] = [];
  private incomingRtpPacketViewsBySsrc: LoggedRtpStreamView[] = [];
  private outgoingRtpPacketViewsBySsrc: LoggedRtpStreamView[] = [];

  private incomingRtcpPacketsValue: LoggedRtcpPacketIncoming[] = [];
  private outgoingRtcpPacketsValue: LoggedRtcpPacketOutgoing[] = [];
  private incomingRtcp = new RtcpBlockLists();
  // Legacy format only.
  private lastIncomingRtcpPacket: Uint8Array = new Uint8Array(0);
  private incomingRtpExtensionsMaps = new Map<number, RtpHeaderExtensionMap>();
  private outgoingRtpExtensionsMaps = new Map<number, RtpHeaderExtensionMap>();
  private defaultExtensionMap = RtpHeaderExtensionMap.defaultHeaderExtensionMap();
  private outgoingRtcp = new RtcpBlockLists();

  private startLogEventsValue: LoggedStartEvent[] = [];
  private stopLogEventsValue: LoggedStopEvent[] = [];

  private alrStateEventsValue: LoggedAlrStateEvent[] = [];
  private routeChangeEventsValue: LoggedRouteChangeEvent[] = [];
  private remoteEstimateEventsValue: LoggedRemoteEstimateEvent[] = [];
  private bweProbeClusterCreatedEventsValue: LoggedBweProbeClusterCreatedEvent[] = [];
  private bweProbeFailureEventsValue: LoggedBweProbeFailureEvent[] = [];
  private bweProbeSuccessEventsValue: LoggedBweProbeSuccessEvent[] = [];
  private bweDelayUpdatesValue: LoggedBweDelayBasedUpdate[] = [];
  private bweLossUpdatesValue: LoggedBweLossBasedUpdate[] = [];
  private bweScreamUpdatesValue: LoggedBweScreamUpdate[] = [];

  private incomingRtxSsrcsValue = new Set<number>();
  private incomingVideoSsrcsValue = new Set<number>();
  private incomingAudioSsrcsValue = new Set<number>();
  private outgoingRtxSsrcsValue = new Set<number>();
  private outgoingVideoSsrcsValue = new Set<number>();
  private outgoingAudioSsrcsValue = new Set<number>();

  private audioPlayoutEventsValue = new Map<number, LoggedAudioPlayoutEvent[]>();
  private neteqSetMinimumDelayEventsValue = new Map<number, LoggedNetEqSetMinimumDelayEvent[]>();
  private audioNetworkAdaptationEventsValue: LoggedAudioNetworkAdaptationEvent[] = [];
  private dtlsTransportStatesValue: LoggedDtlsTransportState[] = [];
  private dtlsWritableStatesValue: LoggedDtlsWritableState[] = [];
  private decodedFramesValue = new Map<number, LoggedFrameDecoded[]>();
  private iceCandidatePairConfigsValue: LoggedIceCandidatePairConfig[] = [];
  private iceCandidatePairEventsValue: LoggedIceCandidatePairEvent[] = [];
  private audioRecvConfigsValue: LoggedAudioRecvConfig[] = [];
  private audioSendConfigsValue: LoggedAudioSendConfig[] = [];
  private videoRecvConfigsValue: LoggedVideoRecvConfig[] = [];
  private videoSendConfigsValue: LoggedVideoSendConfig[] = [];

  private firstTimestampValue: Timestamp = Timestamp.plusInfinity();
  private lastTimestampValue: Timestamp = Timestamp.minusInfinity();
  private firstLogSegmentValue = new LogSegment(0, kInt64Max);

  constructor(
    parseUnconfiguredHeaderExtensions: UnconfiguredHeaderExtensions = UnconfiguredHeaderExtensions.kDontParse,
    allowIncompleteLog = false,
  ) {
    this.parseUnconfiguredHeaderExtensions = parseUnconfiguredHeaderExtensions;
    this.allowIncompleteLogs = allowIncompleteLog;
    this.clear();
  }

  // Clears previously parsed events and resets the ParsedRtcEventLogNew to an
  // empty state.
  clear(): void {
    this.incomingRtxSsrcsValue = new Set();
    this.incomingVideoSsrcsValue = new Set();
    this.incomingAudioSsrcsValue = new Set();
    this.outgoingRtxSsrcsValue = new Set();
    this.outgoingVideoSsrcsValue = new Set();
    this.outgoingAudioSsrcsValue = new Set();

    this.incomingRtpPacketsMap.clear();
    this.outgoingRtpPacketsMap.clear();
    this.incomingRtpPacketsBySsrcValue = [];
    this.outgoingRtpPacketsBySsrcValue = [];
    this.incomingRtpPacketViewsBySsrc = [];
    this.outgoingRtpPacketViewsBySsrc = [];

    this.incomingRtcpPacketsValue = [];
    this.outgoingRtcpPacketsValue = [];
    this.incomingRtcp = new RtcpBlockLists();
    this.outgoingRtcp = new RtcpBlockLists();

    this.startLogEventsValue = [];
    this.stopLogEventsValue = [];
    this.bweProbeClusterCreatedEventsValue = [];
    this.bweProbeFailureEventsValue = [];
    this.bweProbeSuccessEventsValue = [];
    this.bweDelayUpdatesValue = [];
    this.bweLossUpdatesValue = [];
    this.bweScreamUpdatesValue = [];
    this.alrStateEventsValue = [];
    this.audioPlayoutEventsValue = new Map();
    this.neteqSetMinimumDelayEventsValue = new Map();
    this.audioNetworkAdaptationEventsValue = [];
    this.dtlsTransportStatesValue = [];
    this.dtlsWritableStatesValue = [];
    this.decodedFramesValue = new Map();
    this.iceCandidatePairConfigsValue = [];
    this.iceCandidatePairEventsValue = [];
    this.audioRecvConfigsValue = [];
    this.audioSendConfigsValue = [];
    this.videoRecvConfigsValue = [];
    this.videoSendConfigsValue = [];
    // Not cleared by upstream Clear() either; reset here so that a reused
    // parser does not accumulate them.
    this.routeChangeEventsValue = [];
    this.remoteEstimateEventsValue = [];

    this.firstTimestampValue = Timestamp.plusInfinity();
    this.lastTimestampValue = Timestamp.minusInfinity();
    this.firstLogSegmentValue = new LogSegment(0, kInt64Max);

    this.defaultExtensionMap = RtpHeaderExtensionMap.defaultHeaderExtensionMap();
    this.lastIncomingRtcpPacket = new Uint8Array(0);
    this.incomingRtpExtensionsMaps = new Map();
    this.outgoingRtpExtensionsMaps = new Map();
  }

  // Reads an RtcEventLog from a byte buffer and returns success if successful.
  parseString(s: Uint8Array): ParseStatus {
    return this.parseStream(s);
  }

  // Reads an RtcEventLog from a byte buffer and returns success if successful.
  parseStream(s: Uint8Array): ParseStatus {
    this.clear();
    const status = this.parseStreamInternal(s);

    // Cache the configured SSRCs.
    for (const videoRecvConfig of this.videoRecvConfigsValue) {
      this.incomingVideoSsrcsValue.add(videoRecvConfig.config.remoteSsrc);
      this.incomingVideoSsrcsValue.add(videoRecvConfig.config.rtxSsrc);
      this.incomingRtxSsrcsValue.add(videoRecvConfig.config.rtxSsrc);
    }
    for (const videoSendConfig of this.videoSendConfigsValue) {
      this.outgoingVideoSsrcsValue.add(videoSendConfig.config.localSsrc);
      this.outgoingVideoSsrcsValue.add(videoSendConfig.config.rtxSsrc);
      this.outgoingRtxSsrcsValue.add(videoSendConfig.config.rtxSsrc);
    }
    for (const audioRecvConfig of this.audioRecvConfigsValue) {
      this.incomingAudioSsrcsValue.add(audioRecvConfig.config.remoteSsrc);
    }
    for (const audioSendConfig of this.audioSendConfigsValue) {
      this.outgoingAudioSsrcsValue.add(audioSendConfig.config.localSsrc);
    }

    // The per-SSRC maps iterate in SSRC order, like std::map.
    this.audioPlayoutEventsValue = sortedByKey(this.audioPlayoutEventsValue);
    this.neteqSetMinimumDelayEventsValue = sortedByKey(this.neteqSetMinimumDelayEventsValue);
    this.decodedFramesValue = sortedByKey(this.decodedFramesValue);

    // ParseStreamInternal stores the RTP packets in a map indexed by SSRC.
    // Since we dont need rapid lookup based on SSRC after parsing, we move the
    // packets_streams from map to vector (in ascending SSRC order, as
    // std::map iterates).
    for (const ssrc of [...this.incomingRtpPacketsMap.keys()].sort((a, b) => a - b)) {
      const stream = new LoggedRtpStreamIncoming();
      stream.ssrc = ssrc;
      stream.incomingPackets = this.incomingRtpPacketsMap.get(ssrc) ?? [];
      this.incomingRtpPacketsBySsrcValue.push(stream);
    }
    this.incomingRtpPacketsMap.clear();
    for (const ssrc of [...this.outgoingRtpPacketsMap.keys()].sort((a, b) => a - b)) {
      const stream = new LoggedRtpStreamOutgoing();
      stream.ssrc = ssrc;
      stream.outgoingPackets = this.outgoingRtpPacketsMap.get(ssrc) ?? [];
      this.outgoingRtpPacketsBySsrcValue.push(stream);
    }
    this.outgoingRtpPacketsMap.clear();

    // Build PacketViews for easier iteration over RTP packets.
    for (const stream of this.incomingRtpPacketsBySsrcValue) {
      this.incomingRtpPacketViewsBySsrc.push(
        new LoggedRtpStreamView(
          stream.ssrc,
          stream.incomingPackets.map((packet) => packet.rtp),
        ),
      );
    }
    for (const stream of this.outgoingRtpPacketsBySsrcValue) {
      this.outgoingRtpPacketViewsBySsrc.push(
        new LoggedRtpStreamView(
          stream.ssrc,
          stream.outgoingPackets.map((packet) => packet.rtp),
        ),
      );
    }

    // Set up convenience wrappers around the most commonly used RTCP types.
    for (const incoming of this.incomingRtcpPacketsValue) {
      const storeRtcpStatus = storeRtcpBlocks(incoming.rtcp.timestamp, incoming.rtcp.rawData, this.incomingRtcp);
      if (!storeRtcpStatus.ok()) return storeRtcpStatus;
    }

    for (const outgoing of this.outgoingRtcpPacketsValue) {
      const storeRtcpStatus = storeRtcpBlocks(outgoing.rtcp.timestamp, outgoing.rtcp.rawData, this.outgoingRtcp);
      if (!storeRtcpStatus.ok()) return storeRtcpStatus;
    }

    // Store first and last timestamp events that might happen before the call
    // is connected or after the call is disconnected. Typical examples are
    // stream configurations and starting/stopping the log.
    // TODO(terelius): Figure out if we actually need to find the first and last
    // timestamp in the parser. It seems like this could be done by the caller.
    this.firstTimestampValue = Timestamp.plusInfinity();
    this.lastTimestampValue = Timestamp.minusInfinity();
    this.storeFirstAndLastTimestamp(this.alrStateEventsValue);
    this.storeFirstAndLastTimestamp(this.routeChangeEventsValue);
    for (const events of this.audioPlayoutEventsValue.values()) {
      // Audio playout events are grouped by SSRC.
      this.storeFirstAndLastTimestamp(events);
    }
    for (const events of this.neteqSetMinimumDelayEventsValue.values()) {
      // NetEq SetMinimumDelay grouped by SSRC.
      this.storeFirstAndLastTimestamp(events);
    }
    this.storeFirstAndLastTimestamp(this.audioNetworkAdaptationEventsValue);
    this.storeFirstAndLastTimestamp(this.bweProbeClusterCreatedEventsValue);
    this.storeFirstAndLastTimestamp(this.bweProbeFailureEventsValue);
    this.storeFirstAndLastTimestamp(this.bweProbeSuccessEventsValue);
    this.storeFirstAndLastTimestamp(this.bweDelayUpdatesValue);
    this.storeFirstAndLastTimestamp(this.bweLossUpdatesValue);
    this.storeFirstAndLastTimestamp(this.bweScreamUpdatesValue);
    for (const frames of this.decodedFramesValue.values()) {
      this.storeFirstAndLastTimestamp(frames);
    }
    this.storeFirstAndLastTimestamp(this.dtlsTransportStatesValue);
    this.storeFirstAndLastTimestamp(this.dtlsWritableStatesValue);
    this.storeFirstAndLastTimestamp(this.iceCandidatePairConfigsValue);
    this.storeFirstAndLastTimestamp(this.iceCandidatePairEventsValue);
    for (const rtpStream of this.incomingRtpPacketsBySsrcValue) {
      this.storeFirstAndLastTimestamp(rtpStream.incomingPackets);
    }
    for (const rtpStream of this.outgoingRtpPacketsBySsrcValue) {
      this.storeFirstAndLastTimestamp(rtpStream.outgoingPackets);
    }
    this.storeFirstAndLastTimestamp(this.incomingRtcpPacketsValue);
    this.storeFirstAndLastTimestamp(this.outgoingRtcpPacketsValue);
    this.storeFirstAndLastTimestamp(this.remoteEstimateEventsValue);

    // Stop events could be missing due to file size limits. If so, use the
    // last event, or the next start timestamp if available.
    // TODO(terelius): This could be improved. Instead of using the next start
    // event, we could use the timestamp of the the last previous regular event.
    let startUs = Timestamp.usOr(this.firstTimestampValue, kInt64Max);
    let nextStartUs = kInt64Max;
    let stopUs = kInt64Max;
    if (this.startLogEventsValue.length > 0) {
      startUs = Math.min(startUs, this.startLogEventsValue[0].logTimeUs());
      if (this.startLogEventsValue.length > 1) {
        nextStartUs = this.startLogEventsValue[1].logTimeUs();
      }
    }
    if (this.stopLogEventsValue.length > 0) {
      stopUs = this.stopLogEventsValue[0].logTimeUs();
    }
    stopUs = Math.min(stopUs, nextStartUs);
    if (stopUs === kInt64Max && !Timestamp.isMinusInfinity(this.lastTimestampValue)) {
      stopUs = Timestamp.us(this.lastTimestampValue);
    }
    if (!(startUs <= stopUs)) return ParseStatus.error("start_us<=stop_us");
    this.firstLogSegmentValue = new LogSegment(startUs, stopUs);

    if (this.firstTimestampValue > this.lastTimestampValue) {
      this.firstTimestampValue = this.lastTimestampValue = Timestamp.zero();
    }

    return status;
  }

  startLogEvents(): readonly LoggedStartEvent[] {
    return this.startLogEventsValue;
  }

  stopLogEvents(): readonly LoggedStopEvent[] {
    return this.stopLogEventsValue;
  }

  getMediaType(ssrc: number, direction: PacketDirection): MediaType {
    if (direction === PacketDirection.kIncomingPacket) {
      if (this.incomingVideoSsrcsValue.has(ssrc)) return MediaType.VIDEO;
      if (this.incomingAudioSsrcsValue.has(ssrc)) return MediaType.AUDIO;
    } else {
      if (this.outgoingVideoSsrcsValue.has(ssrc)) return MediaType.VIDEO;
      if (this.outgoingAudioSsrcsValue.has(ssrc)) return MediaType.AUDIO;
    }
    return MediaType.ANY;
  }

  incomingRtxSsrcs(): ReadonlySet<number> {
    return this.incomingRtxSsrcsValue;
  }
  incomingVideoSsrcs(): ReadonlySet<number> {
    return this.incomingVideoSsrcsValue;
  }
  incomingAudioSsrcs(): ReadonlySet<number> {
    return this.incomingAudioSsrcsValue;
  }
  outgoingRtxSsrcs(): ReadonlySet<number> {
    return this.outgoingRtxSsrcsValue;
  }
  outgoingVideoSsrcs(): ReadonlySet<number> {
    return this.outgoingVideoSsrcsValue;
  }
  outgoingAudioSsrcs(): ReadonlySet<number> {
    return this.outgoingAudioSsrcsValue;
  }

  audioRecvConfigs(): readonly LoggedAudioRecvConfig[] {
    return this.audioRecvConfigsValue;
  }
  audioSendConfigs(): readonly LoggedAudioSendConfig[] {
    return this.audioSendConfigsValue;
  }
  videoRecvConfigs(): readonly LoggedVideoRecvConfig[] {
    return this.videoRecvConfigsValue;
  }
  videoSendConfigs(): readonly LoggedVideoSendConfig[] {
    return this.videoSendConfigsValue;
  }

  audioPlayoutEvents(): ReadonlyMap<number, readonly LoggedAudioPlayoutEvent[]> {
    return this.audioPlayoutEventsValue;
  }

  neteqSetMinimumDelayEvents(): ReadonlyMap<number, readonly LoggedNetEqSetMinimumDelayEvent[]> {
    return this.neteqSetMinimumDelayEventsValue;
  }

  audioNetworkAdaptationEvents(): readonly LoggedAudioNetworkAdaptationEvent[] {
    return this.audioNetworkAdaptationEventsValue;
  }

  dtlsTransportStates(): readonly LoggedDtlsTransportState[] {
    return this.dtlsTransportStatesValue;
  }

  dtlsWritableStates(): readonly LoggedDtlsWritableState[] {
    return this.dtlsWritableStatesValue;
  }

  iceCandidatePairConfigs(): readonly LoggedIceCandidatePairConfig[] {
    return this.iceCandidatePairConfigsValue;
  }

  iceCandidatePairEvents(): readonly LoggedIceCandidatePairEvent[] {
    return this.iceCandidatePairEventsValue;
  }

  decodedFrames(): ReadonlyMap<number, readonly LoggedFrameDecoded[]> {
    return this.decodedFramesValue;
  }

  getIceCandidates(): LoggedIceCandidatePairConfig[] {
    const candidates: LoggedIceCandidatePairConfig[] = [];
    const added = new Set<number>();
    for (const candidate of this.iceCandidatePairConfigsValue) {
      if (!added.has(candidate.candidatePairId)) {
        candidates.push(candidate);
        added.add(candidate.candidatePairId);
      }
    }
    return candidates;
  }

  getRouteChanges(): InferredRouteChangeEvent[] {
    const routeChanges: InferredRouteChangeEvent[] = [];
    for (const candidate of this.iceCandidatePairConfigsValue) {
      if (candidate.type === IceCandidatePairConfigType.kSelected) {
        const route = new InferredRouteChangeEvent();
        route.routeId = candidate.candidatePairId;
        route.logTime = Timestamp.millis(candidate.logTimeMs());
        route.sendOverhead = kUdpOverhead + kSrtpOverhead + kIpv4Overhead;
        if (candidate.remoteAddressFamily === IceCandidatePairAddressFamily.kIpv6) {
          route.sendOverhead += kIpv6Overhead - kIpv4Overhead;
        }
        if (candidate.remoteCandidateType !== IceCandidateType.kHost) route.sendOverhead += kStunOverhead;
        route.returnOverhead = kUdpOverhead + kSrtpOverhead + kIpv4Overhead;
        if (candidate.remoteAddressFamily === IceCandidatePairAddressFamily.kIpv6) {
          route.returnOverhead += kIpv6Overhead - kIpv4Overhead;
        }
        if (candidate.remoteCandidateType !== IceCandidateType.kHost) route.returnOverhead += kStunOverhead;
        routeChanges.push(route);
      }
    }
    return routeChanges;
  }

  alrStateEvents(): readonly LoggedAlrStateEvent[] {
    return this.alrStateEventsValue;
  }

  bweProbeClusterCreatedEvents(): readonly LoggedBweProbeClusterCreatedEvent[] {
    return this.bweProbeClusterCreatedEventsValue;
  }

  bweProbeFailureEvents(): readonly LoggedBweProbeFailureEvent[] {
    return this.bweProbeFailureEventsValue;
  }

  bweProbeSuccessEvents(): readonly LoggedBweProbeSuccessEvent[] {
    return this.bweProbeSuccessEventsValue;
  }

  bweDelayUpdates(): readonly LoggedBweDelayBasedUpdate[] {
    return this.bweDelayUpdatesValue;
  }

  bweLossUpdates(): readonly LoggedBweLossBasedUpdate[] {
    return this.bweLossUpdatesValue;
  }

  bweScreamUpdates(): readonly LoggedBweScreamUpdate[] {
    return this.bweScreamUpdatesValue;
  }

  routeChangeEvents(): readonly LoggedRouteChangeEvent[] {
    return this.routeChangeEventsValue;
  }

  remoteEstimateEvents(): readonly LoggedRemoteEstimateEvent[] {
    return this.remoteEstimateEventsValue;
  }

  // Parsed RTCP blocks.
  private rtcpLists(direction: PacketDirection): RtcpBlockLists {
    return direction === PacketDirection.kIncomingPacket ? this.incomingRtcp : this.outgoingRtcp;
  }

  receiverReports(direction: PacketDirection): readonly LoggedRtcpPacketReceiverReport[] {
    return this.rtcpLists(direction).rr;
  }
  senderReports(direction: PacketDirection): readonly LoggedRtcpPacketSenderReport[] {
    return this.rtcpLists(direction).sr;
  }
  extendedReports(direction: PacketDirection): readonly LoggedRtcpPacketExtendedReports[] {
    return this.rtcpLists(direction).xr;
  }
  nacks(direction: PacketDirection): readonly LoggedRtcpPacketNack[] {
    return this.rtcpLists(direction).nack;
  }
  rembs(direction: PacketDirection): readonly LoggedRtcpPacketRemb[] {
    return this.rtcpLists(direction).remb;
  }
  firs(direction: PacketDirection): readonly LoggedRtcpPacketFir[] {
    return this.rtcpLists(direction).fir;
  }
  plis(direction: PacketDirection): readonly LoggedRtcpPacketPli[] {
    return this.rtcpLists(direction).pli;
  }
  byes(direction: PacketDirection): readonly LoggedRtcpPacketBye[] {
    return this.rtcpLists(direction).bye;
  }
  transportFeedbacks(direction: PacketDirection): readonly LoggedRtcpPacketTransportFeedback[] {
    return this.rtcpLists(direction).transportFeedback;
  }
  congestionFeedback(direction: PacketDirection): readonly LoggedRtcpCongestionControlFeedback[] {
    return this.rtcpLists(direction).congestionFeedback;
  }
  lossNotifications(direction: PacketDirection): readonly LoggedRtcpPacketLossNotification[] {
    return this.rtcpLists(direction).lossNotification;
  }

  getIncomingPacketInfos(): LoggedPacketInfo[] {
    return this.getPacketInfos(PacketDirection.kIncomingPacket);
  }

  getOutgoingPacketInfos(): LoggedPacketInfo[] {
    return this.getPacketInfos(PacketDirection.kOutgoingPacket);
  }

  getPacketInfos(direction: PacketDirection): LoggedPacketInfo[] {
    const streams = new Map<number, MediaStreamInfo>();
    // std::map::insert: an existing entry is kept.
    const insertStream = (ssrc: number, info: MediaStreamInfo) => {
      if (!streams.has(ssrc)) streams.set(ssrc, info);
    };
    if (direction === PacketDirection.kIncomingPacket) {
      for (const [configs, mediaType] of [
        [this.audioRecvConfigsValue, LoggedMediaType.kAudio],
        [this.videoRecvConfigsValue, LoggedMediaType.kVideo],
      ] as const) {
        for (const conf of configs) {
          insertStream(conf.config.remoteSsrc, new MediaStreamInfo(mediaType, false));
          if (conf.config.rtxSsrc !== 0) insertStream(conf.config.rtxSsrc, new MediaStreamInfo(mediaType, true));
        }
      }
    } else if (direction === PacketDirection.kOutgoingPacket) {
      for (const [configs, mediaType] of [
        [this.audioSendConfigsValue, LoggedMediaType.kAudio],
        [this.videoSendConfigsValue, LoggedMediaType.kVideo],
      ] as const) {
        for (const conf of configs) {
          insertStream(conf.config.localSsrc, new MediaStreamInfo(mediaType, false));
          if (conf.config.rtxSsrc !== 0) insertStream(conf.config.rtxSsrc, new MediaStreamInfo(mediaType, true));
        }
      }
    }

    const overheads = getOverheadChangingEvents(this.getRouteChanges(), direction);
    let overheadIter = 0;

    const packets: LoggedPacketInfo[] = [];
    // unwrapped transport sequence number -> index into packets
    let twccIndices = new Map<number, number>();
    const transportSeqNumUnwrapper = new RtpSequenceNumberUnwrapper();

    class PerSSRCInfo {
      private rtpSeqNumUnwrapper = new RtpSequenceNumberUnwrapper();
      // unwrapped rtp sequence number -> index into packets
      private packetIndices = new Map<number, number>();

      addPacketIndex(rtpSequenceNumber: number, index: number): void {
        this.packetIndices.set(this.rtpSeqNumUnwrapper.unwrap(rtpSequenceNumber), index);
      }

      findPacketIndex(rtpSequenceNumber: number): number | undefined {
        return this.packetIndices.get(this.rtpSeqNumUnwrapper.unwrap(rtpSequenceNumber));
      }
    }
    let ccfbIndices = new Map<number, PerSSRCInfo>();
    const ccfbInfo = (ssrc: number): PerSSRCInfo => {
      let info = ccfbIndices.get(ssrc);
      if (info === undefined) {
        info = new PerSSRCInfo();
        ccfbIndices.set(ssrc, info);
      }
      return info;
    };

    let currentOverhead = kDefaultOverhead;
    let lastLogTime = Timestamp.zero();

    const advanceTime = (newLogTime: Timestamp) => {
      if (overheadIter !== overheads.length && newLogTime >= overheads[overheadIter].timestamp) {
        currentOverhead = overheads[overheadIter].overhead;
        ++overheadIter;
      }
      // If we have a large time delta, it can be caused by a gap in logging,
      // therefore we don't want to match up sequence numbers as we might have had
      // a wraparound.
      if (newLogTime - lastLogTime > TimeDelta.millis(30_000)) {
        transportSeqNumUnwrapper.reset();
        twccIndices = new Map();
        ccfbIndices = new Map();
      }
      lastLogTime = newLogTime;
    };

    const rtpHandler = (rtp: LoggedRtpPacket) => {
      advanceTime(rtp.logTime());
      let stream = streams.get(rtp.header.ssrc);
      if (stream === undefined) {
        stream = new MediaStreamInfo();
        streams.set(rtp.header.ssrc, stream);
      }
      let captureTime = Timestamp.minusInfinity();
      if (!stream.rtx) {
        // RTX copy the timestamp of the retransmitted packets. This means that
        // RTX streams don't have a unique clock offset and frequency, so
        // the RTP timstamps can't be unwrapped.

        // Add an offset to avoid `capture_ticks` to become negative in the case
        // of reordering.
        const kStartingCaptureTimeTicks = 90 * 48 * 10000;
        const captureTicks = kStartingCaptureTimeTicks + stream.unwrapCaptureTicks.unwrap(rtp.header.timestamp);
        // TODO(srte): Use logged sample rate when it is added to the format.
        const seconds = captureTicks / (stream.mediaType === LoggedMediaType.kAudio ? 48000.0 : 90000.0);
        captureTime = Math.trunc(seconds * 1000000);
      }
      const logged = new LoggedPacketInfo(rtp, stream.mediaType, stream.rtx, captureTime);
      logged.overhead = currentOverhead;
      if (logged.hasTransportSeqNo) {
        logged.logFeedbackTime = Timestamp.plusInfinity();
        const unwrappedSeqNum = transportSeqNumUnwrapper.unwrap(logged.transportSeqNo);
        // (Upstream logs a warning on a repeated sequence number.)
        twccIndices.set(unwrappedSeqNum, packets.length);
      } else {
        ccfbInfo(rtp.header.ssrc).addPacketIndex(rtp.header.sequenceNumber, packets.length);
      }
      packets.push(logged);
    };

    let twccFeedbackBaseTime = Timestamp.minusInfinity();
    let twccLastFeedbackBaseTime = Timestamp.minusInfinity();

    const twccFeedbackHandler = (loggedRtcp: LoggedRtcpPacketTransportFeedback) => {
      const logFeedbackTime = loggedRtcp.logTime();
      advanceTime(logFeedbackTime);
      const feedback = loggedRtcp.transportFeedback;
      // Add timestamp deltas to a local time base selected on first packet
      // arrival. This won't be the true time base, but makes it easier to
      // manually inspect time stamps.
      if (!Timestamp.isFinite(twccLastFeedbackBaseTime)) {
        twccFeedbackBaseTime = logFeedbackTime;
      } else {
        twccFeedbackBaseTime += feedback.getBaseDelta(twccLastFeedbackBaseTime);
      }
      twccLastFeedbackBaseTime = feedback.baseTime();

      const packetFeedbacks: LoggedPacketInfo[] = [];
      feedback.forAllPackets((sequenceNumber, deltaSinceBase) => {
        const unwrappedSeqNum = transportSeqNumUnwrapper.unwrap(sequenceNumber);
        const index = twccIndices.get(unwrappedSeqNum);
        if (index === undefined) {
          // Feedback for an unknown packet (upstream logs a warning).
          return;
        }
        const sent = packets[index];
        if (logFeedbackTime - sent.logPacketTime > TimeDelta.millis(60_000)) {
          // Received very late feedback, possibly due to wraparound.
          return;
        }
        if (Number.isFinite(deltaSinceBase)) {
          if (!Number.isFinite(sent.reportedRecvTime)) {
            sent.reportedRecvTime = twccFeedbackBaseTime + deltaSinceBase;
            sent.logFeedbackTime = logFeedbackTime;
          }
        } else {
          if (!Number.isFinite(sent.reportedRecvTime) && !Number.isFinite(sent.logFeedbackTime)) {
            sent.reportedRecvTime = Timestamp.plusInfinity();
            sent.logFeedbackTime = logFeedbackTime;
          }
        }
        packetFeedbacks.push(sent);
      });
      if (packetFeedbacks.length === 0) return;
      const last = packetFeedbacks[packetFeedbacks.length - 1];
      last.lastInFeedback = true;
      for (const fb of packetFeedbacks) {
        if (direction === PacketDirection.kOutgoingPacket) {
          if (Number.isFinite(last.reportedRecvTime) && Number.isFinite(fb.reportedRecvTime)) {
            fb.feedbackHoldDuration = last.reportedRecvTime - fb.reportedRecvTime;
          }
        } else {
          fb.feedbackHoldDuration = logFeedbackTime - fb.logPacketTime;
        }
      }
    };

    let ccfbFeedbackOffset = Timestamp.minusInfinity();
    let lastFeedbackCompactNtpTime: number | undefined = undefined;
    const ccfbFeedbackHandler = (loggedRtcp: LoggedRtcpCongestionControlFeedback) => {
      const logFeedbackTime = loggedRtcp.logTime();
      advanceTime(logFeedbackTime);
      const feedback = loggedRtcp.congestionFeedback;
      if (!Number.isFinite(ccfbFeedbackOffset)) {
        ccfbFeedbackOffset = logFeedbackTime;
      }
      const feedbackDelta =
        lastFeedbackCompactNtpTime !== undefined
          ? compactNtpIntervalToTimeDelta((feedback.reportTimestampCompactNtp() - lastFeedbackCompactNtpTime) >>> 0)
          : 0;
      lastFeedbackCompactNtpTime = feedback.reportTimestampCompactNtp();
      if (feedbackDelta < TimeDelta.millis(-5000)) {
        // Unexpected feedback ntp time delta (upstream logs a warning).
        ccfbFeedbackOffset = logFeedbackTime;
      } else {
        ccfbFeedbackOffset += feedbackDelta;
      }
      for (const packet of feedback.packets()) {
        const packetsIndex = ccfbInfo(packet.ssrc).findPacketIndex(packet.sequenceNumber);
        if (packetsIndex === undefined) {
          // Feedback for an unknown packet (upstream logs a warning).
          continue;
        }
        const sent = packets[packetsIndex];
        if (logFeedbackTime - sent.logPacketTime > TimeDelta.millis(60_000)) {
          // Received very late feedback, possibly due to wraparound. Like
          // upstream, this ends the processing of the whole feedback message.
          return;
        }
        if (Number.isFinite(packet.arrivalTimeOffset)) {
          if (!Number.isFinite(sent.reportedRecvTime)) {
            sent.logFeedbackTime = logFeedbackTime;
            sent.feedbackHoldDuration = packet.arrivalTimeOffset;
            sent.reportedRecvTime = ccfbFeedbackOffset - packet.arrivalTimeOffset;
          }
        } else {
          if (!Number.isFinite(sent.logFeedbackTime)) {
            sent.logFeedbackTime = logFeedbackTime;
            sent.reportedRecvTime = Timestamp.plusInfinity();
          }
        }
      }
    };

    const process = new RtcEventProcessor();
    for (const rtpPackets of this.rtpPacketsBySsrc(direction)) {
      process.addEvents(rtpPackets.packetView, rtpHandler, rtpTypeOrder(direction), rtpTransportSeqNum);
    }
    if (direction === PacketDirection.kOutgoingPacket) {
      process.addEvents(this.incomingRtcp.transportFeedback, twccFeedbackHandler, rtcpTypeOrder(PacketDirection.kIncomingPacket));
      process.addEvents(this.incomingRtcp.congestionFeedback, ccfbFeedbackHandler, rtcpTypeOrder(PacketDirection.kIncomingPacket));
    } else {
      process.addEvents(this.outgoingRtcp.transportFeedback, twccFeedbackHandler, rtcpTypeOrder(PacketDirection.kOutgoingPacket));
      process.addEvents(this.outgoingRtcp.congestionFeedback, ccfbFeedbackHandler, rtcpTypeOrder(PacketDirection.kOutgoingPacket));
    }
    process.processEventsInOrder();

    if (ccfbIndices.size !== 0) {
      // The log stores RTP packets by stream (with millisecond timestamps), but
      // doesn't guarantee the order between packets sent or received at the same
      // time on different SSRCs. We don't have transport sequence numbers when
      // CCFB is used, so the order can't be reconstructed using those.
      // process.ProcessEventsInOrder() will set log feedback time per packet
      // based on when feedback was originally received/sent for a packet, and we
      // can use that to ensure packets are at least ordered as originally seen in
      // feedback.
      // (Array.prototype.sort is stable, like std::stable_sort.)
      packets.sort((a, b) => {
        if (a.logPacketTime === b.logPacketTime) {
          return a.logFeedbackTime < b.logFeedbackTime ? -1 : a.logFeedbackTime > b.logFeedbackTime ? 1 : 0;
        }
        return a.logPacketTime < b.logPacketTime ? -1 : 1;
      });
    }
    return packets;
  }

  getIceEvents(): LoggedIceEvent[] {
    const checkMap = new Map<IceCandidatePairEventType, LoggedIceEventType>([
      [IceCandidatePairEventType.kCheckSent, LoggedIceEventType.kCheckSent],
      [IceCandidatePairEventType.kCheckReceived, LoggedIceEventType.kCheckReceived],
      [IceCandidatePairEventType.kCheckResponseSent, LoggedIceEventType.kCheckResponseSent],
      [IceCandidatePairEventType.kCheckResponseReceived, LoggedIceEventType.kCheckResponseReceived],
    ]);
    const configMap = new Map<IceCandidatePairConfigType, LoggedIceEventType>([
      [IceCandidatePairConfigType.kAdded, LoggedIceEventType.kAdded],
      [IceCandidatePairConfigType.kUpdated, LoggedIceEventType.kUpdated],
      [IceCandidatePairConfigType.kDestroyed, LoggedIceEventType.kDestroyed],
      [IceCandidatePairConfigType.kSelected, LoggedIceEventType.kSelected],
    ]);
    const logEvents: LoggedIceEvent[] = [];
    // std::map::operator[] default-inserts value 0 (kAdded) for unknown keys.
    const handleCheck = (check: LoggedIceCandidatePairEvent) => {
      logEvents.push(
        new LoggedIceEvent(check.candidatePairId, Timestamp.millis(check.logTimeMs()), checkMap.get(check.type) ?? LoggedIceEventType.kAdded),
      );
    };
    const handleConfig = (conf: LoggedIceCandidatePairConfig) => {
      logEvents.push(
        new LoggedIceEvent(conf.candidatePairId, Timestamp.millis(conf.logTimeMs()), configMap.get(conf.type) ?? LoggedIceEventType.kAdded),
      );
    };
    const process = new RtcEventProcessor();
    process.addEvents(this.iceCandidatePairEventsValue, handleCheck, TypeOrder.IceCandidateEvent);
    process.addEvents(this.iceCandidatePairConfigsValue, handleConfig, TypeOrder.IceCondidateConfig);
    process.processEventsInOrder();
    return logEvents;
  }

  // RTP
  incomingRtpPacketsBySsrc(): readonly LoggedRtpStreamIncoming[] {
    return this.incomingRtpPacketsBySsrcValue;
  }

  outgoingRtpPacketsBySsrc(): readonly LoggedRtpStreamOutgoing[] {
    return this.outgoingRtpPacketsBySsrcValue;
  }

  rtpPacketsBySsrc(direction: PacketDirection): readonly LoggedRtpStreamView[] {
    if (direction === PacketDirection.kIncomingPacket) {
      return this.incomingRtpPacketViewsBySsrc;
    } else {
      return this.outgoingRtpPacketViewsBySsrc;
    }
  }

  // RTCP
  incomingRtcpPackets(): readonly LoggedRtcpPacketIncoming[] {
    return this.incomingRtcpPacketsValue;
  }

  outgoingRtcpPackets(): readonly LoggedRtcpPacketOutgoing[] {
    return this.outgoingRtcpPacketsValue;
  }

  firstTimestamp(): Timestamp {
    return this.firstTimestampValue;
  }

  lastTimestamp(): Timestamp {
    return this.lastTimestampValue;
  }

  firstLogSegment(): LogSegment {
    return this.firstLogSegmentValue;
  }

  // The per-event parse statuses are ignored, like upstream: an event that
  // fails to parse leaves default-constructed entries behind, and events whose
  // v3 parser is not implemented upstream ("Not Implemented") are dropped.
  private parseStreamInternalV3(s: Uint8Array): ParseStatus {
    const kMaxEventSize = 10000000n; // Sanity check.
    let expectBeginLogEvent = true;

    while (s.length !== 0) {
      // Read event type.
      const tagResult = decodeVarInt(s);
      if (!tagResult.success) return ParseStatus.error("Failed to read event type.");
      s = tagResult.rest;
      const eventTag = tagResult.value;
      const batched = (eventTag & 1n) !== 0n;
      const eventType = eventTag >> 1n;

      // Read event size
      const sizeResult = decodeVarInt(s);
      if (!sizeResult.success) return ParseStatus.error("Failed to read event size.");
      s = sizeResult.rest;
      const eventSizeBytes = sizeResult.value;
      if (eventSizeBytes > kMaxEventSize || eventSizeBytes > BigInt(s.length)) {
        // Event size is too large.
        if (!(eventSizeBytes <= kMaxEventSize)) return ParseStatus.error("event_size_bytes<=kMaxEventSize");
        if (!(eventSizeBytes <= BigInt(s.length))) return ParseStatus.error("event_size_bytes<=s.size()");
      }

      // Read remaining event fields into a buffer.
      const eventFields = s.subarray(0, Number(eventSizeBytes));
      s = s.subarray(Number(eventSizeBytes));

      if (expectBeginLogEvent) {
        if (eventType !== BigInt(RtcEventType.BeginV3Log)) {
          return ParseStatus.error("event_type==static_cast<uint32_t>(RtcEvent::Type::BeginV3Log)");
        }
        expectBeginLogEvent = false;
      }

      switch (eventType) {
        case BigInt(RtcEventType.BeginV3Log):
          RtcEventBeginLog.parse(eventFields, batched, this.startLogEventsValue);
          break;
        case BigInt(RtcEventType.EndV3Log):
          RtcEventEndLog.parse(eventFields, batched, this.stopLogEventsValue);
          expectBeginLogEvent = true;
          break;
        case BigInt(RtcEventType.AlrStateEvent):
          RtcEventAlrState.parse(eventFields, batched, this.alrStateEventsValue);
          break;
        case BigInt(RtcEventType.AudioPlayout):
          RtcEventAudioPlayout.parse(eventFields, batched, this.audioPlayoutEventsValue);
          break;
        case BigInt(RtcEventType.BweUpdateDelayBased):
          RtcEventBweUpdateDelayBased.parse(eventFields, batched, this.bweDelayUpdatesValue);
          break;
        // AudioNetworkAdaptation, Audio/Video Receive/Send StreamConfig,
        // BweUpdateLossBased, DtlsTransportState, DtlsWritableState,
        // FrameDecoded, IceCandidatePairConfig/Event, ProbeClusterCreated,
        // ProbeResultFailure/Success, RemoteEstimate, RouteChange and
        // Rtp/RtcpPacketIncoming/Outgoing: their v3 Parse returns
        // "Not Implemented" upstream without touching the output.
        default:
          break;
      }
    }

    return ParseStatus.success();
  }

  private parseStreamInternal(s: Uint8Array): ParseStatus {
    const kMaxEventSize = 10000000n; // Sanity check.
    // Protobuf defines the message tag as
    // (field_number << 3) | wire_type. In the legacy encoding, the field number
    // is supposed to be 1 and the wire type for a length-delimited field is 2.
    // In the new encoding we still expect the wire type to be 2, but the field
    // number will be greater than 1.
    const kExpectedV1Tag = (1n << 3n) | 2n;

    // "Peek" at the first varint.
    const peek = decodeVarInt(s);
    if (!peek.success) {
      if (this.allowIncompleteLogs) return ParseStatus.success(); // kIncompleteLogError
      return ParseStatus.error("Failed to read field tag varint");
    }

    if (peek.value >> 1n === BigInt(RtcEventType.BeginV3Log)) {
      return this.parseStreamInternalV3(s);
    }

    while (s.length !== 0) {
      // If not, "reset" event_start and read the field tag for the next event.
      const eventStart = s;
      const tagResult = decodeVarInt(s);
      if (!tagResult.success) {
        if (this.allowIncompleteLogs) return this.warnIncomplete();
        return ParseStatus.error("Failed to read field tag varint");
      }
      const tag = tagResult.value;
      s = tagResult.rest;

      const kWireTypeMask = 0x07n;
      const wireType = tag & kWireTypeMask;
      if (wireType !== 2n) {
        if (this.allowIncompleteLogs) return this.warnIncomplete();
        return ParseStatus.error("wire_type==2");
      }

      // Read the length field.
      const lengthResult = decodeVarInt(s);
      if (!lengthResult.success) {
        if (this.allowIncompleteLogs) return this.warnIncomplete();
        return ParseStatus.error("Failed to read message length varint");
      }
      const messageLength = lengthResult.value;
      s = lengthResult.rest;

      if (messageLength > BigInt(s.length)) {
        if (this.allowIncompleteLogs) return this.warnIncomplete();
        return ParseStatus.error(
          "Incomplete message: the length of the next message is larger than the remaining bytes in the proto",
        );
      }

      if (!(messageLength <= kMaxEventSize)) return ParseStatus.error("message_length<=kMaxEventSize");
      // Skip forward to the start of the next event.
      s = s.subarray(Number(messageLength));
      const totalEventSize = eventStart.length - s.length;
      const event = eventStart.subarray(0, totalEventSize);

      if (tag === kExpectedV1Tag) {
        // Parse the protobuf event from the buffer.
        let eventStream: rtclog.EventStream;
        try {
          eventStream = fromBinary(rtclog.EventStreamSchema, event);
        } catch {
          if (this.allowIncompleteLogs) return this.warnIncomplete();
          return ParseStatus.error("false");
        }
        if (eventStream.stream.length !== 1) return ParseStatus.error("event_stream.stream_size()==1");
        const status = this.storeParsedLegacyEvent(eventStream.stream[0]);
        if (!status.ok()) return status;
      } else {
        // Parse the protobuf event from the buffer.
        let eventStream: EventStream;
        try {
          eventStream = fromBinary(EventStreamSchema, event);
        } catch {
          if (this.allowIncompleteLogs) return this.warnIncomplete();
          return ParseStatus.error("false");
        }
        const status = this.storeParsedNewFormatEvent(eventStream);
        if (!status.ok()) return status;
      }
    }
    return ParseStatus.success();
  }

  private warnIncomplete(): ParseStatus {
    // RTC_PARSE_WARN_AND_RETURN_SUCCESS_IF(allow_incomplete_logs_, kIncompleteLogError)
    void kIncompleteLogError;
    return ParseStatus.success();
  }

  private storeFirstAndLastTimestamp(v: readonly HasLogTime[]): void {
    if (v.length === 0) return;
    this.firstTimestampValue = Math.min(this.firstTimestampValue, v[0].logTime());
    this.lastTimestampValue = Math.max(this.lastTimestampValue, v[v.length - 1].logTime());
  }

  private storeParsedNewFormatEvent(stream: EventStream): ParseStatus {
    if (stream.incomingRtpPackets.length === 1) {
      return this.storeIncomingRtpPackets(stream.incomingRtpPackets[0]);
    } else if (stream.outgoingRtpPackets.length === 1) {
      return this.storeOutgoingRtpPackets(stream.outgoingRtpPackets[0]);
    } else if (stream.incomingRtcpPackets.length === 1) {
      return this.storeIncomingRtcpPackets(stream.incomingRtcpPackets[0]);
    } else if (stream.outgoingRtcpPackets.length === 1) {
      return this.storeOutgoingRtcpPackets(stream.outgoingRtcpPackets[0]);
    } else if (stream.beginLogEvents.length === 1) {
      return this.storeStartEvent(stream.beginLogEvents[0]);
    } else if (stream.endLogEvents.length === 1) {
      return this.storeStopEvent(stream.endLogEvents[0]);
    } else if (stream.lossBasedBweUpdates.length === 1) {
      return this.storeBweLossBasedUpdate(stream.lossBasedBweUpdates[0]);
    } else if (stream.delayBasedBweUpdates.length === 1) {
      return this.storeBweDelayBasedUpdate(stream.delayBasedBweUpdates[0]);
    } else if (stream.screamBweUpdates.length === 1) {
      return this.storeBweScreamUpdate(stream.screamBweUpdates[0]);
    } else if (stream.probeClusters.length === 1) {
      return this.storeBweProbeClusterCreated(stream.probeClusters[0]);
    } else if (stream.probeSuccess.length === 1) {
      return this.storeBweProbeSuccessEvent(stream.probeSuccess[0]);
    } else if (stream.probeFailure.length === 1) {
      return this.storeBweProbeFailureEvent(stream.probeFailure[0]);
    } else if (stream.alrStates.length === 1) {
      return this.storeAlrStateEvent(stream.alrStates[0]);
    } else if (stream.routeChanges.length === 1) {
      return this.storeRouteChangeEvent(stream.routeChanges[0]);
    } else if (stream.remoteEstimates.length === 1) {
      return this.storeRemoteEstimateEvent(stream.remoteEstimates[0]);
    } else if (stream.audioPlayoutEvents.length === 1) {
      return this.storeAudioPlayoutEvent(stream.audioPlayoutEvents[0]);
    } else if (stream.dtlsTransportStateEvents.length === 1) {
      return this.storeDtlsTransportState(stream.dtlsTransportStateEvents[0]);
    } else if (stream.dtlsWritableStates.length === 1) {
      return this.storeDtlsWritableState(stream.dtlsWritableStates[0]);
    } else if (stream.audioNetworkAdaptations.length === 1) {
      return this.storeAudioNetworkAdaptationEvent(stream.audioNetworkAdaptations[0]);
    } else if (stream.iceCandidateConfigs.length === 1) {
      return this.storeIceCandidatePairConfig(stream.iceCandidateConfigs[0]);
    } else if (stream.iceCandidateEvents.length === 1) {
      return this.storeIceCandidateEvent(stream.iceCandidateEvents[0]);
    } else if (stream.audioRecvStreamConfigs.length === 1) {
      return this.storeAudioRecvConfig(stream.audioRecvStreamConfigs[0]);
    } else if (stream.audioSendStreamConfigs.length === 1) {
      return this.storeAudioSendConfig(stream.audioSendStreamConfigs[0]);
    } else if (stream.videoRecvStreamConfigs.length === 1) {
      return this.storeVideoRecvConfig(stream.videoRecvStreamConfigs[0]);
    } else if (stream.videoSendStreamConfigs.length === 1) {
      return this.storeVideoSendConfig(stream.videoSendStreamConfigs[0]);
    } else if (
      stream.genericPacketsReceived.length === 1 ||
      stream.genericPacketsSent.length === 1 ||
      stream.genericAcksReceived.length === 1
    ) {
      // Generic packet type is deprecated. Ignore the proto event.
      return ParseStatus.success();
    } else if (stream.frameDecodedEvents.length === 1) {
      return this.storeFrameDecodedEvents(stream.frameDecodedEvents[0]);
    } else if (stream.neteqSetMinimumDelay.length === 1) {
      return this.storeNetEqSetMinimumDelay(stream.neteqSetMinimumDelay[0]);
    } else {
      // RTC_DCHECK_NOTREACHED() upstream: an EventStream without exactly one
      // known event (e.g. a newer field).
      return ParseStatus.success();
    }
  }

  private storeIncomingRtpPackets(proto: IncomingRtpPackets): ParseStatus {
    return storeRtpPackets(IncomingRtpPacketsSchema, proto, LoggedRtpPacketIncoming, this.incomingRtpPacketsMap);
  }

  private storeOutgoingRtpPackets(proto: OutgoingRtpPackets): ParseStatus {
    return storeRtpPackets(OutgoingRtpPacketsSchema, proto, LoggedRtpPacketOutgoing, this.outgoingRtpPacketsMap);
  }

  private storeIncomingRtcpPackets(proto: IncomingRtcpPackets): ParseStatus {
    return storeRtcpPackets(
      IncomingRtcpPacketsSchema,
      proto,
      LoggedRtcpPacketIncoming,
      this.incomingRtcpPacketsValue,
      /*removeDuplicates=*/ true,
    );
  }

  private storeOutgoingRtcpPackets(proto: OutgoingRtcpPackets): ParseStatus {
    return storeRtcpPackets(
      OutgoingRtcpPacketsSchema,
      proto,
      LoggedRtcpPacketOutgoing,
      this.outgoingRtcpPacketsValue,
      /*removeDuplicates=*/ false,
    );
  }

  private storeStartEvent(proto: BeginLogEvent): ParseStatus {
    const S = BeginLogEventSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "version")) return ParseStatus.error("proto.has_version()");
    if (!has(S, proto, "utcTimeMs")) return ParseStatus.error("proto.has_utc_time_ms()");
    if (proto.version !== 2) return ParseStatus.error("proto.version()==2");
    const startEvent = new LoggedStartEvent(Timestamp.millis(proto.timestampMs), Timestamp.millis(proto.utcTimeMs));

    this.startLogEventsValue.push(startEvent);
    return ParseStatus.success();
  }

  private storeStopEvent(proto: EndLogEvent): ParseStatus {
    if (!has(EndLogEventSchema, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    const stopEvent = new LoggedStopEvent(Timestamp.millis(proto.timestampMs));

    this.stopLogEventsValue.push(stopEvent);
    return ParseStatus.success();
  }

  private storeAlrStateEvent(proto: AlrState): ParseStatus {
    if (!has(AlrStateSchema, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(AlrStateSchema, proto, "inAlr")) return ParseStatus.error("proto.has_in_alr()");
    const alrEvent = new LoggedAlrStateEvent(Timestamp.millis(proto.timestampMs), proto.inAlr);
    this.alrStateEventsValue.push(alrEvent);
    // TODO(terelius): Should we delta encode this event type?
    return ParseStatus.success();
  }

  private storeRouteChangeEvent(proto: RouteChange): ParseStatus {
    const S = RouteChangeSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "connected")) return ParseStatus.error("proto.has_connected()");
    if (!has(S, proto, "overhead")) return ParseStatus.error("proto.has_overhead()");
    const routeEvent = new LoggedRouteChangeEvent(Timestamp.millis(proto.timestampMs), proto.connected, proto.overhead);
    this.routeChangeEventsValue.push(routeEvent);
    // TODO(terelius): Should we delta encode this event type?
    return ParseStatus.success();
  }

  private storeRemoteEstimateEvent(proto: RemoteEstimates): ParseStatus {
    const S = RemoteEstimatesSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    // Base event
    const baseEvent = new LoggedRemoteEstimateEvent(Timestamp.millis(proto.timestampMs));
    let baseLinkCapacityLowerKbps: OptionalU64;
    if (has(S, proto, "linkCapacityLowerKbps")) {
      baseLinkCapacityLowerKbps = BigInt(proto.linkCapacityLowerKbps);
      baseEvent.linkCapacityLower = DataRate.kilobitsPerSec(proto.linkCapacityLowerKbps);
    }
    let baseLinkCapacityUpperKbps: OptionalU64;
    if (has(S, proto, "linkCapacityUpperKbps")) {
      baseLinkCapacityUpperKbps = BigInt(proto.linkCapacityUpperKbps);
      baseEvent.linkCapacityUpper = DataRate.kilobitsPerSec(proto.linkCapacityUpperKbps);
    }
    this.remoteEstimateEventsValue.push(baseEvent);

    const numberOfDeltas = has(S, proto, "numberOfDeltas") ? proto.numberOfDeltas : 0;
    if (numberOfDeltas === 0) {
      return ParseStatus.success();
    }

    // timestamp_ms
    const timestampMsValues = decodeField("timestamp_ms", proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64), numberOfDeltas);
    if (timestampMsValues instanceof RtcEventLogParseStatus) return timestampMsValues;
    // link_capacity_lower_kbps
    const lowerValues = decodeField("link_capacity_lower_kbps", proto.linkCapacityLowerKbpsDeltas, baseLinkCapacityLowerKbps, numberOfDeltas);
    if (lowerValues instanceof RtcEventLogParseStatus) return lowerValues;
    // link_capacity_upper_kbps
    const upperValues = decodeField("link_capacity_upper_kbps", proto.linkCapacityUpperKbpsDeltas, baseLinkCapacityUpperKbps, numberOfDeltas);
    if (upperValues instanceof RtcEventLogParseStatus) return upperValues;

    // Populate events from decoded deltas
    for (let i = 0; i < numberOfDeltas; ++i) {
      const timestampMs = timestampMsValues[i];
      if (timestampMs === undefined) return ParseStatus.error("timestamp_ms_values[i].has_value()");
      // Upstream converts the uint64 to int64 implicitly here (no ToSigned).
      const event = new LoggedRemoteEstimateEvent(Timestamp.millis(BigInt.asIntN(64, timestampMs)));
      const lower = lowerValues[i];
      if (lower !== undefined) event.linkCapacityLower = DataRate.kilobitsPerSec(lower);
      const upper = upperValues[i];
      if (upper !== undefined) event.linkCapacityUpper = DataRate.kilobitsPerSec(upper);
      this.remoteEstimateEventsValue.push(event);
    }
    return ParseStatus.success();
  }

  private storeBweLossBasedUpdate(proto: LossBasedBweUpdates): ParseStatus {
    const S = LossBasedBweUpdatesSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "bitrateBps")) return ParseStatus.error("proto.has_bitrate_bps()");
    if (!has(S, proto, "fractionLoss")) return ParseStatus.error("proto.has_fraction_loss()");
    if (!has(S, proto, "totalPackets")) return ParseStatus.error("proto.has_total_packets()");

    // Base event (the uint32 proto values narrow to the struct's int32/uint8).
    this.bweLossUpdatesValue.push(
      new LoggedBweLossBasedUpdate(
        Timestamp.millis(proto.timestampMs),
        asInt32(proto.bitrateBps),
        proto.fractionLoss & 0xff,
        asInt32(proto.totalPackets),
      ),
    );

    const numberOfDeltas = has(S, proto, "numberOfDeltas") ? proto.numberOfDeltas : 0;
    if (numberOfDeltas === 0) {
      return ParseStatus.success();
    }

    const timestampMsValues = decodeField("timestamp_ms", proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64), numberOfDeltas);
    if (timestampMsValues instanceof RtcEventLogParseStatus) return timestampMsValues;
    const bitrateBpsValues = decodeField("bitrate_bps", proto.bitrateBpsDeltas, BigInt(proto.bitrateBps), numberOfDeltas);
    if (bitrateBpsValues instanceof RtcEventLogParseStatus) return bitrateBpsValues;
    const fractionLossValues = decodeField("fraction_loss", proto.fractionLossDeltas, BigInt(proto.fractionLoss), numberOfDeltas);
    if (fractionLossValues instanceof RtcEventLogParseStatus) return fractionLossValues;
    const totalPacketsValues = decodeField("total_packets", proto.totalPacketsDeltas, BigInt(proto.totalPackets), numberOfDeltas);
    if (totalPacketsValues instanceof RtcEventLogParseStatus) return totalPacketsValues;

    // Populate events from decoded deltas
    for (let i = 0; i < numberOfDeltas; ++i) {
      const timestampMs = deltaTimestampMs(timestampMsValues, i);
      if (timestampMs instanceof RtcEventLogParseStatus) return timestampMs;
      const bitrateBps = deltaU32("bitrate_bps", bitrateBpsValues, i);
      if (bitrateBps instanceof RtcEventLogParseStatus) return bitrateBps;
      const fractionLoss = deltaU32("fraction_loss", fractionLossValues, i);
      if (fractionLoss instanceof RtcEventLogParseStatus) return fractionLoss;
      const totalPackets = deltaU32("total_packets", totalPacketsValues, i);
      if (totalPackets instanceof RtcEventLogParseStatus) return totalPackets;
      this.bweLossUpdatesValue.push(
        new LoggedBweLossBasedUpdate(Timestamp.millis(timestampMs), asInt32(bitrateBps), fractionLoss & 0xff, asInt32(totalPackets)),
      );
    }
    return ParseStatus.success();
  }

  private storeBweDelayBasedUpdate(proto: DelayBasedBweUpdates): ParseStatus {
    const S = DelayBasedBweUpdatesSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "bitrateBps")) return ParseStatus.error("proto.has_bitrate_bps()");
    if (!has(S, proto, "detectorState")) return ParseStatus.error("proto.has_detector_state()");

    // Base event
    const baseDetectorState = getRuntimeDetectorState(proto.detectorState);
    this.bweDelayUpdatesValue.push(
      new LoggedBweDelayBasedUpdate(Timestamp.millis(proto.timestampMs), asInt32(proto.bitrateBps), baseDetectorState),
    );

    const numberOfDeltas = has(S, proto, "numberOfDeltas") ? proto.numberOfDeltas : 0;
    if (numberOfDeltas === 0) {
      return ParseStatus.success();
    }

    const timestampMsValues = decodeField("timestamp_ms", proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64), numberOfDeltas);
    if (timestampMsValues instanceof RtcEventLogParseStatus) return timestampMsValues;
    const bitrateBpsValues = decodeField("bitrate_bps", proto.bitrateBpsDeltas, BigInt(proto.bitrateBps), numberOfDeltas);
    if (bitrateBpsValues instanceof RtcEventLogParseStatus) return bitrateBpsValues;
    const detectorStateValues = decodeField(
      "detector_state",
      proto.detectorStateDeltas,
      BigInt.asUintN(64, BigInt(proto.detectorState)),
      numberOfDeltas,
    );
    if (detectorStateValues instanceof RtcEventLogParseStatus) return detectorStateValues;

    // Populate events from decoded deltas
    for (let i = 0; i < numberOfDeltas; ++i) {
      const timestampMs = deltaTimestampMs(timestampMsValues, i);
      if (timestampMs instanceof RtcEventLogParseStatus) return timestampMs;
      const bitrateBps = deltaU32("bitrate_bps", bitrateBpsValues, i);
      if (bitrateBps instanceof RtcEventLogParseStatus) return bitrateBps;
      const detectorState = detectorStateValues[i];
      if (detectorState === undefined) return ParseStatus.error("detector_state_values[i].has_value()");
      this.bweDelayUpdatesValue.push(
        new LoggedBweDelayBasedUpdate(
          Timestamp.millis(timestampMs),
          asInt32(bitrateBps),
          // static_cast to the proto enum (an int).
          getRuntimeDetectorState(Number(BigInt.asIntN(32, detectorState)) as DelayBasedBweUpdates_DetectorState),
        ),
      );
    }
    return ParseStatus.success();
  }

  private storeBweScreamUpdate(proto: ScreamBweUpdates): ParseStatus {
    const S = ScreamBweUpdatesSchema;
    for (const field of [
      "timestampMs",
      "refWindowBytes",
      "dataInFlightBytes",
      "targetRateKbps",
      "smoothedRttMs",
      "avgQueueDelayMs",
      "l4sMarkedPermille",
    ] as const) {
      if (!has(S, proto, field)) return ParseStatus.error(`proto.has_${field}()`);
    }

    // Base event
    this.bweScreamUpdatesValue.push(
      new LoggedBweScreamUpdate(
        Timestamp.millis(proto.timestampMs),
        proto.refWindowBytes,
        proto.dataInFlightBytes,
        proto.targetRateKbps,
        proto.smoothedRttMs,
        proto.avgQueueDelayMs,
        proto.l4sMarkedPermille,
      ),
    );

    const numberOfDeltas = has(S, proto, "numberOfDeltas") ? proto.numberOfDeltas : 0;
    if (numberOfDeltas === 0) {
      return ParseStatus.success();
    }

    const timestampMsValues = decodeField("timestamp_ms", proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64), numberOfDeltas);
    if (timestampMsValues instanceof RtcEventLogParseStatus) return timestampMsValues;
    const fields = [
      ["ref_window_bytes", proto.refWindowBytesDeltas, proto.refWindowBytes],
      ["data_in_flight_bytes", proto.dataInFlightBytesDeltas, proto.dataInFlightBytes],
      ["target_rate_kbps", proto.targetRateKbpsDeltas, proto.targetRateKbps],
      ["smoothed_rtt_ms", proto.smoothedRttMsDeltas, proto.smoothedRttMs],
      ["avg_queue_delay_ms", proto.avgQueueDelayMsDeltas, proto.avgQueueDelayMs],
      ["l4s_marked_permille", proto.l4sMarkedPermilleDeltas, proto.l4sMarkedPermille],
    ] as const;
    const decoded: OptionalU64[][] = [];
    for (const [name, deltas, base] of fields) {
      const values = decodeField(name, deltas, BigInt(base), numberOfDeltas);
      if (values instanceof RtcEventLogParseStatus) return values;
      decoded.push(values);
    }

    // Populate events from decoded deltas
    for (let i = 0; i < numberOfDeltas; ++i) {
      const timestampMs = deltaTimestampMs(timestampMsValues, i);
      if (timestampMs instanceof RtcEventLogParseStatus) return timestampMs;
      const values: number[] = [];
      for (let f = 0; f < fields.length; ++f) {
        const value = deltaU32(fields[f][0], decoded[f], i);
        if (value instanceof RtcEventLogParseStatus) return value;
        values.push(value);
      }
      const [refWindowBytes, dataInFlightBytes, targetRateKbps, smoothedRttMs, avgQueueDelayMs, l4sMarkedPermille] = values;
      this.bweScreamUpdatesValue.push(
        new LoggedBweScreamUpdate(
          Timestamp.millis(timestampMs),
          refWindowBytes,
          dataInFlightBytes,
          targetRateKbps,
          smoothedRttMs,
          avgQueueDelayMs,
          l4sMarkedPermille,
        ),
      );
    }
    return ParseStatus.success();
  }

  private storeBweProbeClusterCreated(proto: BweProbeCluster): ParseStatus {
    const S = BweProbeClusterSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "id")) return ParseStatus.error("proto.has_id()");
    if (!has(S, proto, "bitrateBps")) return ParseStatus.error("proto.has_bitrate_bps()");
    if (!has(S, proto, "minPackets")) return ParseStatus.error("proto.has_min_packets()");
    if (!has(S, proto, "minBytes")) return ParseStatus.error("proto.has_min_bytes()");
    this.bweProbeClusterCreatedEventsValue.push(
      new LoggedBweProbeClusterCreatedEvent(
        Timestamp.millis(proto.timestampMs),
        asInt32(proto.id),
        asInt32(proto.bitrateBps),
        proto.minPackets,
        proto.minBytes,
      ),
    );
    // TODO(terelius): Should we delta encode this event type?
    return ParseStatus.success();
  }

  private storeBweProbeSuccessEvent(proto: BweProbeResultSuccess): ParseStatus {
    const S = BweProbeResultSuccessSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "id")) return ParseStatus.error("proto.has_id()");
    if (!has(S, proto, "bitrateBps")) return ParseStatus.error("proto.has_bitrate_bps()");
    this.bweProbeSuccessEventsValue.push(
      new LoggedBweProbeSuccessEvent(Timestamp.millis(proto.timestampMs), asInt32(proto.id), asInt32(proto.bitrateBps)),
    );
    // TODO(terelius): Should we delta encode this event type?
    return ParseStatus.success();
  }

  private storeBweProbeFailureEvent(proto: BweProbeResultFailure): ParseStatus {
    const S = BweProbeResultFailureSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "id")) return ParseStatus.error("proto.has_id()");
    if (!has(S, proto, "failure")) return ParseStatus.error("proto.has_failure()");
    this.bweProbeFailureEventsValue.push(
      new LoggedBweProbeFailureEvent(
        Timestamp.millis(proto.timestampMs),
        asInt32(proto.id),
        getRuntimeProbeFailureReason(proto.failure),
      ),
    );
    // TODO(terelius): Should we delta encode this event type?
    return ParseStatus.success();
  }

  private storeAudioPlayoutEvent(proto: AudioPlayoutEvents): ParseStatus {
    const S = AudioPlayoutEventsSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "localSsrc")) return ParseStatus.error("proto.has_local_ssrc()");

    // Base event
    pushToMap(
      this.audioPlayoutEventsValue,
      proto.localSsrc,
      new LoggedAudioPlayoutEvent(Timestamp.millis(proto.timestampMs), proto.localSsrc),
    );

    const numberOfDeltas = has(S, proto, "numberOfDeltas") ? proto.numberOfDeltas : 0;
    if (numberOfDeltas === 0) {
      return ParseStatus.success();
    }

    // timestamp_ms
    const timestampMsValues = decodeField("timestamp_ms", proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64), numberOfDeltas);
    if (timestampMsValues instanceof RtcEventLogParseStatus) return timestampMsValues;
    // local_ssrc
    const localSsrcValues = decodeField("local_ssrc", proto.localSsrcDeltas, BigInt(proto.localSsrc), numberOfDeltas);
    if (localSsrcValues instanceof RtcEventLogParseStatus) return localSsrcValues;

    // Populate events from decoded deltas
    for (let i = 0; i < numberOfDeltas; ++i) {
      if (timestampMsValues[i] === undefined) return ParseStatus.error("timestamp_ms_values[i].has_value()");
      const localSsrc = deltaU32("local_ssrc", localSsrcValues, i);
      if (localSsrc instanceof RtcEventLogParseStatus) return localSsrc;
      const timestampMs = deltaTimestampMs(timestampMsValues, i);
      if (timestampMs instanceof RtcEventLogParseStatus) return timestampMs;
      pushToMap(this.audioPlayoutEventsValue, localSsrc, new LoggedAudioPlayoutEvent(Timestamp.millis(timestampMs), localSsrc));
    }
    return ParseStatus.success();
  }

  private storeNetEqSetMinimumDelay(proto: NetEqSetMinimumDelay): ParseStatus {
    const S = NetEqSetMinimumDelaySchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "remoteSsrc")) return ParseStatus.error("proto.has_remote_ssrc()");
    if (!has(S, proto, "minimumDelayMs")) return ParseStatus.error("proto.has_minimum_delay_ms()");

    // Base event
    pushToMap(
      this.neteqSetMinimumDelayEventsValue,
      proto.remoteSsrc,
      new LoggedNetEqSetMinimumDelayEvent(Timestamp.millis(proto.timestampMs), proto.remoteSsrc, proto.minimumDelayMs),
    );

    const numberOfDeltas = has(S, proto, "numberOfDeltas") ? proto.numberOfDeltas : 0;
    if (numberOfDeltas === 0) {
      return ParseStatus.success();
    }

    const timestampMsValues = decodeField("timestamp_ms", proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64), numberOfDeltas);
    if (timestampMsValues instanceof RtcEventLogParseStatus) return timestampMsValues;
    const remoteSsrcValues = decodeField("remote_ssrc", proto.remoteSsrcDeltas, BigInt(proto.remoteSsrc), numberOfDeltas);
    if (remoteSsrcValues instanceof RtcEventLogParseStatus) return remoteSsrcValues;
    const minimumDelayMsValues = decodeField(
      "minimum_delay_ms",
      proto.minimumDelayMsDeltas,
      toUnsigned(BigInt(proto.minimumDelayMs), 32),
      numberOfDeltas,
    );
    if (minimumDelayMsValues instanceof RtcEventLogParseStatus) return minimumDelayMsValues;

    // Populate events from decoded deltas
    for (let i = 0; i < numberOfDeltas; ++i) {
      if (timestampMsValues[i] === undefined) return ParseStatus.error("timestamp_ms_values[i].has_value()");
      const remoteSsrc = deltaU32("remote_ssrc", remoteSsrcValues, i);
      if (remoteSsrc instanceof RtcEventLogParseStatus) return remoteSsrc;
      const minimumDelayMsValue = minimumDelayMsValues[i];
      if (minimumDelayMsValue === undefined) return ParseStatus.error("minimum_delay_ms_values[i].has_value()");
      const timestampMs = deltaTimestampMs(timestampMsValues, i);
      if (timestampMs instanceof RtcEventLogParseStatus) return timestampMs;
      const minimumDelayMs = toSigned(minimumDelayMsValue, 32);
      if (minimumDelayMs === undefined) return ParseStatus.error("ToSigned(minimum_delay_ms_values[i].value(), &minimum_delay_ms)");
      pushToMap(
        this.neteqSetMinimumDelayEventsValue,
        remoteSsrc,
        new LoggedNetEqSetMinimumDelayEvent(Timestamp.millis(timestampMs), remoteSsrc, Number(minimumDelayMs)),
      );
    }
    return ParseStatus.success();
  }

  private storeAudioNetworkAdaptationEvent(proto: AudioNetworkAdaptations): ParseStatus {
    const S = AudioNetworkAdaptationsSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");

    // Base event
    {
      const runtimeConfig = new AudioEncoderRuntimeConfig();
      if (has(S, proto, "bitrateBps")) {
        runtimeConfig.bitrateBps = proto.bitrateBps;
      }
      if (has(S, proto, "frameLengthMs")) {
        runtimeConfig.frameLengthMs = proto.frameLengthMs;
      }
      if (has(S, proto, "uplinkPacketLossFraction")) {
        const uplinkPacketLossFraction = parsePacketLossFractionFromProtoFormat(proto.uplinkPacketLossFraction);
        if (uplinkPacketLossFraction === undefined) {
          return ParseStatus.error(
            "ParsePacketLossFractionFromProtoFormat(proto.uplink_packet_loss_fraction(), &uplink_packet_loss_fraction)",
          );
        }
        runtimeConfig.uplinkPacketLossFraction = uplinkPacketLossFraction;
      }
      if (has(S, proto, "enableFec")) {
        runtimeConfig.enableFec = proto.enableFec;
      }
      if (has(S, proto, "enableDtx")) {
        runtimeConfig.enableDtx = proto.enableDtx;
      }
      if (has(S, proto, "numChannels")) {
        runtimeConfig.numChannels = proto.numChannels;
      }
      this.audioNetworkAdaptationEventsValue.push(
        new LoggedAudioNetworkAdaptationEvent(Timestamp.millis(proto.timestampMs), runtimeConfig),
      );
    }

    const numberOfDeltas = has(S, proto, "numberOfDeltas") ? proto.numberOfDeltas : 0;
    if (numberOfDeltas === 0) {
      return ParseStatus.success();
    }

    // timestamp_ms
    const timestampMsValues = decodeField("timestamp_ms", proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64), numberOfDeltas);
    if (timestampMsValues instanceof RtcEventLogParseStatus) return timestampMsValues;

    // bitrate_bps
    const bitrateBpsValues = decodeField(
      "bitrate_bps",
      proto.bitrateBpsDeltas,
      has(S, proto, "bitrateBps") ? toUnsigned(BigInt(proto.bitrateBps), 32) : undefined,
      numberOfDeltas,
    );
    if (bitrateBpsValues instanceof RtcEventLogParseStatus) return bitrateBpsValues;

    // frame_length_ms
    const frameLengthMsValues = decodeField(
      "frame_length_ms",
      proto.frameLengthMsDeltas,
      has(S, proto, "frameLengthMs") ? toUnsigned(BigInt(proto.frameLengthMs), 32) : undefined,
      numberOfDeltas,
    );
    if (frameLengthMsValues instanceof RtcEventLogParseStatus) return frameLengthMsValues;

    // uplink_packet_loss_fraction
    const uplinkPacketLossFractionValues = decodeField(
      "uplink_packet_loss_fraction",
      proto.uplinkPacketLossFractionDeltas,
      has(S, proto, "uplinkPacketLossFraction") ? BigInt(proto.uplinkPacketLossFraction) : undefined,
      numberOfDeltas,
    );
    if (uplinkPacketLossFractionValues instanceof RtcEventLogParseStatus) return uplinkPacketLossFractionValues;

    // enable_fec
    const enableFecValues = decodeField(
      "enable_fec",
      proto.enableFecDeltas,
      has(S, proto, "enableFec") ? (proto.enableFec ? 1n : 0n) : undefined,
      numberOfDeltas,
    );
    if (enableFecValues instanceof RtcEventLogParseStatus) return enableFecValues;

    // enable_dtx
    const enableDtxValues = decodeField(
      "enable_dtx",
      proto.enableDtxDeltas,
      has(S, proto, "enableDtx") ? (proto.enableDtx ? 1n : 0n) : undefined,
      numberOfDeltas,
    );
    if (enableDtxValues instanceof RtcEventLogParseStatus) return enableDtxValues;

    // num_channels
    // Note: For num_channels_deltas, encoding (num_channels - 1) is used, since
    // a channel count of 0 is not meaningful.
    let shiftedBaseNumChannels: OptionalU64;
    if (has(S, proto, "numChannels")) {
      // uint32 arithmetic: 0 - 1 wraps.
      shiftedBaseNumChannels = BigInt((proto.numChannels - 1) >>> 0);
    }
    const numChannelsValues = decodeDeltas(proto.numChannelsDeltas, shiftedBaseNumChannels, numberOfDeltas);
    for (let i = 0; i < numChannelsValues.length; ++i) {
      const value = numChannelsValues[i];
      if (value !== undefined) {
        numChannelsValues[i] = BigInt.asUintN(64, value + 1n);
      }
    }
    if (numChannelsValues.length !== numberOfDeltas) {
      return ParseStatus.error("num_channels_values.size()==number_of_deltas");
    }

    // Populate events from decoded deltas
    for (let i = 0; i < numberOfDeltas; ++i) {
      const timestampMs = deltaTimestampMs(timestampMsValues, i);
      if (timestampMs instanceof RtcEventLogParseStatus) return timestampMs;

      const runtimeConfig = new AudioEncoderRuntimeConfig();
      const bitrateBps = bitrateBpsValues[i];
      if (bitrateBps !== undefined) {
        const signedBitrateBps = toSigned(bitrateBps, 32);
        if (signedBitrateBps === undefined) return ParseStatus.error("ToSigned(bitrate_bps_values[i].value(), &signed_bitrate_bps)");
        runtimeConfig.bitrateBps = Number(signedBitrateBps);
      }
      const frameLengthMs = frameLengthMsValues[i];
      if (frameLengthMs !== undefined) {
        const signedFrameLengthMs = toSigned(frameLengthMs, 32);
        if (signedFrameLengthMs === undefined) {
          return ParseStatus.error("ToSigned(frame_length_ms_values[i].value(), &signed_frame_length_ms)");
        }
        runtimeConfig.frameLengthMs = Number(signedFrameLengthMs);
      }
      const uplinkPacketLossFractionValue = uplinkPacketLossFractionValues[i];
      if (uplinkPacketLossFractionValue !== undefined) {
        if (uplinkPacketLossFractionValue > kU32Max) {
          return ParseStatus.error("IsValueInRangeForNumericType<uint32_t>(uplink_packet_loss_fraction_values[i].value())");
        }
        const uplinkPacketLossFraction = parsePacketLossFractionFromProtoFormat(Number(uplinkPacketLossFractionValue));
        if (uplinkPacketLossFraction === undefined) {
          return ParseStatus.error(
            "ParsePacketLossFractionFromProtoFormat(static_cast<uint32_t>(uplink_packet_loss_fraction_values[i].value()), &uplink_packet_loss_fraction2)",
          );
        }
        runtimeConfig.uplinkPacketLossFraction = uplinkPacketLossFraction;
      }
      const enableFec = enableFecValues[i];
      if (enableFec !== undefined) {
        if (enableFec > 1n) return ParseStatus.error("IsValueInRangeForNumericType<bool>(enable_fec_values[i].value())");
        runtimeConfig.enableFec = enableFec === 1n;
      }
      const enableDtx = enableDtxValues[i];
      if (enableDtx !== undefined) {
        if (enableDtx > 1n) return ParseStatus.error("IsValueInRangeForNumericType<bool>(enable_dtx_values[i].value())");
        runtimeConfig.enableDtx = enableDtx === 1n;
      }
      const numChannels = numChannelsValues[i];
      if (numChannels !== undefined) {
        runtimeConfig.numChannels = Number(numChannels);
      }
      this.audioNetworkAdaptationEventsValue.push(new LoggedAudioNetworkAdaptationEvent(Timestamp.millis(timestampMs), runtimeConfig));
    }
    return ParseStatus.success();
  }

  private storeDtlsTransportState(proto: DtlsTransportStateEvent): ParseStatus {
    const S = DtlsTransportStateEventSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "dtlsTransportState")) return ParseStatus.error("proto.has_dtls_transport_state()");
    this.dtlsTransportStatesValue.push(
      new LoggedDtlsTransportState(Timestamp.millis(proto.timestampMs), getRuntimeDtlsTransportState(proto.dtlsTransportState)),
    );
    return ParseStatus.success();
  }

  private storeDtlsWritableState(proto: DtlsWritableState): ParseStatus {
    const S = DtlsWritableStateSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "writable")) return ParseStatus.error("proto.has_writable()");
    this.dtlsWritableStatesValue.push(new LoggedDtlsWritableState(Timestamp.millis(proto.timestampMs), proto.writable));
    return ParseStatus.success();
  }

  private storeFrameDecodedEvents(proto: FrameDecodedEvents): ParseStatus {
    const S = FrameDecodedEventsSchema;
    for (const field of ["timestampMs", "ssrc", "renderTimeMs", "width", "height", "codec", "qp"] as const) {
      if (!has(S, proto, field)) return ParseStatus.error(`proto.has_${field}()`);
    }

    const baseFrame = new LoggedFrameDecoded(Timestamp.millis(proto.timestampMs));
    baseFrame.ssrc = proto.ssrc;
    baseFrame.renderTimeMs = proto.renderTimeMs;
    baseFrame.width = proto.width;
    baseFrame.height = proto.height;
    baseFrame.codec = getRuntimeCodecType(proto.codec);
    if (!(proto.qp <= 255)) return ParseStatus.error("proto.qp()<=255");
    baseFrame.qp = proto.qp;
    pushToMap(this.decodedFramesValue, baseFrame.ssrc, baseFrame);

    const numberOfDeltas = has(S, proto, "numberOfDeltas") ? proto.numberOfDeltas : 0;
    if (numberOfDeltas === 0) {
      return ParseStatus.success();
    }

    const timestampMsValues = decodeField("timestamp_ms", proto.timestampMsDeltas, toUnsigned(proto.timestampMs, 64), numberOfDeltas);
    if (timestampMsValues instanceof RtcEventLogParseStatus) return timestampMsValues;
    const ssrcValues = decodeField("ssrc", proto.ssrcDeltas, BigInt(proto.ssrc), numberOfDeltas);
    if (ssrcValues instanceof RtcEventLogParseStatus) return ssrcValues;
    const renderTimeMsValues = decodeField("render_time_ms", proto.renderTimeMsDeltas, toUnsigned(proto.renderTimeMs, 64), numberOfDeltas);
    if (renderTimeMsValues instanceof RtcEventLogParseStatus) return renderTimeMsValues;
    const widthValues = decodeField("width", proto.widthDeltas, toUnsigned(BigInt(proto.width), 32), numberOfDeltas);
    if (widthValues instanceof RtcEventLogParseStatus) return widthValues;
    const heightValues = decodeField("height", proto.heightDeltas, toUnsigned(BigInt(proto.height), 32), numberOfDeltas);
    if (heightValues instanceof RtcEventLogParseStatus) return heightValues;
    const codecValues = decodeField("codec", proto.codecDeltas, BigInt.asUintN(64, BigInt(proto.codec)), numberOfDeltas);
    if (codecValues instanceof RtcEventLogParseStatus) return codecValues;
    const qpValues = decodeField("qp", proto.qpDeltas, BigInt(proto.qp), numberOfDeltas);
    if (qpValues instanceof RtcEventLogParseStatus) return qpValues;

    // Populate events from decoded deltas
    for (let i = 0; i < numberOfDeltas; ++i) {
      const timestampMs = deltaTimestampMs(timestampMsValues, i);
      if (timestampMs instanceof RtcEventLogParseStatus) return timestampMs;
      const frame = new LoggedFrameDecoded(Timestamp.millis(timestampMs));
      const ssrc = deltaU32("ssrc", ssrcValues, i);
      if (ssrc instanceof RtcEventLogParseStatus) return ssrc;
      frame.ssrc = ssrc;
      const renderTimeMsValue = renderTimeMsValues[i];
      if (renderTimeMsValue === undefined) return ParseStatus.error("render_time_ms_values[i].has_value()");
      const renderTimeMs = toSigned(renderTimeMsValue, 64);
      if (renderTimeMs === undefined) return ParseStatus.error("ToSigned(render_time_ms_values[i].value(), &frame.render_time_ms)");
      frame.renderTimeMs = renderTimeMs;
      const widthValue = widthValues[i];
      if (widthValue === undefined) return ParseStatus.error("width_values[i].has_value()");
      const width = toSigned(widthValue, 32);
      if (width === undefined) return ParseStatus.error("ToSigned(width_values[i].value(), &frame.width)");
      frame.width = Number(width);
      const heightValue = heightValues[i];
      if (heightValue === undefined) return ParseStatus.error("height_values[i].has_value()");
      const height = toSigned(heightValue, 32);
      if (height === undefined) return ParseStatus.error("ToSigned(height_values[i].value(), &frame.height)");
      frame.height = Number(height);
      const codec = codecValues[i];
      if (codec === undefined) return ParseStatus.error("codec_values[i].has_value()");
      frame.codec = getRuntimeCodecType(Number(BigInt.asIntN(32, codec)) as FrameDecodedEvents_Codec);
      const qp = qpValues[i];
      if (qp === undefined) return ParseStatus.error("qp_values[i].has_value()");
      if (qp > kU8Max) return ParseStatus.error("qp_values[i].value()<=std::numeric_limits<uint8_t>::max()");
      frame.qp = Number(qp);
      pushToMap(this.decodedFramesValue, frame.ssrc, frame);
    }
    return ParseStatus.success();
  }

  private storeIceCandidatePairConfig(proto: IceCandidatePairConfig): ParseStatus {
    const S = IceCandidatePairConfigSchema;
    const iceConfig = new LoggedIceCandidatePairConfig();
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    iceConfig.timestamp = Timestamp.millis(proto.timestampMs);
    if (!has(S, proto, "configType")) return ParseStatus.error("proto.has_config_type()");
    iceConfig.type = getRuntimeIceCandidatePairConfigType(proto.configType);
    if (!has(S, proto, "candidatePairId")) return ParseStatus.error("proto.has_candidate_pair_id()");
    iceConfig.candidatePairId = proto.candidatePairId;
    if (!has(S, proto, "localCandidateType")) return ParseStatus.error("proto.has_local_candidate_type()");
    const localCandidateType = getRuntimeIceCandidateType(proto.localCandidateType);
    if (localCandidateType === undefined) {
      return ParseStatus.error("GetRuntimeIceCandidateType(proto.local_candidate_type(), ice_config.local_candidate_type)");
    }
    iceConfig.localCandidateType = localCandidateType;
    if (!has(S, proto, "localRelayProtocol")) return ParseStatus.error("proto.has_local_relay_protocol()");
    iceConfig.localRelayProtocol = getRuntimeIceCandidatePairProtocol(proto.localRelayProtocol);
    if (!has(S, proto, "localNetworkType")) return ParseStatus.error("proto.has_local_network_type()");
    iceConfig.localNetworkType = getRuntimeIceCandidateNetworkType(proto.localNetworkType);
    if (!has(S, proto, "localAddressFamily")) return ParseStatus.error("proto.has_local_address_family()");
    iceConfig.localAddressFamily = getRuntimeIceCandidatePairAddressFamily(proto.localAddressFamily);
    if (!has(S, proto, "remoteCandidateType")) return ParseStatus.error("proto.has_remote_candidate_type()");
    const remoteCandidateType = getRuntimeIceCandidateType(proto.remoteCandidateType);
    if (remoteCandidateType === undefined) {
      return ParseStatus.error("GetRuntimeIceCandidateType(proto.remote_candidate_type(), ice_config.remote_candidate_type)");
    }
    iceConfig.remoteCandidateType = remoteCandidateType;
    if (!has(S, proto, "remoteAddressFamily")) return ParseStatus.error("proto.has_remote_address_family()");
    iceConfig.remoteAddressFamily = getRuntimeIceCandidatePairAddressFamily(proto.remoteAddressFamily);
    if (!has(S, proto, "candidatePairProtocol")) return ParseStatus.error("proto.has_candidate_pair_protocol()");
    iceConfig.candidatePairProtocol = getRuntimeIceCandidatePairProtocol(proto.candidatePairProtocol);

    this.iceCandidatePairConfigsValue.push(iceConfig);

    // TODO(terelius): Should we delta encode this event type?
    return ParseStatus.success();
  }

  private storeIceCandidateEvent(proto: IceCandidatePairEvent): ParseStatus {
    const S = IceCandidatePairEventSchema;
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    if (!has(S, proto, "eventType")) return ParseStatus.error("proto.has_event_type()");
    if (!has(S, proto, "candidatePairId")) return ParseStatus.error("proto.has_candidate_pair_id()");
    this.iceCandidatePairEventsValue.push(
      new LoggedIceCandidatePairEvent(
        Timestamp.millis(proto.timestampMs),
        getRuntimeIceCandidatePairEventType(proto.eventType),
        proto.candidatePairId,
        has(S, proto, "transactionId") ? proto.transactionId : 0,
      ),
    );

    // TODO(terelius): Should we delta encode this event type?
    return ParseStatus.success();
  }

  private storeAudioRecvConfig(proto: AudioRecvStreamConfig): ParseStatus {
    const S = AudioRecvStreamConfigSchema;
    const stream = new LoggedAudioRecvConfig();
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    stream.timestamp = Timestamp.millis(proto.timestampMs);
    if (!has(S, proto, "remoteSsrc")) return ParseStatus.error("proto.has_remote_ssrc()");
    stream.config.remoteSsrc = proto.remoteSsrc;
    if (!has(S, proto, "localSsrc")) return ParseStatus.error("proto.has_local_ssrc()");
    stream.config.localSsrc = proto.localSsrc;
    if (proto.headerExtensions !== undefined) {
      stream.config.rtpExtensions = getRuntimeRtpHeaderExtensionConfig(proto.headerExtensions);
    }
    this.audioRecvConfigsValue.push(stream);
    return ParseStatus.success();
  }

  private storeAudioSendConfig(proto: AudioSendStreamConfig): ParseStatus {
    const S = AudioSendStreamConfigSchema;
    const stream = new LoggedAudioSendConfig();
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    stream.timestamp = Timestamp.millis(proto.timestampMs);
    if (!has(S, proto, "ssrc")) return ParseStatus.error("proto.has_ssrc()");
    stream.config.localSsrc = proto.ssrc;
    if (proto.headerExtensions !== undefined) {
      stream.config.rtpExtensions = getRuntimeRtpHeaderExtensionConfig(proto.headerExtensions);
    }
    this.audioSendConfigsValue.push(stream);
    return ParseStatus.success();
  }

  private storeVideoRecvConfig(proto: VideoRecvStreamConfig): ParseStatus {
    const S = VideoRecvStreamConfigSchema;
    const stream = new LoggedVideoRecvConfig();
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    stream.timestamp = Timestamp.millis(proto.timestampMs);
    if (!has(S, proto, "remoteSsrc")) return ParseStatus.error("proto.has_remote_ssrc()");
    stream.config.remoteSsrc = proto.remoteSsrc;
    if (!has(S, proto, "localSsrc")) return ParseStatus.error("proto.has_local_ssrc()");
    stream.config.localSsrc = proto.localSsrc;
    if (has(S, proto, "rtxSsrc")) {
      stream.config.rtxSsrc = proto.rtxSsrc;
    }
    if (proto.headerExtensions !== undefined) {
      stream.config.rtpExtensions = getRuntimeRtpHeaderExtensionConfig(proto.headerExtensions);
    }
    this.videoRecvConfigsValue.push(stream);
    return ParseStatus.success();
  }

  private storeVideoSendConfig(proto: VideoSendStreamConfig): ParseStatus {
    const S = VideoSendStreamConfigSchema;
    const stream = new LoggedVideoSendConfig();
    if (!has(S, proto, "timestampMs")) return ParseStatus.error("proto.has_timestamp_ms()");
    stream.timestamp = Timestamp.millis(proto.timestampMs);
    if (!has(S, proto, "ssrc")) return ParseStatus.error("proto.has_ssrc()");
    stream.config.localSsrc = proto.ssrc;
    if (has(S, proto, "rtxSsrc")) {
      stream.config.rtxSsrc = proto.rtxSsrc;
    }
    if (proto.headerExtensions !== undefined) {
      stream.config.rtpExtensions = getRuntimeRtpHeaderExtensionConfig(proto.headerExtensions);
    }
    this.videoSendConfigsValue.push(stream);
    return ParseStatus.success();
  }

  // Legacy format (rtc_event_log.proto).

  private storeParsedLegacyEvent(event: rtclog.Event): ParseStatus {
    const ET = rtclog.Event_EventType;
    if (!has(rtclog.EventSchema, event, "type")) return ParseStatus.error("event.has_type()");
    const hasTimestamp = has(rtclog.EventSchema, event, "timestampUs");
    const timestampUs = () => Timestamp.micros(event.timestampUs);
    switch (event.type) {
      case ET.VIDEO_RECEIVER_CONFIG_EVENT: {
        const config = this.getVideoReceiveConfig(event);
        if (!config.ok()) return config.status();
        if (!hasTimestamp) return ParseStatus.error("event.has_timestamp_us()");
        this.videoRecvConfigsValue.push(new LoggedVideoRecvConfig(timestampUs(), config.value()));
        this.incomingRtpExtensionsMaps.set(config.value().remoteSsrc, new RtpHeaderExtensionMap(config.value().rtpExtensions));
        this.incomingRtpExtensionsMaps.set(config.value().rtxSsrc, new RtpHeaderExtensionMap(config.value().rtpExtensions));
        break;
      }
      case ET.VIDEO_SENDER_CONFIG_EVENT: {
        const config = this.getVideoSendConfig(event);
        if (!config.ok()) return config.status();
        if (!hasTimestamp) return ParseStatus.error("event.has_timestamp_us()");
        this.videoSendConfigsValue.push(new LoggedVideoSendConfig(timestampUs(), config.value()));
        this.outgoingRtpExtensionsMaps.set(config.value().localSsrc, new RtpHeaderExtensionMap(config.value().rtpExtensions));
        this.outgoingRtpExtensionsMaps.set(config.value().rtxSsrc, new RtpHeaderExtensionMap(config.value().rtpExtensions));
        break;
      }
      case ET.AUDIO_RECEIVER_CONFIG_EVENT: {
        const config = this.getAudioReceiveConfig(event);
        if (!config.ok()) return config.status();
        if (!hasTimestamp) return ParseStatus.error("event.has_timestamp_us()");
        this.audioRecvConfigsValue.push(new LoggedAudioRecvConfig(timestampUs(), config.value()));
        this.incomingRtpExtensionsMaps.set(config.value().remoteSsrc, new RtpHeaderExtensionMap(config.value().rtpExtensions));
        break;
      }
      case ET.AUDIO_SENDER_CONFIG_EVENT: {
        const config = this.getAudioSendConfig(event);
        if (!config.ok()) return config.status();
        if (!hasTimestamp) return ParseStatus.error("event.has_timestamp_us()");
        this.audioSendConfigsValue.push(new LoggedAudioSendConfig(timestampUs(), config.value()));
        this.outgoingRtpExtensionsMaps.set(config.value().localSsrc, new RtpHeaderExtensionMap(config.value().rtpExtensions));
        break;
      }
      case ET.RTP_EVENT: {
        if (!hasSubtype(event, "rtpPacket")) return ParseStatus.error("event.has_rtp_packet()");
        const rtpPacket = event.subtype.value as rtclog.RtpPacket;
        const S = rtclog.RtpPacketSchema;
        if (!has(S, rtpPacket, "header")) return ParseStatus.error("rtp_packet.has_header()");
        if (!has(S, rtpPacket, "incoming")) return ParseStatus.error("rtp_packet.has_incoming()");
        if (!has(S, rtpPacket, "packetLength")) return ParseStatus.error("rtp_packet.has_packet_length()");
        const totalLength = rtpPacket.packetLength;

        // Use RtpPacketReceived instead of more generic RtpPacket because former
        // has a buildin convertion to RTPHeader.
        const rtpHeader = new RtpPacketReceived();
        if (!rtpHeader.parse(rtpPacket.header)) return ParseStatus.error("rtp_header.Parse(CopyOnWriteBuffer(rtp_packet.header()))");
        const extensionMap = this.getRtpHeaderExtensionMap(rtpPacket.incoming, rtpHeader.ssrc());
        if (extensionMap !== null) {
          rtpHeader.identifyExtensions(extensionMap);
        }

        const parsedHeader = rtpHeader.getHeader();
        // Since we give the parser only a header, there is no way for it to know
        // the padding length. The best solution would be to log the padding
        // length in RTC event log. In absence of it, we assume the RTP packet to
        // contain only padding, if the padding bit is set.
        // TODO(webrtc:9730): Use a generic way to obtain padding length.
        if (rtpHeader.hasPadding()) {
          // size_t arithmetic.
          parsedHeader.paddingLength = Number(BigInt.asUintN(64, BigInt(totalLength - rtpHeader.size())));
        }

        if (!hasTimestamp) return ParseStatus.error("event.has_timestamp_us()");
        if (rtpPacket.incoming) {
          pushToMap(
            this.incomingRtpPacketsMap,
            parsedHeader.ssrc,
            new LoggedRtpPacketIncoming(timestampUs(), parsedHeader, rtpHeader.size(), totalLength),
          );
        } else {
          pushToMap(
            this.outgoingRtpPacketsMap,
            parsedHeader.ssrc,
            new LoggedRtpPacketOutgoing(timestampUs(), parsedHeader, rtpHeader.size(), totalLength),
          );
        }
        break;
      }
      case ET.RTCP_EVENT: {
        const packet = this.getRtcpPacket(event);
        if (packet instanceof RtcEventLogParseStatus) return packet;
        if (!hasTimestamp) return ParseStatus.error("event.has_timestamp_us()");
        if (packet.incoming) {
          // Currently incoming RTCP packets are logged twice, both for audio and
          // video. Only act on one of them. Compare against the previous parsed
          // incoming RTCP packet.
          if (identicalRtcpContents(packet.data, this.lastIncomingRtcpPacket)) break;
          this.incomingRtcpPacketsValue.push(new LoggedRtcpPacketIncoming(timestampUs(), packet.data));
          this.lastIncomingRtcpPacket = packet.data;
        } else {
          this.outgoingRtcpPacketsValue.push(new LoggedRtcpPacketOutgoing(timestampUs(), packet.data));
        }
        break;
      }
      case ET.LOG_START: {
        if (!hasTimestamp) return ParseStatus.error("event.has_timestamp_us()");
        this.startLogEventsValue.push(new LoggedStartEvent(timestampUs()));
        break;
      }
      case ET.LOG_END: {
        if (!hasTimestamp) return ParseStatus.error("event.has_timestamp_us()");
        this.stopLogEventsValue.push(new LoggedStopEvent(timestampUs()));
        break;
      }
      case ET.AUDIO_PLAYOUT_EVENT: {
        const value = this.getAudioPlayout(event);
        if (!value.ok()) return value.status();
        pushToMap(this.audioPlayoutEventsValue, value.value().ssrc, value.value());
        break;
      }
      case ET.LOSS_BASED_BWE_UPDATE: {
        const value = this.getLossBasedBweUpdate(event);
        if (!value.ok()) return value.status();
        this.bweLossUpdatesValue.push(value.value());
        break;
      }
      case ET.DELAY_BASED_BWE_UPDATE: {
        const value = this.getDelayBasedBweUpdate(event);
        if (!value.ok()) return value.status();
        this.bweDelayUpdatesValue.push(value.value());
        break;
      }
      case ET.AUDIO_NETWORK_ADAPTATION_EVENT: {
        const value = this.getAudioNetworkAdaptation(event);
        if (!value.ok()) return value.status();
        this.audioNetworkAdaptationEventsValue.push(value.value());
        break;
      }
      case ET.BWE_PROBE_CLUSTER_CREATED_EVENT: {
        const value = this.getBweProbeClusterCreated(event);
        if (!value.ok()) return value.status();
        this.bweProbeClusterCreatedEventsValue.push(value.value());
        break;
      }
      case ET.BWE_PROBE_RESULT_EVENT: {
        // Probe successes and failures are currently stored in the same proto
        // message, we are moving towards separate messages. Probe results
        // therefore need special treatment in the parser.
        if (!hasSubtype(event, "probeResult")) return ParseStatus.error("event.has_probe_result()");
        const probeResult = event.subtype.value as rtclog.BweProbeResult;
        if (!has(rtclog.BweProbeResultSchema, probeResult, "result")) return ParseStatus.error("event.probe_result().has_result()");
        if (probeResult.result === rtclog.BweProbeResult_ResultType.SUCCESS) {
          const value = this.getBweProbeSuccess(event);
          if (!value.ok()) return value.status();
          this.bweProbeSuccessEventsValue.push(value.value());
        } else {
          const value = this.getBweProbeFailure(event);
          if (!value.ok()) return value.status();
          this.bweProbeFailureEventsValue.push(value.value());
        }
        break;
      }
      case ET.ALR_STATE_EVENT: {
        const value = this.getAlrState(event);
        if (!value.ok()) return value.status();
        this.alrStateEventsValue.push(value.value());
        break;
      }
      case ET.ICE_CANDIDATE_PAIR_CONFIG: {
        const value = this.getIceCandidatePairConfig(event);
        if (!value.ok()) return value.status();
        this.iceCandidatePairConfigsValue.push(value.value());
        break;
      }
      case ET.ICE_CANDIDATE_PAIR_EVENT: {
        const value = this.getIceCandidatePairEvent(event);
        if (!value.ok()) return value.status();
        this.iceCandidatePairEventsValue.push(value.value());
        break;
      }
      case ET.REMOTE_ESTIMATE: {
        const value = this.getRemoteEstimateEvent(event);
        if (!value.ok()) return value.status();
        this.remoteEstimateEventsValue.push(value.value());
        break;
      }
      case ET.UNKNOWN_EVENT:
      default:
        break;
    }
    return ParseStatus.success();
  }

  // Returns a map of the extensions logged for the SSRC (or the default map
  // when configured to attempt it), or null.
  private getRtpHeaderExtensionMap(incoming: boolean, ssrc: number): RtpHeaderExtensionMap | null {
    const extensionsMaps = incoming ? this.incomingRtpExtensionsMaps : this.outgoingRtpExtensionsMaps;
    const map = extensionsMaps.get(ssrc);
    if (map !== undefined) {
      return map;
    }
    if (this.parseUnconfiguredHeaderExtensions === UnconfiguredHeaderExtensions.kAttemptWebrtcDefaultConfig) {
      // Using default header extension map for the SSRC.
      extensionsMaps.set(ssrc, this.defaultExtensionMap);
      return this.defaultExtensionMap;
    }
    // Not parsing header extensions: no header extension map found.
    return null;
  }

  private getRtcpPacket(event: rtclog.Event): {incoming: boolean; data: Uint8Array} | ParseStatus {
    if (!has(rtclog.EventSchema, event, "type")) return ParseStatus.error("event.has_type()");
    if (event.type !== rtclog.Event_EventType.RTCP_EVENT) return ParseStatus.error("event.type()==rtclog::Event::RTCP_EVENT");
    if (!hasSubtype(event, "rtcpPacket")) return ParseStatus.error("event.has_rtcp_packet()");
    const rtcpPacket = event.subtype.value as rtclog.RtcpPacket;
    if (!has(rtclog.RtcpPacketSchema, rtcpPacket, "incoming")) return ParseStatus.error("rtcp_packet.has_incoming()");
    if (!has(rtclog.RtcpPacketSchema, rtcpPacket, "packetData")) return ParseStatus.error("rtcp_packet.has_packet_data()");
    return {incoming: rtcpPacket.incoming, data: rtcpPacket.packetData.slice()};
  }

  private checkLegacyEvent(event: rtclog.Event, type: rtclog.Event_EventType, name: string): ParseStatus | null {
    if (!has(rtclog.EventSchema, event, "type")) return ParseStatus.error("event.has_type()");
    if (event.type !== type) return ParseStatus.error(`event.type()==rtclog::Event::${rtclog.Event_EventType[type]}`);
    if (name !== "" && !hasSubtype(event, name)) return ParseStatus.error(`event.has_${name}()`);
    return null;
  }

  private getVideoReceiveConfig(event: rtclog.Event): RtcEventLogParseStatusOr<StreamConfig> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.VIDEO_RECEIVER_CONFIG_EVENT, "videoReceiverConfig");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const config = new StreamConfig();
    const receiverConfig = event.subtype.value as rtclog.VideoReceiveConfig;
    const S = rtclog.VideoReceiveConfigSchema;
    const fail = (m: string) => RtcEventLogParseStatusOr.error<StreamConfig>(m);
    if (!has(S, receiverConfig, "remoteSsrc")) return fail("receiver_config.has_remote_ssrc()");
    config.remoteSsrc = receiverConfig.remoteSsrc;
    if (!has(S, receiverConfig, "localSsrc")) return fail("receiver_config.has_local_ssrc()");
    config.localSsrc = receiverConfig.localSsrc;
    config.rtxSsrc = 0;
    if (!has(S, receiverConfig, "rtcpMode")) return fail("receiver_config.has_rtcp_mode()");
    config.rtcpMode = getRuntimeRtcpModeLegacy(receiverConfig.rtcpMode);
    if (!has(S, receiverConfig, "remb")) return fail("receiver_config.has_remb()");
    config.remb = receiverConfig.remb;

    // Get RTX map. std::map::insert keeps the first entry per payload type.
    const rtxMap = new Map<number, rtclog.RtxConfig>();
    for (const map of receiverConfig.rtxMap) {
      if (!has(rtclog.RtxMapSchema, map, "payloadType")) return fail("map.has_payload_type()");
      if (map.config === undefined) return fail("map.has_config()");
      if (!has(rtclog.RtxConfigSchema, map.config, "rtxSsrc")) return fail("map.config().has_rtx_ssrc()");
      if (!has(rtclog.RtxConfigSchema, map.config, "rtxPayloadType")) return fail("map.config().has_rtx_payload_type()");
      if (!rtxMap.has(map.payloadType)) rtxMap.set(map.payloadType, map.config);
    }

    // Get header extensions.
    const extensions = getHeaderExtensions(receiverConfig.headerExtensions);
    if (extensions instanceof RtcEventLogParseStatus) return RtcEventLogParseStatusOr.ofStatus(extensions);
    config.rtpExtensions = extensions;

    // Get decoders.
    config.codecs = [];
    for (const decoder of receiverConfig.decoders) {
      if (!has(rtclog.DecoderConfigSchema, decoder, "name")) return fail("receiver_config.decoders(i).has_name()");
      if (!has(rtclog.DecoderConfigSchema, decoder, "payloadType")) return fail("receiver_config.decoders(i).has_payload_type()");
      let rtxPayloadType = 0;
      const rtx = rtxMap.get(decoder.payloadType);
      if (rtx !== undefined) {
        rtxPayloadType = rtx.rtxPayloadType;
        if (config.rtxSsrc !== 0 && config.rtxSsrc !== rtx.rtxSsrc) {
          // Different SSRCs for different received RTX payload types: only the
          // first rtx_ssrc is used.
        } else {
          config.rtxSsrc = rtx.rtxSsrc;
        }
      }
      config.codecs.push(new StreamConfigCodec(decoder.name, decoder.payloadType, rtxPayloadType));
    }
    return RtcEventLogParseStatusOr.ofValue(config);
  }

  private getVideoSendConfig(event: rtclog.Event): RtcEventLogParseStatusOr<StreamConfig> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.VIDEO_SENDER_CONFIG_EVENT, "videoSenderConfig");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const config = new StreamConfig();
    const senderConfig = event.subtype.value as rtclog.VideoSendConfig;
    const fail = (m: string) => RtcEventLogParseStatusOr.error<StreamConfig>(m);

    // Get SSRCs.
    // VideoSendStreamConfig no longer stores multiple SSRCs. If you are
    // analyzing a very old log, try building the parser from the same
    // WebRTC version.
    if (senderConfig.ssrcs.length !== 1) return fail("sender_config.ssrcs_size()==1");
    config.localSsrc = senderConfig.ssrcs[0];
    if (!(senderConfig.rtxSsrcs.length <= 1)) return fail("sender_config.rtx_ssrcs_size()<=1");
    if (senderConfig.rtxSsrcs.length === 1) {
      config.rtxSsrc = senderConfig.rtxSsrcs[0];
    }

    // Get header extensions.
    const extensions = getHeaderExtensions(senderConfig.headerExtensions);
    if (extensions instanceof RtcEventLogParseStatus) return RtcEventLogParseStatusOr.ofStatus(extensions);
    config.rtpExtensions = extensions;

    // Get the codec.
    if (senderConfig.encoder === undefined) return fail("sender_config.has_encoder()");
    if (!has(rtclog.EncoderConfigSchema, senderConfig.encoder, "name")) return fail("sender_config.encoder().has_name()");
    if (!has(rtclog.EncoderConfigSchema, senderConfig.encoder, "payloadType")) return fail("sender_config.encoder().has_payload_type()");
    config.codecs.push(
      new StreamConfigCodec(
        senderConfig.encoder.name,
        senderConfig.encoder.payloadType,
        has(rtclog.VideoSendConfigSchema, senderConfig, "rtxPayloadType") ? senderConfig.rtxPayloadType : 0,
      ),
    );
    return RtcEventLogParseStatusOr.ofValue(config);
  }

  private getAudioReceiveConfig(event: rtclog.Event): RtcEventLogParseStatusOr<StreamConfig> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.AUDIO_RECEIVER_CONFIG_EVENT, "audioReceiverConfig");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const config = new StreamConfig();
    const receiverConfig = event.subtype.value as rtclog.AudioReceiveConfig;
    const S = rtclog.AudioReceiveConfigSchema;
    if (!has(S, receiverConfig, "remoteSsrc")) return RtcEventLogParseStatusOr.error("receiver_config.has_remote_ssrc()");
    config.remoteSsrc = receiverConfig.remoteSsrc;
    if (!has(S, receiverConfig, "localSsrc")) return RtcEventLogParseStatusOr.error("receiver_config.has_local_ssrc()");
    config.localSsrc = receiverConfig.localSsrc;
    const extensions = getHeaderExtensions(receiverConfig.headerExtensions);
    if (extensions instanceof RtcEventLogParseStatus) return RtcEventLogParseStatusOr.ofStatus(extensions);
    config.rtpExtensions = extensions;
    return RtcEventLogParseStatusOr.ofValue(config);
  }

  private getAudioSendConfig(event: rtclog.Event): RtcEventLogParseStatusOr<StreamConfig> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.AUDIO_SENDER_CONFIG_EVENT, "audioSenderConfig");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const config = new StreamConfig();
    const senderConfig = event.subtype.value as rtclog.AudioSendConfig;
    if (!has(rtclog.AudioSendConfigSchema, senderConfig, "ssrc")) return RtcEventLogParseStatusOr.error("sender_config.has_ssrc()");
    config.localSsrc = senderConfig.ssrc;
    const extensions = getHeaderExtensions(senderConfig.headerExtensions);
    if (extensions instanceof RtcEventLogParseStatus) return RtcEventLogParseStatusOr.ofStatus(extensions);
    config.rtpExtensions = extensions;
    return RtcEventLogParseStatusOr.ofValue(config);
  }

  private legacyTimestamp(event: rtclog.Event): Timestamp | undefined {
    return has(rtclog.EventSchema, event, "timestampUs") ? Timestamp.micros(event.timestampUs) : undefined;
  }

  private getAudioPlayout(event: rtclog.Event): RtcEventLogParseStatusOr<LoggedAudioPlayoutEvent> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.AUDIO_PLAYOUT_EVENT, "audioPlayoutEvent");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const playoutEvent = event.subtype.value as rtclog.AudioPlayoutEvent;
    const timestamp = this.legacyTimestamp(event);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("event.has_timestamp_us()");
    if (!has(rtclog.AudioPlayoutEventSchema, playoutEvent, "localSsrc")) return RtcEventLogParseStatusOr.error("playout_event.has_local_ssrc()");
    return RtcEventLogParseStatusOr.ofValue(new LoggedAudioPlayoutEvent(timestamp, playoutEvent.localSsrc));
  }

  private getLossBasedBweUpdate(event: rtclog.Event): RtcEventLogParseStatusOr<LoggedBweLossBasedUpdate> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.LOSS_BASED_BWE_UPDATE, "lossBasedBweUpdate");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const lossEvent = event.subtype.value as rtclog.LossBasedBweUpdate;
    const S = rtclog.LossBasedBweUpdateSchema;
    // RTC_CHECK upstream (a crash rather than a parse error).
    const timestamp = this.legacyTimestamp(event);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("event.has_timestamp_us()");
    if (!has(S, lossEvent, "bitrateBps")) return RtcEventLogParseStatusOr.error("loss_event.has_bitrate_bps()");
    if (!has(S, lossEvent, "fractionLoss")) return RtcEventLogParseStatusOr.error("loss_event.has_fraction_loss()");
    if (!has(S, lossEvent, "totalPackets")) return RtcEventLogParseStatusOr.error("loss_event.has_total_packets()");
    return RtcEventLogParseStatusOr.ofValue(
      new LoggedBweLossBasedUpdate(timestamp, lossEvent.bitrateBps | 0, lossEvent.fractionLoss & 0xff, lossEvent.totalPackets | 0),
    );
  }

  private getDelayBasedBweUpdate(event: rtclog.Event): RtcEventLogParseStatusOr<LoggedBweDelayBasedUpdate> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.DELAY_BASED_BWE_UPDATE, "delayBasedBweUpdate");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const delayEvent = event.subtype.value as rtclog.DelayBasedBweUpdate;
    const S = rtclog.DelayBasedBweUpdateSchema;
    const timestamp = this.legacyTimestamp(event);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("event.has_timestamp_us()");
    if (!has(S, delayEvent, "bitrateBps")) return RtcEventLogParseStatusOr.error("delay_event.has_bitrate_bps()");
    if (!has(S, delayEvent, "detectorState")) return RtcEventLogParseStatusOr.error("delay_event.has_detector_state()");
    return RtcEventLogParseStatusOr.ofValue(
      new LoggedBweDelayBasedUpdate(timestamp, delayEvent.bitrateBps | 0, getRuntimeDetectorStateLegacy(delayEvent.detectorState)),
    );
  }

  private getAudioNetworkAdaptation(event: rtclog.Event): RtcEventLogParseStatusOr<LoggedAudioNetworkAdaptationEvent> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.AUDIO_NETWORK_ADAPTATION_EVENT, "audioNetworkAdaptation");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const anaEvent = event.subtype.value as rtclog.AudioNetworkAdaptation;
    const S = rtclog.AudioNetworkAdaptationSchema;
    const timestamp = this.legacyTimestamp(event);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("event.has_timestamp_us()");
    const res = new LoggedAudioNetworkAdaptationEvent(timestamp);
    if (has(S, anaEvent, "bitrateBps")) res.config.bitrateBps = anaEvent.bitrateBps;
    if (has(S, anaEvent, "enableFec")) res.config.enableFec = anaEvent.enableFec;
    if (has(S, anaEvent, "enableDtx")) res.config.enableDtx = anaEvent.enableDtx;
    if (has(S, anaEvent, "frameLengthMs")) res.config.frameLengthMs = anaEvent.frameLengthMs;
    if (has(S, anaEvent, "numChannels")) res.config.numChannels = anaEvent.numChannels;
    if (has(S, anaEvent, "uplinkPacketLossFraction")) res.config.uplinkPacketLossFraction = Math.fround(anaEvent.uplinkPacketLossFraction);
    return RtcEventLogParseStatusOr.ofValue(res);
  }

  private getBweProbeClusterCreated(event: rtclog.Event): RtcEventLogParseStatusOr<LoggedBweProbeClusterCreatedEvent> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.BWE_PROBE_CLUSTER_CREATED_EVENT, "probeCluster");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const pccEvent = event.subtype.value as rtclog.BweProbeCluster;
    const S = rtclog.BweProbeClusterSchema;
    const timestamp = this.legacyTimestamp(event);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("event.has_timestamp_us()");
    if (!has(S, pccEvent, "id")) return RtcEventLogParseStatusOr.error("pcc_event.has_id()");
    if (!has(S, pccEvent, "bitrateBps")) return RtcEventLogParseStatusOr.error("pcc_event.has_bitrate_bps()");
    if (!has(S, pccEvent, "minPackets")) return RtcEventLogParseStatusOr.error("pcc_event.has_min_packets()");
    if (!has(S, pccEvent, "minBytes")) return RtcEventLogParseStatusOr.error("pcc_event.has_min_bytes()");
    return RtcEventLogParseStatusOr.ofValue(
      new LoggedBweProbeClusterCreatedEvent(timestamp, pccEvent.id | 0, pccEvent.bitrateBps | 0, pccEvent.minPackets >>> 0, pccEvent.minBytes >>> 0),
    );
  }

  private getBweProbeFailure(event: rtclog.Event): RtcEventLogParseStatusOr<LoggedBweProbeFailureEvent> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.BWE_PROBE_RESULT_EVENT, "probeResult");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const prEvent = event.subtype.value as rtclog.BweProbeResult;
    const S = rtclog.BweProbeResultSchema;
    const RT = rtclog.BweProbeResult_ResultType;
    if (!has(S, prEvent, "result")) return RtcEventLogParseStatusOr.error("pr_event.has_result()");
    if (prEvent.result === RT.SUCCESS) return RtcEventLogParseStatusOr.error("pr_event.result()!=rtclog::BweProbeResult::SUCCESS");
    const timestamp = this.legacyTimestamp(event);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("event.has_timestamp_us()");
    if (!has(S, prEvent, "id")) return RtcEventLogParseStatusOr.error("pr_event.has_id()");
    let failureReason = ProbeFailureReason.kTimeout; // (Uninitialized upstream for other values.)
    if (prEvent.result === RT.INVALID_SEND_RECEIVE_INTERVAL) {
      failureReason = ProbeFailureReason.kInvalidSendReceiveInterval;
    } else if (prEvent.result === RT.INVALID_SEND_RECEIVE_RATIO) {
      failureReason = ProbeFailureReason.kInvalidSendReceiveRatio;
    } else if (prEvent.result === RT.TIMEOUT) {
      failureReason = ProbeFailureReason.kTimeout;
    }
    if (has(S, prEvent, "bitrateBps")) return RtcEventLogParseStatusOr.error("!pr_event.has_bitrate_bps()");
    return RtcEventLogParseStatusOr.ofValue(new LoggedBweProbeFailureEvent(timestamp, prEvent.id | 0, failureReason));
  }

  private getBweProbeSuccess(event: rtclog.Event): RtcEventLogParseStatusOr<LoggedBweProbeSuccessEvent> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.BWE_PROBE_RESULT_EVENT, "probeResult");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const prEvent = event.subtype.value as rtclog.BweProbeResult;
    const S = rtclog.BweProbeResultSchema;
    if (!has(S, prEvent, "result")) return RtcEventLogParseStatusOr.error("pr_event.has_result()");
    if (prEvent.result !== rtclog.BweProbeResult_ResultType.SUCCESS) {
      return RtcEventLogParseStatusOr.error("pr_event.result()==rtclog::BweProbeResult::SUCCESS");
    }
    const timestamp = this.legacyTimestamp(event);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("event.has_timestamp_us()");
    if (!has(S, prEvent, "id")) return RtcEventLogParseStatusOr.error("pr_event.has_id()");
    if (!has(S, prEvent, "bitrateBps")) return RtcEventLogParseStatusOr.error("pr_event.has_bitrate_bps()");
    return RtcEventLogParseStatusOr.ofValue(new LoggedBweProbeSuccessEvent(timestamp, prEvent.id | 0, prEvent.bitrateBps | 0));
  }

  private getAlrState(event: rtclog.Event): RtcEventLogParseStatusOr<LoggedAlrStateEvent> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.ALR_STATE_EVENT, "alrState");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const alrEvent = event.subtype.value as rtclog.AlrState;
    const timestamp = this.legacyTimestamp(event);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("event.has_timestamp_us()");
    if (!has(rtclog.AlrStateSchema, alrEvent, "inAlr")) return RtcEventLogParseStatusOr.error("alr_event.has_in_alr()");
    return RtcEventLogParseStatusOr.ofValue(new LoggedAlrStateEvent(timestamp, alrEvent.inAlr));
  }

  private getIceCandidatePairConfig(rtcEvent: rtclog.Event): RtcEventLogParseStatusOr<LoggedIceCandidatePairConfig> {
    const err = this.checkLegacyEvent(rtcEvent, rtclog.Event_EventType.ICE_CANDIDATE_PAIR_CONFIG, "");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const config = legacySubtype(rtcEvent, "iceCandidatePairConfig", rtclog.IceCandidatePairConfigSchema);
    const S = rtclog.IceCandidatePairConfigSchema;
    const fail = (m: string) => RtcEventLogParseStatusOr.error<LoggedIceCandidatePairConfig>(m);
    const res = new LoggedIceCandidatePairConfig();
    const timestamp = this.legacyTimestamp(rtcEvent);
    if (timestamp === undefined) return fail("rtc_event.has_timestamp_us()");
    res.timestamp = timestamp;
    if (!has(S, config, "configType")) return fail("config.has_config_type()");
    res.type = getRuntimeIceCandidatePairConfigTypeLegacy(config.configType);
    if (!has(S, config, "candidatePairId")) return fail("config.has_candidate_pair_id()");
    res.candidatePairId = config.candidatePairId;
    if (!has(S, config, "localCandidateType")) return fail("config.has_local_candidate_type()");
    const localCandidateType = getRuntimeIceCandidateTypeLegacy(config.localCandidateType);
    if (localCandidateType === undefined) return fail("GetRuntimeIceCandidateType(config.local_candidate_type(), res.local_candidate_type)");
    res.localCandidateType = localCandidateType;
    if (!has(S, config, "localRelayProtocol")) return fail("config.has_local_relay_protocol()");
    res.localRelayProtocol = getRuntimeIceCandidatePairProtocolLegacy(config.localRelayProtocol);
    if (!has(S, config, "localNetworkType")) return fail("config.has_local_network_type()");
    res.localNetworkType = getRuntimeIceCandidateNetworkTypeLegacy(config.localNetworkType);
    if (!has(S, config, "localAddressFamily")) return fail("config.has_local_address_family()");
    res.localAddressFamily = getRuntimeIceCandidatePairAddressFamilyLegacy(config.localAddressFamily);
    if (!has(S, config, "remoteCandidateType")) return fail("config.has_remote_candidate_type()");
    const remoteCandidateType = getRuntimeIceCandidateTypeLegacy(config.remoteCandidateType);
    if (remoteCandidateType === undefined) return fail("GetRuntimeIceCandidateType(config.remote_candidate_type(), res.remote_candidate_type)");
    res.remoteCandidateType = remoteCandidateType;
    if (!has(S, config, "remoteAddressFamily")) return fail("config.has_remote_address_family()");
    res.remoteAddressFamily = getRuntimeIceCandidatePairAddressFamilyLegacy(config.remoteAddressFamily);
    if (!has(S, config, "candidatePairProtocol")) return fail("config.has_candidate_pair_protocol()");
    res.candidatePairProtocol = getRuntimeIceCandidatePairProtocolLegacy(config.candidatePairProtocol);
    return RtcEventLogParseStatusOr.ofValue(res);
  }

  private getIceCandidatePairEvent(rtcEvent: rtclog.Event): RtcEventLogParseStatusOr<LoggedIceCandidatePairEvent> {
    const err = this.checkLegacyEvent(rtcEvent, rtclog.Event_EventType.ICE_CANDIDATE_PAIR_EVENT, "");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const event = legacySubtype(rtcEvent, "iceCandidatePairEvent", rtclog.IceCandidatePairEventSchema);
    const S = rtclog.IceCandidatePairEventSchema;
    const timestamp = this.legacyTimestamp(rtcEvent);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("rtc_event.has_timestamp_us()");
    if (!has(S, event, "eventType")) return RtcEventLogParseStatusOr.error("event.has_event_type()");
    if (!has(S, event, "candidatePairId")) return RtcEventLogParseStatusOr.error("event.has_candidate_pair_id()");
    return RtcEventLogParseStatusOr.ofValue(
      new LoggedIceCandidatePairEvent(timestamp, getRuntimeIceCandidatePairEventTypeLegacy(event.eventType), event.candidatePairId, 0),
    );
  }

  private getRemoteEstimateEvent(event: rtclog.Event): RtcEventLogParseStatusOr<LoggedRemoteEstimateEvent> {
    const err = this.checkLegacyEvent(event, rtclog.Event_EventType.REMOTE_ESTIMATE, "");
    if (err) return RtcEventLogParseStatusOr.ofStatus(err);
    const remoteEstimateEvent = legacySubtype(event, "remoteEstimate", rtclog.RemoteEstimateSchema);
    const S = rtclog.RemoteEstimateSchema;
    const timestamp = this.legacyTimestamp(event);
    if (timestamp === undefined) return RtcEventLogParseStatusOr.error("event.has_timestamp_us()");
    const res = new LoggedRemoteEstimateEvent(timestamp);
    if (has(S, remoteEstimateEvent, "linkCapacityLowerKbps")) {
      res.linkCapacityLower = DataRate.kilobitsPerSec(remoteEstimateEvent.linkCapacityLowerKbps);
    }
    if (has(S, remoteEstimateEvent, "linkCapacityUpperKbps")) {
      res.linkCapacityUpper = DataRate.kilobitsPerSec(remoteEstimateEvent.linkCapacityUpperKbps);
    }
    return RtcEventLogParseStatusOr.ofValue(res);
  }
}
