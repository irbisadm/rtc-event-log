// Port of the parsing tests of modules/rtp_rtcp/source/rtp_packet_unittest.cc
// @ M154, for the extensions RtpPacketReceived.getHeader() reads (observed
// through the RTPHeader instead of GetExtension<>).

import {RtpExtension} from "../../../../src/api/rtp-parameters.js";
import {RtpHeaderExtensionMap} from "../../../../src/modules/rtp-rtcp/include/rtp-header-extension-map.js";
import {RtpPacketReceived} from "../../../../src/modules/rtp-rtcp/source/rtp-packet-received.js";

const kPayloadType = 100;
const kSsrc = 0x12345678;
const kSeqNum = 0x1234;
const kSeqNumFirstByte = kSeqNum >> 8;
const kSeqNumSecondByte = kSeqNum & 0xff;
const kTimestamp = 0x65431278;
const kTransmissionOffsetExtensionId = 1;
const kAudioLevelExtensionId = 9;
const kTwoByteExtensionId = 0xf0;
const kTimeOffset = 0x56ce;
const kVoiceActive = true;
const kAudioLevel = 0x5a;
const kCsrcs = [0x34567890, 0x32435465];
const c = (s: string) => [...s].map((ch) => ch.charCodeAt(0));
const kPayload = c("payload");
const kPacketPaddingSize = 8;

// prettier-ignore
const kMinimumPacket = Uint8Array.from([
  0x80, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
  0x65, 0x43, 0x12, 0x78,
  0x12, 0x34, 0x56, 0x78]);
// prettier-ignore
const kPacketWithTO = Uint8Array.from([
  0x90, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
  0x65, 0x43, 0x12, 0x78,
  0x12, 0x34, 0x56, 0x78,
  0xbe, 0xde, 0x00, 0x01,
  0x12, 0x00, 0x56, 0xce]);
// prettier-ignore
const kPacketWithTOAndAL = Uint8Array.from([
  0x90, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
  0x65, 0x43, 0x12, 0x78,
  0x12, 0x34, 0x56, 0x78,
  0xbe, 0xde, 0x00, 0x02,
  0x12, 0x00, 0x56, 0xce,
  0x90, 0x80 | kAudioLevel, 0x00, 0x00]);
// prettier-ignore
const kPacketWithTOAndALInvalidPadding = Uint8Array.from([
  0x90, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
  0x65, 0x43, 0x12, 0x78,
  0x12, 0x34, 0x56, 0x78,
  0xbe, 0xde, 0x00, 0x03,
  0x12, 0x00, 0x56, 0xce,
  0x00, 0x02, 0x00, 0x00, // 0x02 is invalid padding, parsing should stop.
  0x90, 0x80 | kAudioLevel, 0x00, 0x00]);
// prettier-ignore
const kPacketWithTOAndALReservedExtensionId = Uint8Array.from([
  0x90, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
  0x65, 0x43, 0x12, 0x78,
  0x12, 0x34, 0x56, 0x78,
  0xbe, 0xde, 0x00, 0x03,
  0x12, 0x00, 0x56, 0xce,
  0x00, 0xf0, 0x00, 0x00, // F is a reserved id, parsing should stop.
  0x90, 0x80 | kAudioLevel, 0x00, 0x00]);
// prettier-ignore
const kPacket = Uint8Array.from([
  0xb2, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
  0x65, 0x43, 0x12, 0x78,
  0x12, 0x34, 0x56, 0x78,
  0x34, 0x56, 0x78, 0x90,
  0x32, 0x43, 0x54, 0x65,
  0xbe, 0xde, 0x00, 0x01,
  0x12, 0x00, 0x56, 0xce,
  ...c("payload"),
  ...c("padding"), kPacketPaddingSize]);
// prettier-ignore
const kPacketWithTwoByteHeaderExtension = Uint8Array.from([
  0x90, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
  0x65, 0x43, 0x12, 0x78,
  0x12, 0x34, 0x56, 0x78,
  0x10, 0x00, 0x00, 0x02, // Two-byte header extension profile id + length.
  kTwoByteExtensionId, 0x03, 0x00, 0x56,
  0xce, 0x00, 0x00, 0x00]);
// prettier-ignore
const kPacketWithTwoByteHeaderExtensionWithPadding = Uint8Array.from([
  0x90, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
  0x65, 0x43, 0x12, 0x78,
  0x12, 0x34, 0x56, 0x78,
  0x10, 0x00, 0x00, 0x03, // Two-byte header extension profile id + length.
  kTwoByteExtensionId, 0x03, 0x00, 0x56,
  0xce, 0x00, 0x00, 0x00, // Three padding bytes.
  kAudioLevelExtensionId, 0x01, 0x80 | kAudioLevel, 0x00]);
// prettier-ignore
const kPacketWithInvalidExtension = Uint8Array.from([
  0x90, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
  0x65, 0x43, 0x12, 0x78, // kTimestamp.
  0x12, 0x34, 0x56, 0x78, // kSSrc.
  0xbe, 0xde, 0x00, 0x02, // Extension block of size 2 x 32bit words.
  (kTransmissionOffsetExtensionId << 4) | 6, // (6+1)-byte extension, but
  ...c("ext"), // TransmissionOffset expected to be 3-bytes.
  ...c("data"),
  ...c("payload")]);

const map = (...entries: [number, string][]) => {
  const m = new RtpHeaderExtensionMap();
  for (const [id, uri] of entries) expect(m.registerByUri(id, uri)).toBe(true);
  return m;
};
const TO = RtpExtension.kTimestampOffsetUri;
const AL = RtpExtension.kAudioLevelUri;

function parse(bytes: Uint8Array, extensions: RtpHeaderExtensionMap | null = null): RtpPacketReceived {
  const packet = new RtpPacketReceived();
  if (extensions !== null) packet.identifyExtensions(extensions);
  expect(packet.parse(bytes)).toBe(true);
  return packet;
}

describe("RtpPacketTest", () => {
  test("ParseMinimum", () => {
    const packet = parse(kMinimumPacket);
    expect(packet.payloadType()).toBe(kPayloadType);
    expect(packet.sequenceNumber()).toBe(kSeqNum);
    expect(packet.timestamp()).toBe(kTimestamp);
    expect(packet.ssrc()).toBe(kSsrc);
    expect(packet.paddingSize()).toBe(0);
    expect(packet.payloadSizeBytes()).toBe(0);
  });

  test("ParseWithExtension", () => {
    const packet = parse(kPacketWithTO, map([kTransmissionOffsetExtensionId, TO]));
    expect(packet.payloadType()).toBe(kPayloadType);
    expect(packet.sequenceNumber()).toBe(kSeqNum);
    expect(packet.timestamp()).toBe(kTimestamp);
    expect(packet.ssrc()).toBe(kSsrc);
    const header = packet.getHeader();
    expect(header.extension.hasTransmissionTimeOffset).toBe(true);
    expect(header.extension.transmissionTimeOffset).toBe(kTimeOffset);
    expect(packet.payloadSizeBytes()).toBe(0);
    expect(packet.paddingSize()).toBe(0);
  });

  test("ParseHeaderOnly", () => {
    const packet = parse(Uint8Array.from([0x80, 0x62, 0x35, 0x79, 0x65, 0x43, 0x12, 0x78, 0x12, 0x34, 0x56, 0x78]));
    expect(packet.payloadType()).toBe(0x62);
    expect(packet.sequenceNumber()).toBe(0x3579);
    expect(packet.timestamp()).toBe(0x65431278);
    expect(packet.ssrc()).toBe(0x12345678);
    expect(packet.hasPadding()).toBe(false);
    expect(packet.paddingSize()).toBe(0);
    expect(packet.payloadSizeBytes()).toBe(0);
  });

  test("ParseHeaderOnlyWithPadding", () => {
    const packet = parse(Uint8Array.from([0xa0, 0x62, 0x35, 0x79, 0x65, 0x43, 0x12, 0x78, 0x12, 0x34, 0x56, 0x78]));
    expect(packet.hasPadding()).toBe(true);
    expect(packet.paddingSize()).toBe(0);
    expect(packet.payloadSizeBytes()).toBe(0);
  });

  test("ParseHeaderOnlyWithExtensionAndPadding", () => {
    const packet = parse(
      Uint8Array.from([0xb0, 0x62, 0x35, 0x79, 0x65, 0x43, 0x12, 0x78, 0x12, 0x34, 0x56, 0x78, 0xbe, 0xde, 0x00, 0x01, 0x11, 0x00, 0x00, 0x00]),
      map([1, TO]),
    );
    expect(packet.hasPadding()).toBe(true);
    // HasExtension<TransmissionOffset>() (2 bytes: present, but not a valid
    // 3-byte value).
    expect(packet.getHeader().extension.hasTransmissionTimeOffset).toBe(false);
    expect(packet.paddingSize()).toBe(0);
  });

  test("ParsePaddingOnlyPacket", () => {
    const packet = parse(Uint8Array.from([0xa0, 0x62, 0x35, 0x79, 0x65, 0x43, 0x12, 0x78, 0x12, 0x34, 0x56, 0x78, 0, 0, 3]));
    expect(packet.hasPadding()).toBe(true);
    expect(packet.paddingSize()).toBe(3);
  });

  test("ParseWithInvalidSizedExtension", () => {
    const packet = parse(kPacketWithInvalidExtension, map([kTransmissionOffsetExtensionId, TO]));
    expect(packet.getHeader().extension.hasTransmissionTimeOffset).toBe(false);
    expect([...packet.payload()]).toEqual(kPayload);
  });

  test("ParseWithOverSizedExtension", () => {
    // prettier-ignore
    const badPacket = Uint8Array.from([
      0x90, kPayloadType, kSeqNumFirstByte, kSeqNumSecondByte,
      0x65, 0x43, 0x12, 0x78, // kTimestamp.
      0x12, 0x34, 0x56, 0x78, // kSsrc.
      0xbe, 0xde, 0x00, 0x01, // Extension of size 1x32bit word.
      0x00, // Add a byte of padding.
      0x12, // Extension id 1 size (2+1).
      0xda, 0x1a, // Only 2 bytes of extension payload.
    ]);
    const packet = parse(badPacket, map([1, TO]));
    expect(packet.getHeader().extension.hasTransmissionTimeOffset).toBe(false);
  });

  test("ParseWith2Extensions", () => {
    const packet = parse(kPacketWithTOAndAL, map([kTransmissionOffsetExtensionId, TO], [kAudioLevelExtensionId, AL]));
    const header = packet.getHeader();
    expect(header.extension.transmissionTimeOffset).toBe(kTimeOffset);
    expect(header.extension.audioLevel()?.voiceActivity()).toBe(kVoiceActive);
    expect(header.extension.audioLevel()?.level()).toBe(kAudioLevel);
  });

  test("ParseSecondPacketWithFewerExtensions", () => {
    const packet = new RtpPacketReceived();
    packet.identifyExtensions(map([kTransmissionOffsetExtensionId, TO], [kAudioLevelExtensionId, AL]));
    expect(packet.parse(kPacketWithTOAndAL)).toBe(true);
    expect(packet.getHeader().extension.hasTransmissionTimeOffset).toBe(true);
    expect(packet.getHeader().extension.audioLevel()).toBeDefined();
    expect(packet.parse(kPacketWithTO)).toBe(true);
    expect(packet.getHeader().extension.hasTransmissionTimeOffset).toBe(true);
    expect(packet.getHeader().extension.audioLevel()).toBeUndefined();
  });

  test("ParseWith2ExtensionsInvalidPadding", () => {
    const packet = parse(kPacketWithTOAndALInvalidPadding, map([kTransmissionOffsetExtensionId, TO], [kAudioLevelExtensionId, AL]));
    expect(packet.getHeader().extension.transmissionTimeOffset).toBe(kTimeOffset);
    expect(packet.getHeader().extension.audioLevel()).toBeUndefined();
  });

  test("ParseWith2ExtensionsReservedExtensionId", () => {
    const packet = parse(kPacketWithTOAndALReservedExtensionId, map([kTransmissionOffsetExtensionId, TO], [kAudioLevelExtensionId, AL]));
    expect(packet.getHeader().extension.transmissionTimeOffset).toBe(kTimeOffset);
    expect(packet.getHeader().extension.audioLevel()).toBeUndefined();
  });

  test("ParseWithAllFeatures", () => {
    const packet = parse(kPacket, map([kTransmissionOffsetExtensionId, TO]));
    expect(packet.payloadType()).toBe(kPayloadType);
    expect(packet.sequenceNumber()).toBe(kSeqNum);
    expect(packet.timestamp()).toBe(kTimestamp);
    expect(packet.ssrc()).toBe(kSsrc);
    expect(packet.csrcs()).toEqual(kCsrcs);
    expect([...packet.payload()]).toEqual(kPayload);
    expect(packet.paddingSize()).toBe(kPacketPaddingSize);
    expect(packet.getHeader().extension.hasTransmissionTimeOffset).toBe(true);
  });

  test("ParseTwoByteHeaderExtension", () => {
    const packet = parse(kPacketWithTwoByteHeaderExtension, map([kTwoByteExtensionId, TO]));
    expect(packet.getHeader().extension.transmissionTimeOffset).toBe(kTimeOffset);
  });

  test("ParseTwoByteHeaderExtensionWithPadding", () => {
    const packet = parse(kPacketWithTwoByteHeaderExtensionWithPadding, map([kTwoByteExtensionId, TO], [kAudioLevelExtensionId, AL]));
    const header = packet.getHeader();
    expect(header.extension.transmissionTimeOffset).toBe(kTimeOffset);
    expect(header.extension.audioLevel()?.voiceActivity()).toBe(kVoiceActive);
    expect(header.extension.audioLevel()?.level()).toBe(kAudioLevel);
  });

  test("ParseWithExtensionDelayed", () => {
    const packet = parse(kPacketWithTO);
    expect(packet.payloadType()).toBe(kPayloadType);
    expect(packet.sequenceNumber()).toBe(kSeqNum);
    expect(packet.timestamp()).toBe(kTimestamp);
    expect(packet.ssrc()).toBe(kSsrc);
    expect(packet.getHeader().extension.hasTransmissionTimeOffset).toBe(false);
    packet.identifyExtensions(map([kTransmissionOffsetExtensionId, TO]));
    expect(packet.getHeader().extension.transmissionTimeOffset).toBe(kTimeOffset);
    expect(packet.payloadSizeBytes()).toBe(0);
    expect(packet.paddingSize()).toBe(0);
  });
});
