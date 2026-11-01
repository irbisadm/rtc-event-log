// rtc-event-log: parser for WebRTC RtcEventLog files (new format,
// logging/rtc_event_log/rtc_event_log2.proto), ported from libwebrtc.
import {fromBinary} from "@bufbuild/protobuf";
import {EventStreamSchema, type EventStream} from "./gen/rtc_event_log2_pb.js";

export type {EventStream} from "./gen/rtc_event_log2_pb.js";

// Decodes the protobuf layer of a new-format event log. Batched fields are
// still delta encoded; typed events come in later stages (see PORTING_PLAN.md).
export function decodeEventStream(bytes: Uint8Array): EventStream {
  return fromBinary(EventStreamSchema, bytes);
}
