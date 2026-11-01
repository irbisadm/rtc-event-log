// Port of modules/rtp_rtcp/source/rtcp_packet/transport_feedback_unittest.cc @ M154.
// Times are microseconds.

import {ByteReader, ByteWriter} from "../../../../../src/modules/rtp-rtcp/source/byte-io.js";
import {CommonHeader} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/common-header.js";
import {TransportFeedback} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/transport-feedback.js";

const kHeaderSize = 20;
const kStatusChunkSize = 2;
const kSmallDeltaSize = 1;
const kLargeDeltaSize = 2;
const kDeltaTick = TransportFeedback.kDeltaTick;

const kDeltaLimit = 0xff * kDeltaTick;
const kBaseTimeTick = kDeltaTick * (1 << 8);
const kBaseTimeWrapPeriod = kBaseTimeTick * (1 << 24);
const ms = (v: number) => v * 1000;

function isValidFeedback(arg: Uint8Array): boolean {
  const rtcpHeader = new CommonHeader();
  const feedback = new TransportFeedback();
  return (
    rtcpHeader.parse(arg) &&
    rtcpHeader.type() === TransportFeedback.kPacketType &&
    rtcpHeader.fmt() === TransportFeedback.kFeedbackMessageType &&
    feedback.parse(rtcpHeader)
  );
}

function parse(buffer: Uint8Array): TransportFeedback {
  const header = new CommonHeader();
  expect(header.parse(buffer)).toBe(true);
  expect(header.type()).toBe(TransportFeedback.kPacketType);
  expect(header.fmt()).toBe(TransportFeedback.kFeedbackMessageType);
  const feedback = new TransportFeedback();
  expect(feedback.parse(header)).toBe(true);
  return feedback;
}

class FeedbackTester {
  static readonly kAnySize = -1;

  private expectedSeq: number[] = [];
  private expectedDeltas: number[] = [];
  private expectedSize = FeedbackTester.kAnySize;
  private defaultDelta = kDeltaTick * 4;
  private feedback: TransportFeedback | undefined;
  private serialized: Uint8Array = new Uint8Array(0);

  constructor(private readonly includeTimestamps = true) {}

  withExpectedSize(expectedSize: number): void {
    this.expectedSize = expectedSize;
  }

  withDefaultDelta(delta: number): void {
    this.defaultDelta = delta;
  }

  withInput(receivedSeq: readonly number[], receivedTs: readonly number[] = []): void {
    if (receivedTs.length === 0) {
      receivedTs = this.generateReceiveTimestamps(receivedSeq);
    }
    expect(receivedTs.length).toBe(receivedSeq.length);
    this.expectedDeltas = [];
    const feedback = new TransportFeedback(this.includeTimestamps);
    this.feedback = feedback;
    feedback.setBase(receivedSeq[0], receivedTs[0]);
    expect(feedback.isConsistent()).toBe(true);
    expect(feedback.addReceivedPacket(receivedSeq[0], receivedTs[0])).toBe(true);
    this.expectedDeltas.push(0 - feedback.getBaseDelta(receivedTs[0])); // no -0
    for (let i = 1; i < receivedTs.length; ++i) {
      expect(feedback.addReceivedPacket(receivedSeq[i], receivedTs[i])).toBe(true);
      this.expectedDeltas.push(receivedTs[i] - receivedTs[i - 1]);
    }
    expect(feedback.isConsistent()).toBe(true);
    this.expectedSeq = [...receivedSeq];
  }

  verifyPacket(): void {
    expect(this.feedback!.isConsistent()).toBe(true);
    this.serialized = this.feedback!.build();
    this.verifyInternal();
    this.feedback = parse(this.serialized);
    expect(this.feedback.isConsistent()).toBe(true);
    expect(this.feedback.includeTimestamps()).toBe(this.includeTimestamps);
    this.verifyInternal();
  }

  private verifyInternal(): void {
    if (this.expectedSize !== FeedbackTester.kAnySize) {
      // Round up to whole 32-bit words.
      const expectedSizeWords = Math.floor((this.expectedSize + 3) / 4);
      expect(this.serialized.length).toBe(expectedSizeWords * 4);
    }

    const actualSeqNos = this.feedback!.getReceivedPackets().map((p) => p.sequenceNumber());
    const actualDeltas = this.feedback!.getReceivedPackets().map((p) => p.delta());
    expect(actualSeqNos).toEqual(this.expectedSeq);
    if (this.includeTimestamps) {
      expect(actualDeltas).toEqual(this.expectedDeltas);
    }
  }

  private generateReceiveTimestamps(seqNums: readonly number[]): number[] {
    let lastSeq = seqNums[0];
    let time = 0;
    const result: number[] = [];
    for (const seq of seqNums) {
      if (seq < lastSeq) time += 0x10000 * this.defaultDelta;
      lastSeq = seq;
      result.push(time + lastSeq * this.defaultDelta);
    }
    return result;
  }
}

describe("RtcpPacketTest", () => {
  test("TransportFeedbackOneBitVector", () => {
    const kReceived = [1, 2, 7, 8, 9, 10, 13];
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize + kReceived.length * kSmallDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived);
    t.verifyPacket();
  });

  test("TransportFeedbackOneBitVectorNoRecvDelta", () => {
    const kReceived = [1, 2, 7, 8, 9, 10, 13];
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize;

    const t = new FeedbackTester(/*include_timestamps=*/ false);
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived);
    t.verifyPacket();
  });

  test("TransportFeedbackFullOneBitVector", () => {
    const kReceived = [1, 2, 7, 8, 9, 10, 13, 14];
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize + kReceived.length * kSmallDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived);
    t.verifyPacket();
  });

  test("TransportFeedbackOneBitVectorWrapReceived", () => {
    const kMax = 0xffff;
    const kReceived = [kMax - 2, kMax - 1, kMax, 0, 1, 2];
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize + kReceived.length * kSmallDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived);
    t.verifyPacket();
  });

  test("TransportFeedbackOneBitVectorWrapMissing", () => {
    const kMax = 0xffff;
    const kReceived = [kMax - 2, kMax - 1, 1, 2];
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize + kReceived.length * kSmallDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived);
    t.verifyPacket();
  });

  test("TransportFeedbackTwoBitVector", () => {
    const kReceived = [1, 2, 6, 7];
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize + kReceived.length * kLargeDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withDefaultDelta(kDeltaLimit + kDeltaTick);
    t.withInput(kReceived);
    t.verifyPacket();
  });

  test("TransportFeedbackTwoBitVectorFull", () => {
    const kReceived = [1, 2, 6, 7, 8];
    const kExpectedSizeBytes = kHeaderSize + 2 * kStatusChunkSize + kReceived.length * kLargeDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withDefaultDelta(kDeltaLimit + kDeltaTick);
    t.withInput(kReceived);
    t.verifyPacket();
  });

  test("TransportFeedbackWithLargeBaseTimeIsConsistent", () => {
    const tb = new TransportFeedback();
    const kTimestamp = 0x7fffffff * kDeltaTick;
    tb.setBase(/*base_sequence=*/ 0, /*ref_timestamp=*/ kTimestamp);
    tb.addReceivedPacket(/*base_sequence=*/ 0, /*timestamp=*/ kTimestamp);
    expect(tb.isConsistent()).toBe(true);
  });

  test("TransportFeedbackLargeAndNegativeDeltas", () => {
    const kReceived = [1, 2, 6, 7, 8];
    const kReceiveTimes = [ms(2), ms(1), ms(4), ms(3), ms(3) + kDeltaTick * (1 << 8)];
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize + 3 * kLargeDeltaSize + kSmallDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived, kReceiveTimes);
    t.verifyPacket();
  });

  test("TransportFeedbackMaxRle", () => {
    // Expected chunks created:
    // * 1-bit vector chunk (1xreceived + 13xdropped)
    // * RLE chunk of max length for dropped symbol
    // * 1-bit vector chunk (1xreceived + 13xdropped)
    const kPacketCount = (1 << 13) - 1 + 14;
    const kReceived = [0, kPacketCount];
    const kReceiveTimes = [ms(1), ms(2)];
    const kExpectedSizeBytes = kHeaderSize + 3 * kStatusChunkSize + kReceived.length * kSmallDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived, kReceiveTimes);
    t.verifyPacket();
  });

  test("TransportFeedbackMinRle", () => {
    // Expected chunks created:
    // * 1-bit vector chunk (1xreceived + 13xdropped)
    // * RLE chunk of length 15 for dropped symbol
    // * 1-bit vector chunk (1xreceived + 13xdropped)
    const kReceived = [0, 14 * 2 + 1];
    const kReceiveTimes = [ms(1), ms(2)];
    const kExpectedSizeBytes = kHeaderSize + 3 * kStatusChunkSize + kReceived.length * kSmallDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived, kReceiveTimes);
    t.verifyPacket();
  });

  test("TransportFeedbackOneToTwoBitVector", () => {
    const kTwoBitVectorCapacity = 7;
    const kReceived = [0, kTwoBitVectorCapacity - 1];
    const kReceiveTimes = [0, kDeltaLimit + kDeltaTick];
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize + kSmallDeltaSize + kLargeDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived, kReceiveTimes);
    t.verifyPacket();
  });

  test("TransportFeedbackOneToTwoBitVectorSimpleSplit", () => {
    const kTwoBitVectorCapacity = 7;
    const kReceived = [0, kTwoBitVectorCapacity];
    const kReceiveTimes = [0, kDeltaLimit + kDeltaTick];
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize * 2 + kSmallDeltaSize + kLargeDeltaSize;

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived, kReceiveTimes);
    t.verifyPacket();
  });

  test("TransportFeedbackOneToTwoBitVectorSplit", () => {
    // With received small delta = S, received large delta = L, use input
    // SSSSSSSSLSSSSSSSSSSSS. This will cause a 1:2 split at the L.
    // After split there will be two symbols in symbol_vec: SL.

    const kLargeDelta = kDeltaTick * (1 << 8);
    const kNumPackets = 3 * 7 + 1;
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize * 3 + kSmallDeltaSize * (kNumPackets - 1) + kLargeDeltaSize * 1;

    const kReceived = Array.from({length: kNumPackets}, (_, i) => i);

    const receiveTimes = [ms(1)];
    for (let i = 1; i < kNumPackets; ++i) {
      const delta = i === 8 ? kLargeDelta : ms(1);
      receiveTimes.push(receiveTimes[receiveTimes.length - 1] + delta);
    }

    const t = new FeedbackTester();
    t.withExpectedSize(kExpectedSizeBytes);
    t.withInput(kReceived, receiveTimes);
    t.verifyPacket();
  });

  test("TransportFeedbackAliasing", () => {
    const feedback = new TransportFeedback();
    feedback.setBase(0, 0);

    const kSamples = 100;
    const kTooSmallDelta = Math.trunc(kDeltaTick / 3);

    for (let i = 0; i < kSamples; ++i) feedback.addReceivedPacket(i, i * kTooSmallDelta);

    feedback.build();

    let accumulatedDelta = 0;
    let numSamples = 0;
    for (const packet of feedback.getReceivedPackets()) {
      accumulatedDelta += packet.delta();
      const expectedTime = numSamples * kTooSmallDelta;
      ++numSamples;

      expect(Math.abs(accumulatedDelta - expectedTime)).toBeLessThanOrEqual(kDeltaTick / 2);
    }
  });

  test("TransportFeedbackLimits", () => {
    // Sequence number wrap above 0x8000.
    let packet = new TransportFeedback();
    packet.setBase(0, 0);
    expect(packet.addReceivedPacket(0x0, 0)).toBe(true);
    expect(packet.addReceivedPacket(0x8000, ms(1))).toBe(true);

    packet = new TransportFeedback();
    packet.setBase(0, 0);
    expect(packet.addReceivedPacket(0x0, 0)).toBe(true);
    expect(packet.addReceivedPacket(0x8000 + 1, ms(1))).toBe(false);

    // Packet status count max 0xFFFF.
    packet = new TransportFeedback();
    packet.setBase(0, 0);
    expect(packet.addReceivedPacket(0x0, 0)).toBe(true);
    expect(packet.addReceivedPacket(0x8000, ms(1))).toBe(true);
    expect(packet.addReceivedPacket(0xfffe, ms(2))).toBe(true);
    expect(packet.addReceivedPacket(0xffff, ms(3))).toBe(false);

    // Too large delta.
    packet = new TransportFeedback();
    packet.setBase(0, 0);
    const kMaxPositiveTimeDelta = 0x7fff * kDeltaTick;
    expect(packet.addReceivedPacket(1, kMaxPositiveTimeDelta + kDeltaTick)).toBe(false);
    expect(packet.addReceivedPacket(1, kMaxPositiveTimeDelta)).toBe(true);

    // Too large negative delta.
    packet = new TransportFeedback();
    const kMaxNegativeTimeDelta = -0x8000 * kDeltaTick;
    // Use larger base time to avoid kBaseTime + kNegativeDelta to be negative.
    const kBaseTime = 1_000_000 * 1_000_000;
    packet.setBase(0, kBaseTime);
    expect(packet.addReceivedPacket(1, kBaseTime + kMaxNegativeTimeDelta - kDeltaTick)).toBe(false);
    expect(packet.addReceivedPacket(1, kBaseTime + kMaxNegativeTimeDelta)).toBe(true);

    // TODO(sprang): Once we support max length lower than RTCP length limit,
    // add back test for max size in bytes.
  });

  test("BaseTimeIsConsistentAcrossMultiplePackets", () => {
    const kMaxBaseTime = kBaseTimeWrapPeriod - kBaseTimeTick;

    const packet1 = new TransportFeedback();
    packet1.setBase(0, kMaxBaseTime);
    packet1.addReceivedPacket(0, kMaxBaseTime);
    // Build and parse packet to simulate sending it over the wire.
    const parsedPacket1 = parse(packet1.build());

    const packet2 = new TransportFeedback();
    packet2.setBase(1, kMaxBaseTime + kBaseTimeTick);
    packet2.addReceivedPacket(1, kMaxBaseTime + kBaseTimeTick);
    // Build and parse packet to simulate sending it over the wire.
    const parsedPacket2 = parse(packet2.build());

    expect(parsedPacket2.getBaseDelta(parsedPacket1.baseTime())).toBe(kBaseTimeTick);
  });

  test("SupportsMaximumNumberOfNegativeDeltas", () => {
    const feedback = new TransportFeedback();
    // Use large base time to avoid hitting zero limit while filling the feedback,
    // but use multiple of kBaseTimeWrapPeriod to hit edge case where base time
    // is recorded as zero in the raw rtcp packet.
    let time = 1000 * kBaseTimeWrapPeriod;
    feedback.setBase(0, time);
    const kMinDelta = kDeltaTick * -0x8000;
    let numReceivedRtpPackets = 0;
    time += kMinDelta;
    while (feedback.addReceivedPacket(++numReceivedRtpPackets, time)) {
      expect(time).toBeGreaterThanOrEqual(-kMinDelta);
      time += kMinDelta;
    }
    // The last packet was not added.
    --numReceivedRtpPackets;
    expect(feedback.isConsistent()).toBe(true);

    const parsed = parse(feedback.build());
    expect(parsed.getReceivedPackets()).toHaveLength(numReceivedRtpPackets);
    expect(parsed.getReceivedPackets().every((p) => p.delta() === kMinDelta)).toBe(true);
    expect(parsed.baseTime()).toBeGreaterThanOrEqual(-kMinDelta * numReceivedRtpPackets);
  });

  test("TransportFeedbackPadding", () => {
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize + kSmallDeltaSize;
    const kExpectedSizeWords = Math.floor((kExpectedSizeBytes + 3) / 4);
    const kExpectedPaddingSizeBytes = 4 * kExpectedSizeWords - kExpectedSizeBytes;

    const feedback = new TransportFeedback();
    feedback.setBase(0, 0);
    expect(feedback.addReceivedPacket(0, 0)).toBe(true);

    const packet = feedback.build();
    expect(packet.length).toBe(kExpectedSizeWords * 4);
    expect(kExpectedSizeWords * 4).toBeGreaterThan(kExpectedSizeBytes);
    for (let i = kExpectedSizeBytes; i < kExpectedSizeWords * 4 - 1; ++i) expect(packet[i]).toBe(0);

    expect(packet[kExpectedSizeWords * 4 - 1]).toBe(kExpectedPaddingSizeBytes);

    // Modify packet by adding 4 bytes of padding at the end. Not currently used
    // when we're sending, but need to be able to handle it when receiving.

    const kPaddingBytes = 4;
    const kExpectedSizeWithPadding = kExpectedSizeWords * 4 + kPaddingBytes;
    const modBuffer = new Uint8Array(kExpectedSizeWithPadding);
    modBuffer.set(packet.subarray(0, kExpectedSizeWords * 4));
    modBuffer[kExpectedSizeWithPadding - 1] = kPaddingBytes + kExpectedPaddingSizeBytes;
    const paddingFlag = 1 << 5;
    modBuffer[0] |= paddingFlag;
    ByteWriter.u16(modBuffer, 2, ByteReader.u16(modBuffer, 2) + Math.floor((kPaddingBytes + 3) / 4));

    expect(isValidFeedback(modBuffer)).toBe(true);
  });

  test("TransportFeedbackPaddingBackwardsCompatibility", () => {
    const kExpectedSizeBytes = kHeaderSize + kStatusChunkSize + kSmallDeltaSize;
    const kExpectedSizeWords = Math.floor((kExpectedSizeBytes + 3) / 4);
    const kExpectedPaddingSizeBytes = 4 * kExpectedSizeWords - kExpectedSizeBytes;

    const feedback = new TransportFeedback();
    feedback.setBase(0, 0);
    expect(feedback.addReceivedPacket(0, 0)).toBe(true);

    const packet = feedback.build();
    expect(packet.length).toBe(kExpectedSizeWords * 4);
    expect(kExpectedSizeWords * 4).toBeGreaterThan(kExpectedSizeBytes);
    for (let i = kExpectedSizeBytes; i < kExpectedSizeWords * 4 - 1; ++i) expect(packet[i]).toBe(0);

    expect(kExpectedPaddingSizeBytes).toBeGreaterThan(0);
    expect(packet[kExpectedSizeWords * 4 - 1]).toBe(kExpectedPaddingSizeBytes);

    // Modify packet by removing padding bit and writing zero at the last padding
    // byte to verify that we can parse packets from old clients, where zero
    // padding of up to three bytes was used without the padding bit being set.
    const modBuffer = packet.slice(0, kExpectedSizeWords * 4);
    modBuffer[kExpectedSizeWords * 4 - 1] = 0;
    const paddingFlag = 1 << 5;
    modBuffer[0] &= ~paddingFlag; // Unset padding flag.

    expect(isValidFeedback(modBuffer)).toBe(true);
  });

  test("TransportFeedbackCorrectlySplitsVectorChunks", () => {
    const kOneBitVectorCapacity = 14;
    const kLargeTimeDelta = kDeltaTick * (1 << 8);

    // Test that a number of small deltas followed by a large delta results in a
    // correct split into multiple chunks, as needed.

    for (let deltas = 0; deltas <= kOneBitVectorCapacity + 1; ++deltas) {
      const feedback = new TransportFeedback();
      feedback.setBase(0, 0);
      for (let i = 0; i < deltas; ++i) feedback.addReceivedPacket(i, ms(i));
      feedback.addReceivedPacket(deltas, ms(deltas) + kLargeTimeDelta);

      expect(isValidFeedback(feedback.build())).toBe(true);
    }
  });

  test("TransportFeedbackMoveConstructor", () => {
    const kSamples = 100;
    const kBaseSeqNo = 7531;
    const kBaseTimestamp = 123_456_789;
    const kFeedbackSeqNo = 90;

    const feedback = new TransportFeedback();
    feedback.setBase(kBaseSeqNo, kBaseTimestamp);
    feedback.setFeedbackSequenceNumber(kFeedbackSeqNo);
    for (let i = 0; i < kSamples; ++i) {
      feedback.addReceivedPacket(kBaseSeqNo + i, kBaseTimestamp + i * kDeltaTick);
    }
    expect(feedback.isConsistent()).toBe(true);

    const feedbackCopy = feedback.clone();
    expect(feedbackCopy.isConsistent()).toBe(true);
    expect(feedback.isConsistent()).toBe(true);
    expect(feedbackCopy.build()).toEqual(feedback.build());

    // Move: the source is left cleared (and consistent).
    const moved = feedback.clone();
    feedback["clear"]();
    expect(moved.isConsistent()).toBe(true);
    expect(feedback.isConsistent()).toBe(true);
    expect(moved.build()).toEqual(feedbackCopy.build());
  });
});

describe("TransportFeedbackTest", () => {
  const collect = (feedback: TransportFeedback) => {
    const calls: [number, number][] = [];
    feedback.forAllPackets((seq, delta) => calls.push([seq, delta]));
    return calls;
  };

  test("ReportsMissingPackets", () => {
    const kBaseSeqNo = 1000;
    const kBaseTimestamp = ms(10);
    const kFeedbackSeqNo = 90;
    const feedbackBuilder = new TransportFeedback(/*include_timestamps*/ true);
    feedbackBuilder.setBase(kBaseSeqNo, kBaseTimestamp);
    feedbackBuilder.setFeedbackSequenceNumber(kFeedbackSeqNo);
    feedbackBuilder.addReceivedPacket(kBaseSeqNo + 0, kBaseTimestamp);
    // Packet losses indicated by jump in sequence number.
    feedbackBuilder.addReceivedPacket(kBaseSeqNo + 3, kBaseTimestamp + ms(2));

    const calls = collect(parse(feedbackBuilder.build()));
    expect(calls.map(([seq]) => seq)).toEqual([kBaseSeqNo, kBaseSeqNo + 1, kBaseSeqNo + 2, kBaseSeqNo + 3]);
    expect(calls.map(([, delta]) => delta === Infinity)).toEqual([false, true, true, false]);
  });

  test("ReportsMissingPacketsWithoutTimestamps", () => {
    const kBaseSeqNo = 1000;
    const kFeedbackSeqNo = 90;
    const feedbackBuilder = new TransportFeedback(/*include_timestamps*/ false);
    feedbackBuilder.setBase(kBaseSeqNo, ms(10));
    feedbackBuilder.setFeedbackSequenceNumber(kFeedbackSeqNo);
    feedbackBuilder.addReceivedPacket(kBaseSeqNo + 0, 0);
    // Packet losses indicated by jump in sequence number.
    feedbackBuilder.addReceivedPacket(kBaseSeqNo + 3, 0);

    const calls = collect(parse(feedbackBuilder.build()));
    expect(calls.map(([seq]) => seq)).toEqual([kBaseSeqNo, kBaseSeqNo + 1, kBaseSeqNo + 2, kBaseSeqNo + 3]);
    expect(calls.map(([, delta]) => delta === Infinity)).toEqual([false, true, true, false]);
  });
});
