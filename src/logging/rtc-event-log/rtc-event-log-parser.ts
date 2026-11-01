// Port of logging/rtc_event_log/rtc_event_log_parser.h @ M154.
//
// Status of the port (see PORTING_PLAN.md): the new (protobuf) format with
// RTP/RTCP packets and begin/end log events. Other event types of the new
// format are skipped for now; the legacy and v3 formats are rejected.

import {fromBinary} from "@bufbuild/protobuf";

import {AudioLevel, RTPHeader} from "../../api/rtp-headers.js";
import {BandwidthUsage} from "../../api/transport/bandwidth-usage.js";
import {DataRate} from "../../api/units/data-rate.js";
import {Timestamp} from "../../api/units/timestamp.js";
import {
  type AlrState,
  AlrStateSchema,
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
import {toSigned, toUnsigned} from "./encoder/rtc-event-log-encoder-common.js";
import {decodeVarInt} from "./encoder/var-int.js";
import {
  LoggedRtcpPacketIncoming,
  LoggedRtcpPacketOutgoing,
  type LoggedRtpPacket,
  LoggedRtpPacketIncoming,
  LoggedRtpPacketOutgoing,
} from "./events/logged-rtp-rtcp.js";
import {LoggedAlrStateEvent} from "./events/rtc-event-alr-state.js";
import {LoggedStartEvent} from "./events/rtc-event-begin-log.js";
import {LoggedBweDelayBasedUpdate} from "./events/rtc-event-bwe-update-delay-based.js";
import {LoggedBweLossBasedUpdate} from "./events/rtc-event-bwe-update-loss-based.js";
import {LoggedBweScreamUpdate} from "./events/rtc-event-bwe-update-scream.js";
import {LoggedStopEvent} from "./events/rtc-event-end-log.js";
import {LoggedBweProbeClusterCreatedEvent} from "./events/rtc-event-probe-cluster-created.js";
import {LoggedBweProbeFailureEvent, ProbeFailureReason} from "./events/rtc-event-probe-result-failure.js";
import {LoggedBweProbeSuccessEvent} from "./events/rtc-event-probe-result-success.js";
import {LoggedRemoteEstimateEvent} from "./events/rtc-event-remote-estimate.js";
import {LoggedRouteChangeEvent} from "./events/rtc-event-route-change.js";
import {RtcEventLogParseStatus} from "./events/rtc-event-log-parse-status.js";

export type ParseStatus = RtcEventLogParseStatus;
const ParseStatus = RtcEventLogParseStatus;

const kIncompleteLogError = "Could not parse the entire log. Only the beginning will be used.";

// RtcEvent::Type::BeginV3Log (api/rtc_event_log/rtc_event.h).
const kBeginV3LogType = 0x2501580n;

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
    this.incomingRtpPacketsMap.clear();
    this.outgoingRtpPacketsMap.clear();
    this.incomingRtpPacketsBySsrcValue = [];
    this.outgoingRtpPacketsBySsrcValue = [];
    this.incomingRtpPacketViewsBySsrc = [];
    this.outgoingRtpPacketViewsBySsrc = [];

    this.incomingRtcpPacketsValue = [];
    this.outgoingRtcpPacketsValue = [];

    this.startLogEventsValue = [];
    this.stopLogEventsValue = [];
    this.bweProbeClusterCreatedEventsValue = [];
    this.bweProbeFailureEventsValue = [];
    this.bweProbeSuccessEventsValue = [];
    this.bweDelayUpdatesValue = [];
    this.bweLossUpdatesValue = [];
    this.bweScreamUpdatesValue = [];
    this.alrStateEventsValue = [];
    // Not cleared by upstream Clear() either; reset here so that a reused
    // parser does not accumulate them.
    this.routeChangeEventsValue = [];
    this.remoteEstimateEventsValue = [];

    this.firstTimestampValue = Timestamp.plusInfinity();
    this.lastTimestampValue = Timestamp.minusInfinity();
    this.firstLogSegmentValue = new LogSegment(0, kInt64Max);
  }

  // Reads an RtcEventLog from a byte buffer and returns success if successful.
  parseString(s: Uint8Array): ParseStatus {
    return this.parseStream(s);
  }

  // Reads an RtcEventLog from a byte buffer and returns success if successful.
  parseStream(s: Uint8Array): ParseStatus {
    this.clear();
    const status = this.parseStreamInternal(s);

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

    // Store first and last timestamp events that might happen before the call
    // is connected or after the call is disconnected. Typical examples are
    // stream configurations and starting/stopping the log.
    // TODO(terelius): Figure out if we actually need to find the first and last
    // timestamp in the parser. It seems like this could be done by the caller.
    this.firstTimestampValue = Timestamp.plusInfinity();
    this.lastTimestampValue = Timestamp.minusInfinity();
    this.storeFirstAndLastTimestamp(this.alrStateEventsValue);
    this.storeFirstAndLastTimestamp(this.routeChangeEventsValue);
    this.storeFirstAndLastTimestamp(this.bweProbeClusterCreatedEventsValue);
    this.storeFirstAndLastTimestamp(this.bweProbeFailureEventsValue);
    this.storeFirstAndLastTimestamp(this.bweProbeSuccessEventsValue);
    this.storeFirstAndLastTimestamp(this.bweDelayUpdatesValue);
    this.storeFirstAndLastTimestamp(this.bweLossUpdatesValue);
    this.storeFirstAndLastTimestamp(this.bweScreamUpdatesValue);
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

    if (peek.value >> 1n === kBeginV3LogType) {
      return ParseStatus.error("The v3 event log format is not supported");
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
        // TODO(stage 7): legacy format.
        return ParseStatus.error("The legacy event log format is not supported yet");
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
    } else {
      // TODO(stages 3-4): the remaining event types are not ported yet.
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

  // Not used before the legacy format (header extension maps) is ported.
  protected unconfiguredHeaderExtensions(): UnconfiguredHeaderExtensions {
    return this.parseUnconfiguredHeaderExtensions;
  }
}
