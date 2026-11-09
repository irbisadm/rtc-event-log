// Port of logging/rtc_event_log/events/rtc_event_definition.h @ M154 (the
// parsing half).
//
// The C++ variadic template over member pointers becomes a list of field
// definitions, each with the field's encoding parameters, how to decode a
// value into the logged member's type, and a setter for that member.

import {Timestamp} from "../../../api/units/timestamp.js";
import {EventParser, extendLoggedBatch, populateRtcEventMember, populateRtcEventTimestamp} from "./rtc-event-field-encoding-parser.js";
import {kTimestampParams, type EventParameters, type FieldParameters} from "./rtc-event-field-encoding.js";
import {RtcEventLogParseStatus, RtcEventLogParseStatusOr} from "./rtc-event-log-parse-status.js";

export interface RtcEventFieldDefinition<LoggedType> {
  params: FieldParameters;
  // PopulateRtcEventMember for this field's member.
  populate: (values: readonly bigint[], output: readonly LoggedType[]) => RtcEventLogParseStatus;
}

// A field whose values decode with `decode` (DecodeFromUnsignedToType<T> or
// RtcEventLogEnum<T>::Decode) and are stored with `set`.
export function rtcEventField<LoggedType, V>(
  params: FieldParameters,
  decode: (value: bigint) => RtcEventLogParseStatusOr<V>,
  set: (event: LoggedType, value: V) => void,
): RtcEventFieldDefinition<LoggedType> {
  return {
    params,
    populate: (values, output) => populateRtcEventMember(values, decode, set, output),
  };
}

export class RtcEventDefinition<LoggedType extends {timestamp: Timestamp}> {
  constructor(
    readonly params: EventParameters,
    private readonly create: () => LoggedType,
    private readonly fields: readonly RtcEventFieldDefinition<LoggedType>[],
  ) {}

  parseBatch(s: Uint8Array, batched: boolean, output: LoggedType[]): RtcEventLogParseStatus {
    const parser = new EventParser();
    let status = parser.initialize(s, batched);
    if (!status.ok()) return status;

    const outputBatch = extendLoggedBatch(output, parser.numEventsInBatch(), this.create);

    const result = parser.parseNumericField(kTimestampParams);
    if (!result.ok()) return result.status();
    status = populateRtcEventTimestamp(
      result.value(),
      (event: LoggedType, timestamp) => {
        event.timestamp = timestamp;
      },
      outputBatch,
    );
    if (!status.ok()) return status;

    for (const field of this.fields) {
      const fieldResult = parser.parseNumericField(field.params);
      if (!fieldResult.ok()) return fieldResult.status();
      status = field.populate(fieldResult.value(), outputBatch);
      if (!status.ok()) return status;
    }
    return RtcEventLogParseStatus.success();
  }
}
