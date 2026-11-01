// Port of logging/rtc_event_log/rtc_event_log_parser.h @ M154.
//
// Status of the port (see PORTING_PLAN.md): the new (protobuf) format with
// RTP/RTCP packets and begin/end log events. Other event types of the new
// format are skipped for now; the legacy and v3 formats are rejected.

import {fromBinary} from "@bufbuild/protobuf";

import {AudioLevel, RTPHeader} from "../../api/rtp-headers.js";
import {Timestamp} from "../../api/units/timestamp.js";
import {
  type BeginLogEvent,
  BeginLogEventSchema,
  type EndLogEvent,
  EndLogEventSchema,
  type EventStream,
  EventStreamSchema,
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
import {LoggedStartEvent} from "./events/rtc-event-begin-log.js";
import {LoggedStopEvent} from "./events/rtc-event-end-log.js";
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
    for (const rtpStream of this.incomingRtpPacketsBySsrcValue) {
      this.storeFirstAndLastTimestamp(rtpStream.incomingPackets);
    }
    for (const rtpStream of this.outgoingRtpPacketsBySsrcValue) {
      this.storeFirstAndLastTimestamp(rtpStream.outgoingPackets);
    }
    this.storeFirstAndLastTimestamp(this.incomingRtcpPacketsValue);
    this.storeFirstAndLastTimestamp(this.outgoingRtcpPacketsValue);

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

  // Not used before the legacy format (header extension maps) is ported.
  protected unconfiguredHeaderExtensions(): UnconfiguredHeaderExtensions {
    return this.parseUnconfiguredHeaderExtensions;
  }
}
