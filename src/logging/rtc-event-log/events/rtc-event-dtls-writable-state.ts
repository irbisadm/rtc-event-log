// Port of logging/rtc_event_log/events/rtc_event_dtls_writable_state.h @ M154 (LoggedDtlsWritableState).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedDtlsWritableState extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public writable = false,
  ) {
    super(timestamp);
  }
}
