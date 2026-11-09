// Shared base of the Logged* event structs (not an upstream file): every
// one carries `timestamp` and the log_time_us()/log_time_ms()/log_time()
// accessors.

import {Timestamp} from "../../../api/units/timestamp.js";

export abstract class LoggedEvent {
  constructor(public timestamp: Timestamp = Timestamp.minusInfinity()) {}

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
