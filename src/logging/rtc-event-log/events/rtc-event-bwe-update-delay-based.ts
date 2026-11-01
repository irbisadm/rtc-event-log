// Port of logging/rtc_event_log/events/rtc_event_bwe_update_delay_based.h @ M154 (LoggedBweDelayBasedUpdate).

import {BandwidthUsage} from "../../../api/transport/bandwidth-usage.js";
import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedBweDelayBasedUpdate extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public bitrateBps = 0, // int32_t
    public detectorState: BandwidthUsage = BandwidthUsage.kBwNormal,
  ) {
    super(timestamp);
  }
}
