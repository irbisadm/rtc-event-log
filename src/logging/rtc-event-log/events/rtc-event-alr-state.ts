// Port of logging/rtc_event_log/events/rtc_event_alr_state.h @ M154 (LoggedAlrStateEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedAlrStateEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public inAlr = false,
  ) {
    super(timestamp);
  }
}
