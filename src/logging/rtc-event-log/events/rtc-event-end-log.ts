// Port of logging/rtc_event_log/events/rtc_event_end_log.h @ M154 (LoggedStopEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedStopEvent extends LoggedEvent {
  constructor(timestamp: Timestamp = Timestamp.plusInfinity()) {
    super(timestamp);
  }
}
