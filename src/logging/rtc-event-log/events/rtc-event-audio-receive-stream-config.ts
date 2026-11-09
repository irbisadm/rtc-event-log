// Port of logging/rtc_event_log/events/rtc_event_audio_receive_stream_config.h @ M154 (LoggedAudioRecvConfig).

import {Timestamp} from "../../../api/units/timestamp.js";
import {StreamConfig} from "../rtc-stream-config.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedAudioRecvConfig extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public config: StreamConfig = new StreamConfig(),
  ) {
    super(timestamp);
  }
}
