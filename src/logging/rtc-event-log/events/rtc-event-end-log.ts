// Port of logging/rtc_event_log/events/rtc_event_end_log.h @ M154 (LoggedStopEvent).

import {Timestamp} from "../../../api/units/timestamp.js";

export class LoggedStopEvent {
  constructor(public timestamp: Timestamp = Timestamp.plusInfinity()) {}

  logTimeUs(): number {
    return Timestamp.us(this.timestamp);
  }
  logTimeMs(): number {
    return Timestamp.ms(this.timestamp);
  }
  logTime(): Timestamp {
    return this.timestamp;
  }
}
