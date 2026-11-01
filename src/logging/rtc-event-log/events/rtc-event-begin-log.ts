// Port of logging/rtc_event_log/events/rtc_event_begin_log.h @ M154 (LoggedStartEvent).

import {Timestamp} from "../../../api/units/timestamp.js";

export class LoggedStartEvent {
  constructor(
    public timestamp: Timestamp = Timestamp.plusInfinity(),
    public utcStartTime: Timestamp = timestamp,
  ) {}

  logTimeUs(): number {
    return Timestamp.us(this.timestamp);
  }
  logTimeMs(): number {
    return Timestamp.ms(this.timestamp);
  }
  logTime(): Timestamp {
    return this.timestamp;
  }

  utcTime(): Timestamp {
    return this.utcStartTime;
  }
}
