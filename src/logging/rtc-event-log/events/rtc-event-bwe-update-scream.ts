// Port of logging/rtc_event_log/events/rtc_event_bwe_update_scream.h @ M154 (LoggedBweScreamUpdate).

import {DataRate} from "../../../api/units/data-rate.js";
import {DataSize} from "../../../api/units/data-size.js";
import {TimeDelta} from "../../../api/units/time-delta.js";
import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedBweScreamUpdate extends LoggedEvent {
  refWindow: DataSize;
  dataInFlight: DataSize;
  targetRate: DataRate;
  smoothedRtt: TimeDelta;
  avgQueueDelay: TimeDelta;

  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    refWindowBytes = 0,
    dataInFlightBytes = 0,
    targetRateKbps = 0,
    smoothedRttMs = 0,
    avgQueueDelayMs = 0,
    public l4sMarkedPermille = 0,
  ) {
    super(timestamp);
    this.refWindow = DataSize.bytes(refWindowBytes);
    this.dataInFlight = DataSize.bytes(dataInFlightBytes);
    this.targetRate = DataRate.kilobitsPerSec(targetRateKbps);
    this.smoothedRtt = TimeDelta.millis(smoothedRttMs);
    this.avgQueueDelay = TimeDelta.millis(avgQueueDelayMs);
  }
}
