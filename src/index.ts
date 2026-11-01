// rtc-event-log: parser for WebRTC RtcEventLog files (new format,
// logging/rtc_event_log/rtc_event_log2.proto), ported from libwebrtc.
import {fromBinary} from "@bufbuild/protobuf";
import {EventStreamSchema, type EventStream} from "./gen/rtc_event_log2_pb.js";

export type {EventStream} from "./gen/rtc_event_log2_pb.js";

// Decodes only the protobuf layer of a new-format event log; batched fields
// stay delta encoded. ParsedRtcEventLog gives the typed events.
export function decodeEventStream(bytes: Uint8Array): EventStream {
  return fromBinary(EventStreamSchema, bytes);
}

export {
  LoggedMediaType,
  LoggedRtpStreamIncoming,
  LoggedRtpStreamOutgoing,
  LoggedRtpStreamView,
  LogSegment,
  MediaType,
  PacketDirection,
  ParsedRtcEventLog,
  type ParseStatus,
  UnconfiguredHeaderExtensions,
} from "./logging/rtc-event-log/rtc-event-log-parser.js";
export {RtcEventLogParseStatus} from "./logging/rtc-event-log/events/rtc-event-log-parse-status.js";
export * from "./logging/rtc-event-log/events/logged-rtp-rtcp.js";
export {LoggedStartEvent} from "./logging/rtc-event-log/events/rtc-event-begin-log.js";
export {LoggedStopEvent} from "./logging/rtc-event-log/events/rtc-event-end-log.js";
export {AudioLevel, RTPHeader, RTPHeaderExtension, RtcpMode} from "./api/rtp-headers.js";
export {VideoRotation} from "./api/video/video-rotation.js";
export {Timestamp} from "./api/units/timestamp.js";
