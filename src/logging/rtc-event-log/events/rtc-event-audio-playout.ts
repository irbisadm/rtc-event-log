// Port of logging/rtc_event_log/events/rtc_event_audio_playout.h @ M154
// (LoggedAudioPlayoutEvent and the v3 parser).

import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";
import {RtcEventType} from "../../../api/rtc-event-log/rtc-event.js";
import {RtcEventDefinition, rtcEventField} from "./rtc-event-definition.js";
import {FieldType} from "./rtc-event-field-encoding.js";
import {decodeFromUnsignedToType, IntegerTypes} from "./rtc-event-field-extraction.js";
import {RtcEventLogParseStatusOr, type RtcEventLogParseStatus} from "./rtc-event-log-parse-status.js";

export class LoggedAudioPlayoutEvent extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public ssrc = 0,
  ) {
    super(timestamp);
  }
}

const definition = new RtcEventDefinition<LoggedAudioPlayoutEvent>(
  {name: "AudioPlayout", id: RtcEventType.AudioPlayout},
  () => new LoggedAudioPlayoutEvent(),
  [
    rtcEventField(
      {name: "ssrc", fieldId: 1n, fieldType: FieldType.kFixed32, valueWidth: 32},
      (v) => RtcEventLogParseStatusOr.ofValue(Number(decodeFromUnsignedToType(v, IntegerTypes.uint32))),
      (event: LoggedAudioPlayoutEvent, ssrc) => {
        event.ssrc = ssrc;
      },
    ),
  ],
);

export const RtcEventAudioPlayout = {
  kType: RtcEventType.AudioPlayout,
  definition,

  // Every event of the batch is stored, also the default-constructed ones
  // left behind by a parse error, like upstream.
  parse(encodedBytes: Uint8Array, batched: boolean, output: Map<number, LoggedAudioPlayoutEvent[]>): RtcEventLogParseStatus {
    const tempOutput: LoggedAudioPlayoutEvent[] = [];
    const status = definition.parseBatch(encodedBytes, batched, tempOutput);
    for (const event of tempOutput) {
      let events = output.get(event.ssrc);
      if (events === undefined) {
        events = [];
        output.set(event.ssrc, events);
      }
      events.push(event);
    }
    return status;
  },
};
