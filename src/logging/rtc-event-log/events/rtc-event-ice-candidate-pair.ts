// Port of logging/rtc_event_log/events/rtc_event_ice_candidate_pair.h @ M154 (LoggedIceCandidatePairEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export enum IceCandidatePairEventType {
  kCheckSent,
  kCheckReceived,
  kCheckResponseSent,
  kCheckResponseReceived,
  kNumValues,
}

export class LoggedIceCandidatePairEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public type: IceCandidatePairEventType = IceCandidatePairEventType.kCheckSent,
    public candidatePairId = 0,
    public transactionId = 0,
  ) {
    super(timestamp);
  }
}
