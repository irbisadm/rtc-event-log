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
  getRuntimeDetectorState,
  getRuntimeProbeFailureReason,
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
export {LoggedEvent} from "./logging/rtc-event-log/events/logged-event.js";
export {LoggedAlrStateEvent} from "./logging/rtc-event-log/events/rtc-event-alr-state.js";
export {LoggedRouteChangeEvent} from "./logging/rtc-event-log/events/rtc-event-route-change.js";
export {LoggedRemoteEstimateEvent} from "./logging/rtc-event-log/events/rtc-event-remote-estimate.js";
export {LoggedBweDelayBasedUpdate} from "./logging/rtc-event-log/events/rtc-event-bwe-update-delay-based.js";
export {LoggedBweLossBasedUpdate} from "./logging/rtc-event-log/events/rtc-event-bwe-update-loss-based.js";
export {LoggedBweScreamUpdate} from "./logging/rtc-event-log/events/rtc-event-bwe-update-scream.js";
export {LoggedBweProbeClusterCreatedEvent} from "./logging/rtc-event-log/events/rtc-event-probe-cluster-created.js";
export {LoggedBweProbeSuccessEvent} from "./logging/rtc-event-log/events/rtc-event-probe-result-success.js";
export {
  LoggedBweProbeFailureEvent,
  ProbeFailureReason,
} from "./logging/rtc-event-log/events/rtc-event-probe-result-failure.js";
export {BandwidthUsage} from "./api/transport/bandwidth-usage.js";
export {AudioLevel, RTPHeader, RTPHeaderExtension, RtcpMode} from "./api/rtp-headers.js";
export {VideoRotation} from "./api/video/video-rotation.js";
export {Timestamp} from "./api/units/timestamp.js";
export {TimeDelta} from "./api/units/time-delta.js";
export {DataRate} from "./api/units/data-rate.js";
export {DataSize} from "./api/units/data-size.js";
