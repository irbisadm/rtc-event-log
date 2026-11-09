// Port of logging/rtc_event_log/rtc_event_processor_unittest.cc @ M154.
// TieBreaker<T>::type_order becomes the TypeOrder values passed to addEvents.

import {RTPHeader} from "../../../src/api/rtp-headers.js";
import {Timestamp} from "../../../src/api/units/timestamp.js";
import {LoggedRtpPacket} from "../../../src/logging/rtc-event-log/events/logged-rtp-rtcp.js";
import {LoggedStartEvent} from "../../../src/logging/rtc-event-log/events/rtc-event-begin-log.js";
import {LoggedStopEvent} from "../../../src/logging/rtc-event-log/events/rtc-event-end-log.js";
import {PacketDirection} from "../../../src/logging/rtc-event-log/rtc-event-log-parser.js";
import {RtcEventProcessor} from "../../../src/logging/rtc-event-log/rtc-event-processor.js";
import {
  rtcpTypeOrder,
  rtpTransportSeqNum,
  rtpTypeOrder,
  TypeOrder,
} from "../../../src/logging/rtc-event-log/rtc-event-processor-order.js";
import {Random} from "../../rtc-base/random.js";

const createEvent = (timeMs: number, utcTimeMs: number) => new LoggedStartEvent(Timestamp.millis(timeMs), Timestamp.millis(utcTimeMs));
const createEventList = (timestamps: number[]) => timestamps.map((t) => new LoggedStartEvent(Timestamp.millis(t)));

function createRandomEventLists(numLists: number, numElements: number, seed: bigint): LoggedStartEvent[][] {
  const prng = new Random(seed);
  const lists: LoggedStartEvent[][] = Array.from({length: numLists}, () => []);
  for (let elem = 0; elem < numElements; elem++) {
    const i = prng.randRange(0, numLists - 1);
    lists[i].push(new LoggedStartEvent(Timestamp.millis(elem)));
  }
  return lists;
}

function createRtpPacket(timeMs: number, ssrc: number, transportSeqNum: number | undefined): LoggedRtpPacket {
  const header = new RTPHeader();
  header.ssrc = ssrc;
  header.timestamp = timeMs >>> 0;
  header.paddingLength = 0;
  header.headerLength = 20;
  header.extension.hasTransportSequenceNumber = transportSeqNum !== undefined;
  if (transportSeqNum !== undefined) {
    header.extension.transportSequenceNumber = transportSeqNum;
  }
  return new LoggedRtpPacket(Timestamp.millis(timeMs), header, 20, 1000);
}

describe("RtcEventProcessor", () => {
  test("NoList", () => {
    const processor = new RtcEventProcessor();
    processor.processEventsInOrder(); // Don't crash but do nothing.
  });

  test("EmptyList", () => {
    const notCalled = () => {
      throw new Error("called");
    };
    const processor = new RtcEventProcessor();
    processor.addEvents([] as LoggedStartEvent[], notCalled, TypeOrder.Start);
    processor.processEventsInOrder(); // Don't crash but do nothing.
  });

  test("OneList", () => {
    const result: LoggedStartEvent[] = [];
    const processor = new RtcEventProcessor();
    processor.addEvents(createEventList([1, 2, 3, 4]), (e) => result.push(e), TypeOrder.Start);
    processor.processEventsInOrder();

    expect(result.map((e) => e.logTimeMs())).toEqual([1, 2, 3, 4]);
  });

  test("MergeTwoLists", () => {
    const result: LoggedStartEvent[] = [];
    const f = (e: LoggedStartEvent) => result.push(e);
    const processor = new RtcEventProcessor();
    processor.addEvents(createEventList([1, 2, 4, 7, 8, 9]), f, TypeOrder.Start);
    processor.addEvents(createEventList([3, 5, 6, 10]), f, TypeOrder.Start);
    processor.processEventsInOrder();

    expect(result.map((e) => e.logTimeMs())).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("MergeTwoListsWithDuplicatedElements", () => {
    const result: LoggedStartEvent[] = [];
    const f = (e: LoggedStartEvent) => result.push(e);
    const processor = new RtcEventProcessor();
    processor.addEvents(createEventList([1, 2, 2, 3, 5, 5]), f, TypeOrder.Start);
    processor.addEvents(createEventList([1, 3, 4, 4]), f, TypeOrder.Start);
    processor.processEventsInOrder();

    expect(result.map((e) => e.logTimeMs())).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  test("MergeManyLists", () => {
    const result: LoggedStartEvent[] = [];
    const f = (e: LoggedStartEvent) => result.push(e);
    const kNumLists = 5;
    const kNumElems = 30;
    const kSeed = 0xf3c6b91fn;
    const lists = createRandomEventLists(kNumLists, kNumElems, kSeed);
    expect(lists).toHaveLength(kNumLists);
    const processor = new RtcEventProcessor();
    for (const list of lists) processor.addEvents(list, f, TypeOrder.Start);
    processor.processEventsInOrder();

    expect(result.map((e) => e.logTimeMs())).toEqual(Array.from({length: kNumElems}, (_, i) => i));
  });

  test("DifferentTypes", () => {
    const result: number[] = [];
    const processor = new RtcEventProcessor();
    processor.addEvents([new LoggedStartEvent(Timestamp.millis(2))], (e) => result.push(e.logTimeMs()), TypeOrder.Start);
    processor.addEvents([new LoggedStopEvent(Timestamp.millis(1))], (e) => result.push(e.logTimeMs()), TypeOrder.Stop);
    processor.processEventsInOrder();

    expect(result).toEqual([1, 2]);
  });

  test("IncomingPacketBeforeOutgoingFeedback", () => {
    expect(TypeOrder.RtpIn).toBeLessThan(TypeOrder.RtcpOut);
  });

  test("PacketWrapperTypesOrderedAsRtp", () => {
    expect(TypeOrder.RtpIn).toBe(rtpTypeOrder(PacketDirection.kIncomingPacket));
    expect(TypeOrder.RtpOut).toBe(rtpTypeOrder(PacketDirection.kOutgoingPacket));
    expect(TypeOrder.RtcpIn).toBe(rtcpTypeOrder(PacketDirection.kIncomingPacket));
    expect(TypeOrder.RtcpOut).toBe(rtcpTypeOrder(PacketDirection.kOutgoingPacket));
  });

  test("IncomingFeedbackBeforeBwe", () => {
    for (const bwe of [
      TypeOrder.BweProbeSuccess,
      TypeOrder.BweRemoteEstimate,
      TypeOrder.BweProbeFailure,
      TypeOrder.BweDelayBased,
      TypeOrder.BweLossBased,
      TypeOrder.BweProbeCreated,
    ]) {
      expect(TypeOrder.RtcpIn).toBeLessThan(bwe);
    }
  });

  const collect = (results: [number, number | undefined][]) => (packet: LoggedRtpPacket) => {
    results.push([packet.header.ssrc, rtpTransportSeqNum(packet)]);
  };

  test("RtpPacketsInTransportSeqNumOrder", () => {
    const ssrc1234 = [createRtpPacket(1, 1234, undefined), createRtpPacket(1, 1234, undefined)];
    const ssrc2345 = [createRtpPacket(1, 2345, 2), createRtpPacket(1, 2345, 3), createRtpPacket(1, 2345, 6)];
    const ssrc3456 = [createRtpPacket(1, 3456, 1), createRtpPacket(1, 3456, 4), createRtpPacket(1, 3456, 5)];
    const results: [number, number | undefined][] = [];
    const order = rtpTypeOrder(PacketDirection.kIncomingPacket);
    const processor = new RtcEventProcessor();
    processor.addEvents(ssrc1234, collect(results), order, rtpTransportSeqNum);
    processor.addEvents(ssrc2345, collect(results), order, rtpTransportSeqNum);
    processor.addEvents(ssrc3456, collect(results), order, rtpTransportSeqNum);
    processor.processEventsInOrder();

    expect(results).toEqual([
      [1234, undefined],
      [1234, undefined],
      [3456, 1],
      [2345, 2],
      [2345, 3],
      [3456, 4],
      [3456, 5],
      [2345, 6],
    ]);
  });

  test("TransportSeqNumOrderHandlesWrapAround", () => {
    const ssrc1234 = [createRtpPacket(0, 1234, 0xffff - 1), createRtpPacket(1, 1234, 1), createRtpPacket(1, 1234, 2)];
    const ssrc2345 = [createRtpPacket(1, 2345, 0xffff), createRtpPacket(1, 2345, 0), createRtpPacket(1, 2345, 3)];
    const results: [number, number | undefined][] = [];
    const order = rtpTypeOrder(PacketDirection.kOutgoingPacket);
    const processor = new RtcEventProcessor();
    processor.addEvents(ssrc1234, collect(results), order, rtpTransportSeqNum);
    processor.addEvents(ssrc2345, collect(results), order, rtpTransportSeqNum);
    processor.processEventsInOrder();

    expect(results).toEqual([
      [1234, 0xffff - 1],
      [2345, 0xffff],
      [2345, 0],
      [1234, 1],
      [1234, 2],
      [2345, 3],
    ]);
  });

  test("InsertionOrderIfNoTransportSeqNum", () => {
    const results: number[] = [];
    const getUtcTime = (elem: LoggedStartEvent) => results.push(Timestamp.ms(elem.utcTime()));
    const processor = new RtcEventProcessor();
    processor.addEvents([createEvent(1, 222)], getUtcTime, TypeOrder.Start);
    processor.addEvents([createEvent(1, 111)], getUtcTime, TypeOrder.Start);
    processor.addEvents([createEvent(1, 333)], getUtcTime, TypeOrder.Start);
    processor.processEventsInOrder();

    expect(results).toEqual([222, 111, 333]);
  });
});
