// Port of logging/rtc_event_log/events/rtc_event_video_receive_stream_config.h @ M154 (LoggedVideoRecvConfig).

import {Timestamp} from "../../../api/units/timestamp.js";
import {StreamConfig} from "../rtc-stream-config.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedVideoRecvConfig extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public config: StreamConfig = new StreamConfig(),
  ) {
    super(timestamp);
  }
}
