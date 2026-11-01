// Port of logging/rtc_event_log/events/rtc_event_end_log.h @ M154 (LoggedStopEvent
// and the v3 parser).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";
import {RtcEventType} from "../../../api/rtc-event-log/rtc-event.js";
import {EventParser, extendLoggedBatch, populateRtcEventTimestamp} from "./rtc-event-field-encoding-parser.js";
import {kTimestampParams} from "./rtc-event-field-encoding.js";
import {RtcEventLogParseStatus} from "./rtc-event-log-parse-status.js";

export class LoggedStopEvent extends LoggedEvent {
  constructor(timestamp: Timestamp = Timestamp.plusInfinity()) {
    super(timestamp);
  }
}

export const RtcEventEndLog = {
  kType: RtcEventType.EndV3Log,

  parse(encodedBytes: Uint8Array, batched: boolean, output: LoggedStopEvent[]): RtcEventLogParseStatus {
    const parser = new EventParser();
    let status = parser.initialize(encodedBytes, batched);
    if (!status.ok()) return status;

    const outputBatch = extendLoggedBatch(output, parser.numEventsInBatch(), () => new LoggedStopEvent());

    const result = parser.parseNumericField(kTimestampParams);
    if (!result.ok()) return result.status();
    status = populateRtcEventTimestamp(
      result.value(),
      (event: LoggedStopEvent, t) => {
        event.timestamp = t;
      },
      outputBatch,
    );
    if (!status.ok()) return status;

    return RtcEventLogParseStatus.success();
  },
};
