// Port of logging/rtc_event_log/events/rtc_event_audio_network_adaptation.h @ M154 (LoggedAudioNetworkAdaptationEvent).

import {Timestamp} from "../../../api/units/timestamp.js";
import {AudioEncoderRuntimeConfig} from "../../../modules/audio-coding/audio-network-adaptor/include/audio-network-adaptor-config.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedAudioNetworkAdaptationEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public config: AudioEncoderRuntimeConfig = new AudioEncoderRuntimeConfig(),
  ) {
    super(timestamp);
  }
}
