// Port of logging/rtc_event_log/events/rtc_event_probe_result_failure.h @ M154 (LoggedBweProbeFailureEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export enum ProbeFailureReason {
  kInvalidSendReceiveInterval = 0,
  kInvalidSendReceiveRatio,
  kTimeout,
  kLast,
}

export class LoggedBweProbeFailureEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public id = 0, // int32_t
    public failureReason: ProbeFailureReason = ProbeFailureReason.kTimeout,
  ) {
    super(timestamp);
  }
}
