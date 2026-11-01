// Port of logging/rtc_event_log/events/rtc_event_probe_cluster_created.h @ M154 (LoggedBweProbeClusterCreatedEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedBweProbeClusterCreatedEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public id = 0, // int32_t
    public bitrateBps = 0, // int32_t
    public minPackets = 0, // uint32_t
    public minBytes = 0, // uint32_t
  ) {
    super(timestamp);
  }
}
