// Port of logging/rtc_event_log/events/rtc_event_frame_decoded.h @ M154 (LoggedFrameDecoded).

import {VideoCodecType} from "../../../api/video/video-codec-type.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedFrameDecoded extends LoggedEvent {
  renderTimeMs = 0n; // int64_t
  ssrc = 0;
  width = 0;
  height = 0;
  codec: VideoCodecType = VideoCodecType.kVideoCodecGeneric;
  qp = 0;
}
