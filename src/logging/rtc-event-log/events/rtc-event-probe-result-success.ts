// Port of logging/rtc_event_log/events/rtc_event_probe_result_success.h @ M154 (LoggedBweProbeSuccessEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedBweProbeSuccessEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public id = 0, // int32_t
    public bitrateBps = 0, // int32_t
  ) {
    super(timestamp);
  }
}
