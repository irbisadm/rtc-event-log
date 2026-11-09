// Port of logging/rtc_event_log/events/rtc_event_begin_log.h @ M154 (LoggedStartEvent
// and the v3 parser).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";
import {RtcEventType} from "../../../api/rtc-event-log/rtc-event.js";
import {EventParser, extendLoggedBatch, populateRtcEventTimestamp} from "./rtc-event-field-encoding-parser.js";
import {FieldType, kTimestampParams, type FieldParameters} from "./rtc-event-field-encoding.js";
import {RtcEventLogParseStatus} from "./rtc-event-log-parse-status.js";

export class LoggedStartEvent extends LoggedEvent {
  utcStartTime: Timestamp;

  constructor(timestamp: Timestamp = Timestamp.plusInfinity(), utcStartTime: Timestamp = timestamp) {
    super(timestamp);
    this.utcStartTime = utcStartTime;
  }

  utcTime(): Timestamp {
    return this.utcStartTime;
  }
}

export const RtcEventBeginLog = {
  kType: RtcEventType.BeginV3Log,

  utcStartTimeParams: {
    name: "utc_start_time_ms",
    fieldId: 1n,
    fieldType: FieldType.kVarInt,
    valueWidth: 64,
  } as FieldParameters,

  parse(encodedBytes: Uint8Array, batched: boolean, output: LoggedStartEvent[]): RtcEventLogParseStatus {
    const parser = new EventParser();
    let status = parser.initialize(encodedBytes, batched);
    if (!status.ok()) return status;

    const outputBatch = extendLoggedBatch(output, parser.numEventsInBatch(), () => new LoggedStartEvent());

    let result = parser.parseNumericField(kTimestampParams);
    if (!result.ok()) return result.status();
    status = populateRtcEventTimestamp(
      result.value(),
      (event: LoggedStartEvent, t) => {
        event.timestamp = t;
      },
      outputBatch,
    );
    if (!status.ok()) return status;

    result = parser.parseNumericField(RtcEventBeginLog.utcStartTimeParams);
    if (!result.ok()) return result.status();
    status = populateRtcEventTimestamp(
      result.value(),
      (event: LoggedStartEvent, t) => {
        event.utcStartTime = t;
      },
      outputBatch,
    );
    if (!status.ok()) return status;

    return RtcEventLogParseStatus.success();
  },
};
