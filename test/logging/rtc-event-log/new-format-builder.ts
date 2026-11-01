// Test helper: builds new-format (rtclog2) event logs the way
// logging/rtc_event_log/encoder/rtc_event_log_encoder_new_format.cc batches
// events (first event as base, the rest delta encoded), for the parts ported
// so far. Each EventStream message carries one batch, like the encoder.

import {create, type MessageInitShape, toBinary} from "@bufbuild/protobuf";

import {
  EventStreamSchema,
  IncomingRtcpPacketsSchema,
  IncomingRtpPacketsSchema,
  OutgoingRtcpPacketsSchema,
  OutgoingRtpPacketsSchema,
} from "../../../src/gen/rtc_event_log2_pb.js";
import {RtcEventLogDependencyDescriptorEncoderDecoder} from "../../../src/logging/rtc-event-log/dependency-descriptor-encoder-decoder.js";
import {encodeBlobs} from "../../../src/logging/rtc-event-log/encoder/blob-encoding.js";
import {encodeDeltas, type OptionalU64} from "../../../src/logging/rtc-event-log/encoder/delta-encoding.js";
import {toUnsigned} from "../../../src/logging/rtc-event-log/encoder/rtc-event-log-encoder-common.js";

export interface RtpPacketSpec {
  timestampMs: number;
  marker?: boolean;
  payloadType: number;
  sequenceNumber: number;
  rtpTimestamp: number;
  ssrc: number;
  payloadSize: number;
  headerSize: number;
  paddingSize?: number;
  transportSequenceNumber?: number;
  transmissionTimeOffset?: number;
  absoluteSendTime?: number;
  videoRotationCvo?: number;
  audioLevel?: {voiceActivity: boolean; level: number};
  rtxOriginalSequenceNumber?: number;
  dependencyDescriptor?: Uint8Array;
}

export interface RtcpPacketSpec {
  timestampMs: number;
  packet: Uint8Array;
}

type EventStreamInit = MessageInitShape<typeof EventStreamSchema>;

export function eventStreamBytes(init: EventStreamInit): Uint8Array {
  return toBinary(EventStreamSchema, create(EventStreamSchema, init));
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const big = (v: number | undefined): OptionalU64 => (v === undefined ? undefined : BigInt(v));

function rtpBatchInit(batch: readonly RtpPacketSpec[]): Record<string, unknown> {
  const base = batch[0];
  const init: Record<string, unknown> = {
    timestampMs: BigInt(base.timestampMs),
    marker: base.marker ?? false,
    payloadType: base.payloadType,
    sequenceNumber: base.sequenceNumber,
    rtpTimestamp: base.rtpTimestamp,
    ssrc: base.ssrc,
    payloadSize: base.payloadSize,
    headerSize: base.headerSize,
    paddingSize: base.paddingSize ?? 0,
  };
  if (base.transportSequenceNumber !== undefined) init.transportSequenceNumber = base.transportSequenceNumber;
  if (base.transmissionTimeOffset !== undefined) init.transmissionTimeOffset = base.transmissionTimeOffset;
  if (base.absoluteSendTime !== undefined) init.absoluteSendTime = base.absoluteSendTime;
  if (base.videoRotationCvo !== undefined) init.videoRotation = base.videoRotationCvo;
  if (base.audioLevel !== undefined) {
    init.audioLevel = base.audioLevel.level;
    init.voiceActivity = base.audioLevel.voiceActivity;
  }
  if (base.rtxOriginalSequenceNumber !== undefined) init.rtxOriginalSequenceNumber = base.rtxOriginalSequenceNumber;

  if (batch.some((p) => p.dependencyDescriptor !== undefined)) {
    init.dependencyDescriptor = RtcEventLogDependencyDescriptorEncoderDecoder.encode(
      batch.map((p) => p.dependencyDescriptor ?? new Uint8Array(0)),
    );
  }

  if (batch.length === 1) return init;

  const rest = batch.slice(1);
  init.numberOfDeltas = rest.length;
  const setDeltas = (field: string, baseValue: OptionalU64, values: OptionalU64[]) => {
    const encoded = encodeDeltas(baseValue, values);
    if (encoded.length !== 0) init[field] = encoded;
  };
  setDeltas(
    "timestampMsDeltas",
    toUnsigned(BigInt(base.timestampMs), 64),
    rest.map((p) => toUnsigned(BigInt(p.timestampMs), 64)),
  );
  setDeltas("markerDeltas", base.marker ? 1n : 0n, rest.map((p) => (p.marker ? 1n : 0n)));
  setDeltas("payloadTypeDeltas", big(base.payloadType), rest.map((p) => big(p.payloadType)));
  setDeltas("sequenceNumberDeltas", big(base.sequenceNumber), rest.map((p) => big(p.sequenceNumber)));
  setDeltas("rtpTimestampDeltas", big(base.rtpTimestamp), rest.map((p) => big(p.rtpTimestamp)));
  setDeltas("ssrcDeltas", big(base.ssrc), rest.map((p) => big(p.ssrc)));
  setDeltas("payloadSizeDeltas", big(base.payloadSize), rest.map((p) => big(p.payloadSize)));
  setDeltas("headerSizeDeltas", big(base.headerSize), rest.map((p) => big(p.headerSize)));
  setDeltas("paddingSizeDeltas", big(base.paddingSize ?? 0), rest.map((p) => big(p.paddingSize ?? 0)));
  setDeltas(
    "transportSequenceNumberDeltas",
    big(base.transportSequenceNumber),
    rest.map((p) => big(p.transportSequenceNumber)),
  );
  const tto = (v: number | undefined) => (v === undefined ? undefined : toUnsigned(BigInt(v), 32));
  setDeltas("transmissionTimeOffsetDeltas", tto(base.transmissionTimeOffset), rest.map((p) => tto(p.transmissionTimeOffset)));
  setDeltas("absoluteSendTimeDeltas", big(base.absoluteSendTime), rest.map((p) => big(p.absoluteSendTime)));
  setDeltas("videoRotationDeltas", big(base.videoRotationCvo), rest.map((p) => big(p.videoRotationCvo)));
  setDeltas("audioLevelDeltas", big(base.audioLevel?.level), rest.map((p) => big(p.audioLevel?.level)));
  const va = (p: RtpPacketSpec) => (p.audioLevel === undefined ? undefined : p.audioLevel.voiceActivity ? 1n : 0n);
  setDeltas("voiceActivityDeltas", va(base), rest.map(va));
  setDeltas(
    "rtxOriginalSequenceNumberDeltas",
    big(base.rtxOriginalSequenceNumber),
    rest.map((p) => big(p.rtxOriginalSequenceNumber)),
  );
  return init;
}

export function incomingRtpBatch(batch: readonly RtpPacketSpec[]): Uint8Array {
  return eventStreamBytes({incomingRtpPackets: [create(IncomingRtpPacketsSchema, rtpBatchInit(batch))]});
}

export function outgoingRtpBatch(batch: readonly RtpPacketSpec[]): Uint8Array {
  return eventStreamBytes({outgoingRtpPackets: [create(OutgoingRtpPacketsSchema, rtpBatchInit(batch))]});
}

function rtcpBatchInit(batch: readonly RtcpPacketSpec[]): Record<string, unknown> {
  const base = batch[0];
  const init: Record<string, unknown> = {timestampMs: BigInt(base.timestampMs), rawPacket: base.packet};
  if (batch.length === 1) return init;
  const rest = batch.slice(1);
  init.numberOfDeltas = rest.length;
  const encoded = encodeDeltas(
    toUnsigned(BigInt(base.timestampMs), 64),
    rest.map((p) => toUnsigned(BigInt(p.timestampMs), 64)),
  );
  if (encoded.length !== 0) init.timestampMsDeltas = encoded;
  init.rawPacketBlobs = encodeBlobs(rest.map((p) => p.packet));
  return init;
}

export function incomingRtcpBatch(batch: readonly RtcpPacketSpec[]): Uint8Array {
  return eventStreamBytes({incomingRtcpPackets: [create(IncomingRtcpPacketsSchema, rtcpBatchInit(batch))]});
}

export function outgoingRtcpBatch(batch: readonly RtcpPacketSpec[]): Uint8Array {
  return eventStreamBytes({outgoingRtcpPackets: [create(OutgoingRtcpPacketsSchema, rtcpBatchInit(batch))]});
}

export function beginLog(timestampMs: number, utcTimeMs: number): Uint8Array {
  return eventStreamBytes({beginLogEvents: [{timestampMs: BigInt(timestampMs), version: 2, utcTimeMs: BigInt(utcTimeMs)}]});
}

export function endLog(timestampMs: number): Uint8Array {
  return eventStreamBytes({endLogEvents: [{timestampMs: BigInt(timestampMs)}]});
}

// A batched event type: `fields` maps proto field names (without the
// "Deltas" suffix) to per-event values; undefined = field absent. Mirrors the
// encoder: the first event is the base, the others delta encoded against it,
// with signed fields (timestamps) going through ToUnsigned.
export function batchInit(
  timestampsMs: readonly number[],
  fields: Record<string, readonly (number | boolean | undefined)[]>,
): Record<string, unknown> {
  const init: Record<string, unknown> = {timestampMs: BigInt(timestampsMs[0])};
  const asU64 = (v: number | boolean | undefined): OptionalU64 =>
    v === undefined ? undefined : typeof v === "boolean" ? (v ? 1n : 0n) : BigInt(v);
  for (const [name, values] of Object.entries(fields)) {
    if (values[0] !== undefined) init[name] = values[0];
  }
  if (timestampsMs.length === 1) return init;
  init.numberOfDeltas = timestampsMs.length - 1;
  const ts = encodeDeltas(
    toUnsigned(BigInt(timestampsMs[0]), 64),
    timestampsMs.slice(1).map((t) => toUnsigned(BigInt(t), 64)),
  );
  if (ts.length !== 0) init.timestampMsDeltas = ts;
  for (const [name, values] of Object.entries(fields)) {
    const encoded = encodeDeltas(asU64(values[0]), values.slice(1).map(asU64));
    if (encoded.length !== 0) init[`${name}Deltas`] = encoded;
  }
  return init;
}
