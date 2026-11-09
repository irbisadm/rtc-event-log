// Port of logging/rtc_event_log/events/rtc_event_bwe_update_delay_based.h @ M154
// (LoggedBweDelayBasedUpdate, RtcEventLogEnum<BandwidthUsage> and the v3 parser).

import {BandwidthUsage} from "../../../api/transport/bandwidth-usage.js";
import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";
import {RtcEventType} from "../../../api/rtc-event-log/rtc-event.js";
import {RtcEventDefinition, rtcEventField} from "./rtc-event-definition.js";
import {FieldType} from "./rtc-event-field-encoding.js";
import {decodeFromUnsignedToType, IntegerTypes} from "./rtc-event-field-extraction.js";
import {RtcEventLogParseStatusOr, type RtcEventLogParseStatus} from "./rtc-event-log-parse-status.js";

export class LoggedBweDelayBasedUpdate extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public bitrateBps = 0, // int32_t
    public detectorState: BandwidthUsage = BandwidthUsage.kBwNormal,
  ) {
    super(timestamp);
  }
}

// RtcEventLogEnum<BandwidthUsage>.
export const RtcEventLogEnumBandwidthUsage = {
  encode(x: BandwidthUsage): bigint {
    switch (x) {
      case BandwidthUsage.kBwNormal:
        return 0n;
      case BandwidthUsage.kBwUnderusing:
        return 1n;
      case BandwidthUsage.kBwOverusing:
        return 2n;
      default:
        return (1n << 64n) - 1n;
    }
  },
  decode(x: bigint): RtcEventLogParseStatusOr<BandwidthUsage> {
    switch (x) {
      case 0n:
        return RtcEventLogParseStatusOr.ofValue(BandwidthUsage.kBwNormal);
      case 1n:
        return RtcEventLogParseStatusOr.ofValue(BandwidthUsage.kBwUnderusing);
      case 2n:
        return RtcEventLogParseStatusOr.ofValue(BandwidthUsage.kBwOverusing);
    }
    return RtcEventLogParseStatusOr.error("Failed to decode BandwidthUsage enum");
  },
};

const definition = new RtcEventDefinition<LoggedBweDelayBasedUpdate>(
  {name: "BweDelayBased", id: RtcEventType.BweUpdateDelayBased},
  () => new LoggedBweDelayBasedUpdate(),
  [
    rtcEventField(
      {name: "bitrate_bps", fieldId: 1n, fieldType: FieldType.kVarInt, valueWidth: 32},
      (v) => RtcEventLogParseStatusOr.ofValue(Number(decodeFromUnsignedToType(v, IntegerTypes.int32))),
      (event: LoggedBweDelayBasedUpdate, bitrateBps) => {
        event.bitrateBps = bitrateBps;
      },
    ),
    rtcEventField(
      {name: "detector_state", fieldId: 2n, fieldType: FieldType.kVarInt, valueWidth: 64},
      RtcEventLogEnumBandwidthUsage.decode,
      (event: LoggedBweDelayBasedUpdate, detectorState) => {
        event.detectorState = detectorState;
      },
    ),
  ],
);

export const RtcEventBweUpdateDelayBased = {
  kType: RtcEventType.BweUpdateDelayBased,
  definition,

  parse(encodedBytes: Uint8Array, batched: boolean, output: LoggedBweDelayBasedUpdate[]): RtcEventLogParseStatus {
    return definition.parseBatch(encodedBytes, batched, output);
  },
};
