// Port of logging/rtc_event_log/events/rtc_event_bwe_update_loss_based.h @ M154 (LoggedBweLossBasedUpdate).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedBweLossBasedUpdate extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public bitrateBps = 0, // int32_t
    public fractionLost = 0, // uint8_t
    public expectedPackets = 0, // int32_t
  ) {
    super(timestamp);
  }
}
