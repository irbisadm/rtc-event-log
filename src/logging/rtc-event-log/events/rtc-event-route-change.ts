// Port of logging/rtc_event_log/events/rtc_event_route_change.h @ M154 (LoggedRouteChangeEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedRouteChangeEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public connected = false,
    public overhead = 0,
  ) {
    super(timestamp);
  }
}
