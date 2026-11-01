// Parser tests for the ported part of the new format (RTP/RTCP packets,
// begin/end log). Logs are built by new-format-builder.ts; byte-level
// agreement with the C++ parser on C++-written logs is checked separately.

import {VideoRotation} from "../../../src/api/video/video-rotation.js";
import {
  PacketDirection,
  ParsedRtcEventLog,
  UnconfiguredHeaderExtensions,
} from "../../../src/logging/rtc-event-log/rtc-event-log-parser.js";
import {
  beginLog,
  concatBytes,
  endLog,
  eventStreamBytes,
  incomingRtcpBatch,
  incomingRtpBatch,
  outgoingRtcpBatch,
  outgoingRtpBatch,
  type RtpPacketSpec,
} from "./new-format-builder.js";

const bytes = (...values: number[]) => Uint8Array.from(values);

function parse(log: Uint8Array, allowIncomplete = false): ParsedRtcEventLog {
  const parsed = new ParsedRtcEventLog(UnconfiguredHeaderExtensions.kDontParse, allowIncomplete);
  const status = parsed.parseString(log);
  if (!status.ok()) throw new Error(status.message());
  return parsed;
}

const videoPacket = (i: number, overrides: Partial<RtpPacketSpec> = {}): RtpPacketSpec => ({
  timestampMs: 1000 + 5 * i,
  marker: i % 3 === 2,
  payloadType: 96,
  sequenceNumber: (65534 + i) & 0xffff, // wraps around
  rtpTimestamp: (0xfffffff0 + 3000 * Math.floor(i / 3)) >>> 0,
  ssrc: 0x12345678,
  payloadSize: 1100 + i,
  headerSize: 24,
  paddingSize: i === 4 ? 200 : 0,
  transportSequenceNumber: (65530 + i) & 0xffff,
  absoluteSendTime: (0xfffff0 + 64 * i) & 0xffffff,
  transmissionTimeOffset: i - 2, // negative values too
  videoRotationCvo: i % 4,
  ...overrides,
});

describe("ParsedRtcEventLog (new format)", () => {
  test("EmptyLog", () => {
    // Upstream fails to "peek" the first tag of an empty log.
    expect(new ParsedRtcEventLog().parseString(new Uint8Array(0)).message()).toBe("Failed to read field tag varint");

    const parsed = parse(new Uint8Array(0), /*allowIncomplete=*/ true);
    expect(parsed.incomingRtpPacketsBySsrc()).toHaveLength(0);
    expect(parsed.firstTimestamp()).toBe(0);
    expect(parsed.lastTimestamp()).toBe(0);
  });

  test("OutgoingRtpBatchWithExtensions", () => {
    const packets = Array.from({length: 6}, (_, i) => videoPacket(i));
    const parsed = parse(concatBytes(beginLog(990, 1_700_000_000_000), outgoingRtpBatch(packets), endLog(1100)));

    expect(parsed.incomingRtpPacketsBySsrc()).toHaveLength(0);
    const streams = parsed.outgoingRtpPacketsBySsrc();
    expect(streams).toHaveLength(1);
    expect(streams[0].ssrc).toBe(0x12345678);
    const logged = streams[0].outgoingPackets;
    expect(logged).toHaveLength(packets.length);
    logged.forEach((packet, i) => {
      const spec = packets[i];
      const header = packet.rtp.header;
      expect(packet.logTimeMs()).toBe(spec.timestampMs);
      expect(packet.logTimeUs()).toBe(spec.timestampMs * 1000);
      expect(header.markerBit).toBe(spec.marker);
      expect(header.payloadType).toBe(spec.payloadType);
      expect(header.sequenceNumber).toBe(spec.sequenceNumber);
      expect(header.timestamp).toBe(spec.rtpTimestamp);
      expect(header.ssrc).toBe(spec.ssrc);
      expect(header.headerLength).toBe(spec.headerSize);
      expect(header.paddingLength).toBe(spec.paddingSize);
      expect(packet.rtp.headerLength).toBe(spec.headerSize);
      expect(packet.rtp.totalLength).toBe(spec.payloadSize + spec.headerSize + (spec.paddingSize ?? 0));
      expect(header.extension.hasTransportSequenceNumber).toBe(true);
      expect(header.extension.transportSequenceNumber).toBe(spec.transportSequenceNumber);
      expect(header.extension.hasAbsoluteSendTime).toBe(true);
      expect(header.extension.absoluteSendTime).toBe(spec.absoluteSendTime);
      expect(header.extension.hasTransmissionTimeOffset).toBe(true);
      expect(header.extension.transmissionTimeOffset).toBe(spec.transmissionTimeOffset);
      expect(header.extension.hasVideoRotation).toBe(true);
      expect(header.extension.videoRotation).toBe(
        [VideoRotation.kVideoRotation_0, VideoRotation.kVideoRotation_90, VideoRotation.kVideoRotation_180, VideoRotation.kVideoRotation_270][
          spec.videoRotationCvo!
        ],
      );
      expect(header.extension.audioLevel()).toBeUndefined();
      expect(packet.rtp.rtxOriginalSequenceNumber).toBeUndefined();
      expect(packet.rtp.dependencyDescriptorWireFormat).toHaveLength(0);
    });

    const view = parsed.rtpPacketsBySsrc(PacketDirection.kOutgoingPacket);
    expect(view).toHaveLength(1);
    expect(view[0].packetView[2]).toBe(logged[2].rtp);

    expect(parsed.startLogEvents()).toHaveLength(1);
    expect(parsed.startLogEvents()[0].utcTime()).toBe(1_700_000_000_000_000);
    expect(parsed.stopLogEvents()[0].logTimeMs()).toBe(1100);
    expect(parsed.firstTimestamp()).toBe(1000 * 1000);
    expect(parsed.lastTimestamp()).toBe(1025 * 1000);
    expect(parsed.firstLogSegment().startTimeMs()).toBe(990);
    expect(parsed.firstLogSegment().stopTimeMs()).toBe(1100);
  });

  test("IncomingRtpBatchGroupsBySsrcAndKeepsOptionalExtensions", () => {
    const audio = (i: number): RtpPacketSpec => ({
      timestampMs: 2000 + 20 * i,
      payloadType: 111,
      sequenceNumber: 10 + i,
      rtpTimestamp: 960 * i,
      ssrc: 0xaaaa,
      payloadSize: 60,
      headerSize: 20,
      audioLevel: {voiceActivity: i % 2 === 0, level: 127 - i},
      ...(i % 2 === 0 ? {transportSequenceNumber: 100 + i} : {}),
    });
    const rtx: RtpPacketSpec = {
      timestampMs: 2030,
      payloadType: 97,
      sequenceNumber: 7,
      rtpTimestamp: 1,
      ssrc: 0x1111,
      payloadSize: 500,
      headerSize: 22,
      rtxOriginalSequenceNumber: 65535,
      dependencyDescriptor: bytes(0xc1, 0x00, 0x05, 0xaa),
    };
    // SSRCs interleaved in one batch, as the encoder logs them.
    const batch = [audio(0), audio(1), rtx, audio(2), audio(3)];
    const parsed = parse(incomingRtpBatch(batch));

    const streams = parsed.incomingRtpPacketsBySsrc();
    expect(streams.map((s) => s.ssrc)).toEqual([0x1111, 0xaaaa]); // ascending, like std::map
    const audioPackets = streams[1].incomingPackets;
    expect(audioPackets.map((p) => p.rtp.header.sequenceNumber)).toEqual([10, 11, 12, 13]);
    audioPackets.forEach((packet, i) => {
      const level = packet.rtp.header.extension.audioLevel();
      expect(level?.level()).toBe(127 - i);
      expect(level?.voiceActivity()).toBe(i % 2 === 0);
      expect(packet.rtp.header.extension.hasTransportSequenceNumber).toBe(i % 2 === 0);
      if (i % 2 === 0) expect(packet.rtp.header.extension.transportSequenceNumber).toBe(100 + i);
      expect(packet.rtp.header.extension.hasAbsoluteSendTime).toBe(false);
    });

    const rtxPacket = streams[0].incomingPackets[0];
    expect(rtxPacket.rtp.rtxOriginalSequenceNumber).toBe(65535);
    expect(rtxPacket.rtp.dependencyDescriptorWireFormat).toEqual(bytes(0xc1, 0x00, 0x05, 0xaa));
    expect(audioPackets[0].rtp.dependencyDescriptorWireFormat).toHaveLength(0);
    expect(audioPackets[0].rtp.rtxOriginalSequenceNumber).toBeUndefined();
  });

  test("SingleRtpPacketBatch", () => {
    const parsed = parse(incomingRtpBatch([videoPacket(0, {timestampMs: 77})]));
    const packets = parsed.incomingRtpPacketsBySsrc()[0].incomingPackets;
    expect(packets).toHaveLength(1);
    expect(packets[0].logTimeMs()).toBe(77);
    expect(parsed.firstLogSegment().startTimeMs()).toBe(77);
    expect(parsed.firstLogSegment().stopTimeMs()).toBe(77);
  });

  test("RtcpBatchesRemoveIncomingDuplicatesOnly", () => {
    const a = bytes(0x80, 0xc9, 0x00, 0x01, 0, 0, 0, 1);
    const b = bytes(0x80, 0xc8, 0x00, 0x01, 0, 0, 0, 2);
    const batch = [
      {timestampMs: 10, packet: a},
      {timestampMs: 11, packet: a}, // duplicate, dropped for incoming
      {timestampMs: 12, packet: b},
      {timestampMs: 13, packet: a},
    ];
    const parsed = parse(concatBytes(incomingRtcpBatch(batch), incomingRtcpBatch([{timestampMs: 14, packet: a}]), outgoingRtcpBatch(batch)));

    expect(parsed.incomingRtcpPackets().map((p) => p.logTimeMs())).toEqual([10, 12, 13]);
    expect(parsed.incomingRtcpPackets()[1].rtcp.rawData).toEqual(b);
    expect(parsed.outgoingRtcpPackets().map((p) => p.logTimeMs())).toEqual([10, 11, 12, 13]);
    expect(parsed.firstTimestamp()).toBe(10_000);
    expect(parsed.lastTimestamp()).toBe(13_000);
  });

  test("MixedEventTypes", () => {
    const log = concatBytes(
      eventStreamBytes({dtlsWritableStates: [{timestampMs: 5n, writable: true}]}),
      incomingRtcpBatch([{timestampMs: 6, packet: bytes(1, 2, 3, 4)}]),
    );
    expect(parse(log).incomingRtcpPackets()).toHaveLength(1);
  });
});

describe("ParsedRtcEventLog errors", () => {
  const rtcp = incomingRtcpBatch([{timestampMs: 6, packet: bytes(1, 2, 3, 4)}]);

  test("TruncatedLog", () => {
    const log = concatBytes(rtcp, rtcp.subarray(0, rtcp.length - 1));
    const strict = new ParsedRtcEventLog();
    expect(strict.parseString(log).ok()).toBe(false);

    const lenient = parse(log, /*allowIncomplete=*/ true);
    expect(lenient.incomingRtcpPackets()).toHaveLength(1);
  });

  test("WrongWireType", () => {
    const parsed = new ParsedRtcEventLog();
    expect(parsed.parseString(bytes((5 << 3) | 0, 1)).ok()).toBe(false);
  });

  test("LegacyFormatNotSupportedYet", () => {
    const parsed = new ParsedRtcEventLog();
    const status = parsed.parseString(bytes((1 << 3) | 2, 0));
    expect(status.ok()).toBe(false);
    expect(status.message()).toMatch(/legacy/);
  });

  test("MissingRequiredRtpField", () => {
    const log = eventStreamBytes({outgoingRtpPackets: [{timestampMs: 1n, marker: false, payloadType: 1}]});
    const status = new ParsedRtcEventLog().parseString(log);
    expect(status.ok()).toBe(false);
    expect(status.message()).toBe("proto.has_sequenceNumber()");
  });

  test("CorruptDeltas", () => {
    const log = eventStreamBytes({
      incomingRtcpPackets: [
        {timestampMs: 1n, rawPacket: bytes(1), numberOfDeltas: 2, timestampMsDeltas: bytes(0xff), rawPacketBlobs: bytes(1, 1, 7, 8)},
      ],
    });
    expect(new ParsedRtcEventLog().parseString(log).ok()).toBe(false);
  });

  test("UnsupportedBeginLogVersion", () => {
    const log = eventStreamBytes({beginLogEvents: [{timestampMs: 1n, version: 3, utcTimeMs: 1n}]});
    expect(new ParsedRtcEventLog().parseString(log).message()).toBe("proto.version()==2");
  });
});
