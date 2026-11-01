// Port of logging/rtc_event_log/events/rtc_event_neteq_set_minimum_delay.h @ M154 (LoggedNetEqSetMinimumDelayEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedNetEqSetMinimumDelayEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public remoteSsrc = 0,
    public minimumDelayMs = 0,
  ) {
    super(timestamp);
  }
}
