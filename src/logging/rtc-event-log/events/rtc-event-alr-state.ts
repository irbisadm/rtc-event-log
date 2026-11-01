// Port of logging/rtc_event_log/events/rtc_event_alr_state.h @ M154
// (LoggedAlrStateEvent and the v3 parser).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";
import {RtcEventType} from "../../../api/rtc-event-log/rtc-event.js";
import {RtcEventDefinition, rtcEventField} from "./rtc-event-definition.js";
import {FieldType} from "./rtc-event-field-encoding.js";
import {decodeFromUnsignedToType, IntegerTypes} from "./rtc-event-field-extraction.js";
import {RtcEventLogParseStatusOr, type RtcEventLogParseStatus} from "./rtc-event-log-parse-status.js";

export class LoggedAlrStateEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public inAlr = false,
  ) {
    super(timestamp);
  }
}

const definition = new RtcEventDefinition<LoggedAlrStateEvent>(
  {name: "AlrState", id: RtcEventType.AlrStateEvent},
  () => new LoggedAlrStateEvent(),
  [
    rtcEventField(
      {name: "in_alr", fieldId: 1n, fieldType: FieldType.kFixed8, valueWidth: 1},
      (v) => RtcEventLogParseStatusOr.ofValue(decodeFromUnsignedToType(v, IntegerTypes.bool) !== 0n),
      (event: LoggedAlrStateEvent, inAlr) => {
        event.inAlr = inAlr;
      },
    ),
  ],
);

export const RtcEventAlrState = {
  kType: RtcEventType.AlrStateEvent,
  definition,

  parse(s: Uint8Array, batched: boolean, output: LoggedAlrStateEvent[]): RtcEventLogParseStatus {
    return definition.parseBatch(s, batched, output);
  },
};
