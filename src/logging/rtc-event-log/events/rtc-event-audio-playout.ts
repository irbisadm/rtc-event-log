// Port of logging/rtc_event_log/events/rtc_event_audio_playout.h @ M154 (LoggedAudioPlayoutEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedAudioPlayoutEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public ssrc = 0,
  ) {
    super(timestamp);
  }
}
