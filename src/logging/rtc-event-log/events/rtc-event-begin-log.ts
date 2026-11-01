// Port of logging/rtc_event_log/events/rtc_event_begin_log.h @ M154 (LoggedStartEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

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
