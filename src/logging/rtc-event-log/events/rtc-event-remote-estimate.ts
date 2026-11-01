// Port of logging/rtc_event_log/events/rtc_event_remote_estimate.h @ M154 (LoggedRemoteEstimateEvent).

import type {DataRate} from "../../../api/units/data-rate.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedRemoteEstimateEvent extends LoggedEvent {
  linkCapacityLower: DataRate | undefined = undefined;
  linkCapacityUpper: DataRate | undefined = undefined;
}
