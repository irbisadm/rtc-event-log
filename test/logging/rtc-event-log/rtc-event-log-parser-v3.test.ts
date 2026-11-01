// Parser tests for the v3 format (ParseStreamInternalV3): the stream-level
// checks and the per-event behavior the golden logs (golden/v3-*) cannot
// show because upstream rejects the log. Events are written with the ported
// EventEncoder.

import {RtcEventType} from "../../../src/api/rtc-event-log/rtc-event.js";
import {BandwidthUsage} from "../../../src/api/transport/bandwidth-usage.js";
import {encodeVarInt} from "../../../src/logging/rtc-event-log/encoder/var-int.js";
import {RtcEventAlrState} from "../../../src/logging/rtc-event-log/events/rtc-event-alr-state.js";
import {RtcEventAudioPlayout} from "../../../src/logging/rtc-event-log/events/rtc-event-audio-playout.js";
import {RtcEventBeginLog} from "../../../src/logging/rtc-event-log/events/rtc-event-begin-log.js";
import {
  RtcEventBweUpdateDelayBased,
  RtcEventLogEnumBandwidthUsage,
} from "../../../src/logging/rtc-event-log/events/rtc-event-bwe-update-delay-based.js";
import {EventEncoder} from "../../../src/logging/rtc-event-log/events/rtc-event-field-encoding.js";
import {encodeAsUnsigned, IntegerTypes} from "../../../src/logging/rtc-event-log/events/rtc-event-field-extraction.js";
import {ParsedRtcEventLog} from "../../../src/logging/rtc-event-log/rtc-event-log-parser.js";

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const ev = (ms: number) => ({timestampUs: BigInt(ms) * 1000n});

function beginLog(ms: number, utcMs: number): Uint8Array {
  const encoder = new EventEncoder({name: "BeginLog", id: RtcEventType.BeginV3Log}, [ev(ms)]);
  encoder.encodeField(RtcEventBeginLog.utcStartTimeParams, [encodeAsUnsigned(BigInt(utcMs), IntegerTypes.int64)]);
  return encoder.asBytes();
}

function endLog(ms: number): Uint8Array {
  return new EventEncoder({name: "EndLog", id: RtcEventType.EndV3Log}, [ev(ms)]).asBytes();
}

function alrStates(events: [number, boolean][]): Uint8Array {
  const definition = RtcEventAlrState.definition;
  const encoder = new EventEncoder(
    definition.params,
    events.map(([ms]) => ev(ms)),
  );
  encoder.encodeField(
    {name: "in_alr", fieldId: 1n, fieldType: 0, valueWidth: 1},
    events.map(([, inAlr]) => encodeAsUnsigned(inAlr, IntegerTypes.bool)),
  );
  return encoder.asBytes();
}

function delayBased(events: [number, number, bigint][]): Uint8Array {
  const encoder = new EventEncoder(
    RtcEventBweUpdateDelayBased.definition.params,
    events.map(([ms]) => ev(ms)),
  );
  encoder.encodeField(
    {name: "bitrate_bps", fieldId: 1n, fieldType: 3, valueWidth: 32},
    events.map(([, bps]) => encodeAsUnsigned(BigInt(bps), IntegerTypes.int32)),
  );
  encoder.encodeField(
    {name: "detector_state", fieldId: 2n, fieldType: 3, valueWidth: 64},
    events.map(([, , state]) => state),
  );
  return encoder.asBytes();
}

// An event with the given type and raw field bytes.
function rawEvent(type: number, batched: boolean, fields: Uint8Array): Uint8Array {
  return concat(encodeVarInt((BigInt(type) << 1n) + (batched ? 1n : 0n)), encodeVarInt(BigInt(fields.length)), fields);
}

function parseStatus(log: Uint8Array): string {
  return new ParsedRtcEventLog().parseString(log).message();
}

function parse(log: Uint8Array): ParsedRtcEventLog {
  const parsed = new ParsedRtcEventLog();
  const status = parsed.parseString(log);
  if (!status.ok()) throw new Error(status.message());
  return parsed;
}

describe("v3 stream", () => {
  test("begin and end log", () => {
    const parsed = parse(concat(beginLog(1000, 1_600_000_000_000), endLog(2500)));
    expect(parsed.startLogEvents().map((e) => [e.timestamp, e.utcStartTime])).toEqual([[1_000_000, 1_600_000_000_000_000]]);
    expect(parsed.stopLogEvents().map((e) => e.timestamp)).toEqual([2_500_000]);
  });

  test("an event after the end of the log must begin a new log", () => {
    expect(parseStatus(concat(beginLog(1000, 0), endLog(1001), alrStates([[1002, true]])))).toBe(
      "event_type==static_cast<uint32_t>(RtcEvent::Type::BeginV3Log)",
    );
    const parsed = parse(concat(beginLog(1000, 0), endLog(1001), beginLog(1002, 5), alrStates([[1003, true]])));
    expect(parsed.startLogEvents().length).toBe(2);
    expect(parsed.alrStateEvents().map((e) => [e.timestamp, e.inAlr])).toEqual([[1_003_000, true]]);
  });

  test("truncated event tag", () => {
    expect(parseStatus(concat(beginLog(1000, 0), Uint8Array.of(0x80)))).toBe("Failed to read event type.");
  });

  test("truncated event size", () => {
    expect(parseStatus(concat(beginLog(1000, 0), Uint8Array.of(0x02, 0x80)))).toBe("Failed to read event size.");
  });

  test("event larger than the rest of the log", () => {
    expect(parseStatus(concat(beginLog(1000, 0), Uint8Array.of(0x02, 0x05, 0x01)))).toBe("event_size_bytes<=s.size()");
  });

  test("event larger than kMaxEventSize", () => {
    const tooLarge = concat(Uint8Array.of(0x02), encodeVarInt(10_000_001n));
    expect(parseStatus(concat(beginLog(1000, 0), tooLarge))).toBe("event_size_bytes<=kMaxEventSize");
  });

  test("unknown and unimplemented event types are skipped", () => {
    const parsed = parse(
      concat(
        beginLog(1000, 0),
        rawEvent(100, false, Uint8Array.of(1, 2, 3)),
        rawEvent(RtcEventType.RtpPacketIncoming, true, Uint8Array.of(9)),
        rawEvent(RtcEventType.ProbeClusterCreated, false, new Uint8Array(0)),
        alrStates([[1001, false]]),
      ),
    );
    expect(parsed.alrStateEvents().length).toBe(1);
    expect(parsed.incomingRtpPacketsBySsrc().length).toBe(0);
    expect(parsed.bweProbeClusterCreatedEvents().length).toBe(0);
  });
});

describe("v3 events", () => {
  test("delay-based updates (batched, signed bitrates)", () => {
    const parsed = parse(
      concat(
        beginLog(1000, 0),
        delayBased([
          [1001, 300_000, 0n],
          [1003, -5, 2n],
          [1007, 2_147_483_647, 1n],
        ]),
      ),
    );
    expect(parsed.bweDelayUpdates().map((e) => [e.timestamp, e.bitrateBps, e.detectorState])).toEqual([
      [1_001_000, 300_000, BandwidthUsage.kBwNormal],
      [1_003_000, -5, BandwidthUsage.kBwOverusing],
      [1_007_000, 2_147_483_647, BandwidthUsage.kBwUnderusing],
    ]);
  });

  test("an invalid enum value leaves the batch partly populated", () => {
    const parsed = parse(
      concat(
        beginLog(1000, 0),
        delayBased([
          [1001, 1000, 1n],
          [1002, 2000, 3n],
        ]),
      ),
    );
    // Timestamps and bitrates are stored before the detector states, which
    // are decoded in order until the invalid one; the rest keep their default.
    expect(parsed.bweDelayUpdates().map((e) => [e.timestamp, e.bitrateBps, e.detectorState])).toEqual([
      [1_001_000, 1000, BandwidthUsage.kBwUnderusing],
      [1_002_000, 2000, BandwidthUsage.kBwNormal],
    ]);
    expect(RtcEventLogEnumBandwidthUsage.decode(3n).message()).toBe("Failed to decode BandwidthUsage enum");
  });

  test("a bitrate outside int32 decodes as 0", () => {
    const encoder = new EventEncoder(RtcEventBweUpdateDelayBased.definition.params, [ev(1001)]);
    encoder.encodeField({name: "bitrate_bps", fieldId: 1n, fieldType: 3, valueWidth: 32}, [(1n << 32n) + 5n]);
    encoder.encodeField({name: "detector_state", fieldId: 2n, fieldType: 3, valueWidth: 64}, [0n]);
    const parsed = parse(concat(beginLog(1000, 0), encoder.asBytes()));
    expect(parsed.bweDelayUpdates().map((e) => e.bitrateBps)).toEqual([0]);
  });

  test("a truncated batch leaves default events behind", () => {
    const parsed = parse(
      concat(
        beginLog(1000, 0),
        rawEvent(RtcEventType.AlrStateEvent, true, encodeVarInt(2n)),
        rawEvent(RtcEventType.AudioPlayout, true, encodeVarInt(3n)),
      ),
    );
    expect(parsed.alrStateEvents().map((e) => [e.timestamp, e.inAlr])).toEqual([
      [-Infinity, false],
      [-Infinity, false],
    ]);
    expect([...parsed.audioPlayoutEvents()].map(([ssrc, events]) => [ssrc, events.length])).toEqual([[0, 3]]);
  });

  test("a begin log without the UTC time keeps its default", () => {
    const begin = new EventEncoder({name: "BeginLog", id: RtcEventType.BeginV3Log}, [ev(1000)]).asBytes();
    const parsed = parse(begin);
    expect(parsed.startLogEvents().map((e) => [e.timestamp, e.utcStartTime])).toEqual([[1_000_000, Infinity]]);
  });

  test("audio playout events are grouped by SSRC", () => {
    const encoder = new EventEncoder(RtcEventAudioPlayout.definition.params, [ev(1001), ev(1002), ev(1003)]);
    encoder.encodeField({name: "ssrc", fieldId: 1n, fieldType: 1, valueWidth: 32}, [7n, 0xffffffffn, 7n]);
    const parsed = parse(concat(beginLog(1000, 0), encoder.asBytes()));
    expect([...parsed.audioPlayoutEvents()].map(([ssrc, events]) => [ssrc, events.map((e) => e.timestamp)])).toEqual([
      [7, [1_001_000, 1_003_000]],
      [0xffffffff, [1_002_000]],
    ]);
  });
});
