// Parser tests for the BWE event types of the new format.

import {BandwidthUsage} from "../../../src/api/transport/bandwidth-usage.js";
import {ProbeFailureReason} from "../../../src/logging/rtc-event-log/events/rtc-event-probe-result-failure.js";
import {ParsedRtcEventLog} from "../../../src/logging/rtc-event-log/rtc-event-log-parser.js";
import {
  DelayBasedBweUpdates_DetectorState as DetectorState,
  BweProbeResultFailure_FailureReason as FailureReason,
} from "../../../src/gen/rtc_event_log2_pb.js";
import {batchInit, concatBytes, eventStreamBytes} from "./new-format-builder.js";

function parse(log: Uint8Array): ParsedRtcEventLog {
  const parsed = new ParsedRtcEventLog();
  const status = parsed.parseString(log);
  if (!status.ok()) throw new Error(status.message());
  return parsed;
}

function parseError(log: Uint8Array): string {
  const status = new ParsedRtcEventLog().parseString(log);
  expect(status.ok()).toBe(false);
  return status.message();
}

describe("BWE events", () => {
  test("DelayBasedBweUpdates", () => {
    const ts = [100, 125, 150, 175, 190];
    const bitrates = [300_000, 350_000, 0xffffffff, 280_000, 1];
    const states = [DetectorState.BWE_NORMAL, DetectorState.BWE_OVERUSING, DetectorState.BWE_UNDERUSING, DetectorState.BWE_UNKNOWN_STATE, 7];
    const parsed = parse(
      eventStreamBytes({delayBasedBweUpdates: [batchInit(ts, {bitrateBps: bitrates, detectorState: states})]}),
    );
    const updates = parsed.bweDelayUpdates();
    expect(updates.map((u) => u.logTimeMs())).toEqual(ts);
    // uint32 -> int32_t, as the C++ struct stores it.
    expect(updates.map((u) => u.bitrateBps)).toEqual([300_000, 350_000, -1, 280_000, 1]);
    expect(updates.map((u) => u.detectorState)).toEqual([
      BandwidthUsage.kBwNormal,
      BandwidthUsage.kBwOverusing,
      BandwidthUsage.kBwUnderusing,
      BandwidthUsage.kBwNormal, // unknown state
      BandwidthUsage.kBwNormal, // out of range
    ]);
    expect(parsed.firstTimestamp()).toBe(100_000);
    expect(parsed.lastTimestamp()).toBe(190_000);
  });

  test("LastEventBeforeFirstFailsTheLogSegmentCheck", () => {
    // first/last timestamps are taken from the vector ends without sorting,
    // so a batch ending earlier than it starts trips start_us <= stop_us,
    // as in upstream.
    const log = eventStreamBytes({delayBasedBweUpdates: [batchInit([100, 90], {bitrateBps: [1, 1], detectorState: [1, 1]})]});
    expect(parseError(log)).toBe("start_us<=stop_us");
  });

  test("LossBasedBweUpdates", () => {
    const ts = [10, 20, 30];
    const parsed = parse(
      eventStreamBytes({
        lossBasedBweUpdates: [
          batchInit(ts, {bitrateBps: [500_000, 450_000, 460_000], fractionLoss: [0, 25, 300], totalPackets: [100, 120, 0x80000000]}),
        ],
      }),
    );
    const updates = parsed.bweLossUpdates();
    expect(updates.map((u) => u.bitrateBps)).toEqual([500_000, 450_000, 460_000]);
    expect(updates.map((u) => u.fractionLost)).toEqual([0, 25, 300 & 0xff]); // uint8_t
    expect(updates.map((u) => u.expectedPackets)).toEqual([100, 120, -0x80000000]); // int32_t
  });

  test("ScreamBweUpdates", () => {
    const ts = [1, 2];
    const parsed = parse(
      eventStreamBytes({
        screamBweUpdates: [
          batchInit(ts, {
            refWindowBytes: [10_000, 12_000],
            dataInFlightBytes: [5000, 4000],
            targetRateKbps: [800, 900],
            smoothedRttMs: [40, 45],
            avgQueueDelayMs: [3, 1],
            l4sMarkedPermille: [0, 12],
          }),
        ],
      }),
    );
    const [a, b] = parsed.bweScreamUpdates();
    expect(a.refWindow).toBe(10_000);
    expect(b.dataInFlight).toBe(4000);
    expect(b.targetRate).toBe(900_000);
    expect(b.smoothedRtt).toBe(45_000);
    expect(a.avgQueueDelay).toBe(3_000);
    expect(b.l4sMarkedPermille).toBe(12);
  });

  test("RemoteEstimates", () => {
    const ts = [5, 6, 7];
    const parsed = parse(
      eventStreamBytes({
        remoteEstimates: [batchInit(ts, {linkCapacityLowerKbps: [100, undefined, 300], linkCapacityUpperKbps: [undefined, 2000, 2500]})],
      }),
    );
    const events = parsed.remoteEstimateEvents();
    expect(events.map((e) => e.linkCapacityLower)).toEqual([100_000, undefined, 300_000]);
    expect(events.map((e) => e.linkCapacityUpper)).toEqual([undefined, 2_000_000, 2_500_000]);
    expect(parsed.lastTimestamp()).toBe(7000);
  });

  test("ProbesAlrAndRouteChanges", () => {
    const log = concatBytes(
      eventStreamBytes({probeClusters: [{timestampMs: 1n, id: 3, bitrateBps: 900_000, minPackets: 5, minBytes: 1000}]}),
      eventStreamBytes({probeSuccess: [{timestampMs: 2n, id: 3, bitrateBps: 850_000}]}),
      eventStreamBytes({probeFailure: [{timestampMs: 3n, id: 4, failure: FailureReason.INVALID_SEND_RECEIVE_RATIO}]}),
      eventStreamBytes({probeFailure: [{timestampMs: 4n, id: 5, failure: FailureReason.UNKNOWN}]}),
      eventStreamBytes({alrStates: [{timestampMs: 5n, inAlr: true}]}),
      eventStreamBytes({routeChanges: [{timestampMs: 6n, connected: true, overhead: 48}]}),
    );
    const parsed = parse(log);
    const cluster = parsed.bweProbeClusterCreatedEvents()[0];
    expect([cluster.id, cluster.bitrateBps, cluster.minPackets, cluster.minBytes, cluster.logTimeMs()]).toEqual([3, 900_000, 5, 1000, 1]);
    expect(parsed.bweProbeSuccessEvents()[0].bitrateBps).toBe(850_000);
    expect(parsed.bweProbeFailureEvents().map((e) => [e.id, e.failureReason])).toEqual([
      [4, ProbeFailureReason.kInvalidSendReceiveRatio],
      [5, ProbeFailureReason.kTimeout],
    ]);
    expect(parsed.alrStateEvents()[0].inAlr).toBe(true);
    expect(parsed.routeChangeEvents()[0].overhead).toBe(48);
    expect(parsed.firstTimestamp()).toBe(1000);
    expect(parsed.lastTimestamp()).toBe(6000);
  });

  test("MissingRequiredFields", () => {
    expect(parseError(eventStreamBytes({alrStates: [{timestampMs: 5n}]}))).toBe("proto.has_in_alr()");
    expect(parseError(eventStreamBytes({routeChanges: [{timestampMs: 5n, connected: false}]}))).toBe("proto.has_overhead()");
    expect(parseError(eventStreamBytes({probeSuccess: [{timestampMs: 5n, id: 1}]}))).toBe("proto.has_bitrate_bps()");
    expect(parseError(eventStreamBytes({delayBasedBweUpdates: [{timestampMs: 5n, bitrateBps: 1}]}))).toBe(
      "proto.has_detector_state()",
    );
    expect(parseError(eventStreamBytes({screamBweUpdates: [{timestampMs: 5n, refWindowBytes: 1}]}))).toBe(
      "proto.has_dataInFlightBytes()",
    );
  });

  test("DeltaValueOutOfRange", () => {
    // A delta-decoded bitrate above uint32 max is rejected.
    const init = batchInit([1, 2], {bitrateBps: [1, 2], detectorState: [1, 1]});
    // Re-encode the bitrate deltas with a 64-bit value.
    const log = eventStreamBytes({
      delayBasedBweUpdates: [{...init, bitrateBpsDeltas: batchInit([1, 2], {x: [1, 2 ** 40]}).xDeltas as Uint8Array}],
    });
    expect(parseError(log)).toBe("bitrate_bps_values[i].value()<=std::numeric_limits<uint32_t>::max()");
  });
});
