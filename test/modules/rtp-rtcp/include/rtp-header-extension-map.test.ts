// Port of modules/rtp_rtcp/source/rtp_header_extension_map_unittest.cc @ M154.
// Extension types are identified by URI; RegisterByType and
// Register<Extension> are RegisterByUri with the extension's URI.

import {RtpExtension} from "../../../../src/api/rtp-parameters.js";
import {RtpHeaderExtensionMap} from "../../../../src/modules/rtp-rtcp/include/rtp-header-extension-map.js";

const kTransmissionOffset = RtpExtension.kTimestampOffsetUri;
const kAbsoluteSendTime = RtpExtension.kAbsSendTimeUri;
const kAudioLevel = RtpExtension.kAudioLevelUri;
const kInvalidId = 0;

describe("RtpHeaderExtensionTest", () => {
  test("RegisterByType", () => {
    const map = new RtpHeaderExtensionMap();
    expect(map.isRegistered(kTransmissionOffset)).toBe(false);
    expect(map.registerByUri(3, kTransmissionOffset)).toBe(true);
    expect(map.isRegistered(kTransmissionOffset)).toBe(true);
    expect(map.getId(kTransmissionOffset)).toBe(3);
    expect(map.getType(3)).toBe(kTransmissionOffset);
  });

  test("RegisterByUri", () => {
    const map = new RtpHeaderExtensionMap();
    expect(map.registerByUri(3, kTransmissionOffset)).toBe(true);
    expect(map.isRegistered(kTransmissionOffset)).toBe(true);
    expect(map.getId(kTransmissionOffset)).toBe(3);
    expect(map.getType(3)).toBe(kTransmissionOffset);
  });

  test("RegisterDuringContruction", () => {
    const map = new RtpHeaderExtensionMap([new RtpExtension(kTransmissionOffset, 1), new RtpExtension(kAbsoluteSendTime, 3)]);
    expect(map.getId(kTransmissionOffset)).toBe(1);
    expect(map.getId(kAbsoluteSendTime)).toBe(3);
  });

  test("RegisterTwoByteHeaderExtensions", () => {
    const map = new RtpHeaderExtensionMap();
    // Two-byte header extension needed for id: [15-255].
    expect(map.registerByUri(18, kTransmissionOffset)).toBe(true);
    expect(map.registerByUri(255, kAbsoluteSendTime)).toBe(true);
  });

  test("RegisterIllegalArg", () => {
    const map = new RtpHeaderExtensionMap();
    // Valid range for id: [1-255].
    expect(map.registerByUri(kInvalidId, kTransmissionOffset)).toBe(false);
  });

  test("Idempotent", () => {
    const map = new RtpHeaderExtensionMap();
    expect(map.registerByUri(3, kTransmissionOffset)).toBe(true);
    expect(map.registerByUri(3, kTransmissionOffset)).toBe(true);
    map.deregister(kTransmissionOffset);
    map.deregister(kTransmissionOffset);
  });

  test("NonUniqueId", () => {
    const map = new RtpHeaderExtensionMap();
    expect(map.registerByUri(3, kTransmissionOffset)).toBe(true);
    expect(map.registerByUri(3, kAudioLevel)).toBe(false);
    expect(map.registerByUri(4, kAudioLevel)).toBe(true);
  });

  test("GetType", () => {
    const map = new RtpHeaderExtensionMap();
    expect(map.getType(3)).toBeUndefined(); // kInvalidType
    expect(map.registerByUri(3, kTransmissionOffset)).toBe(true);
    expect(map.getType(3)).toBe(kTransmissionOffset);
  });

  test("GetId", () => {
    const map = new RtpHeaderExtensionMap();
    expect(map.getId(kTransmissionOffset)).toBe(kInvalidId);
    expect(map.registerByUri(3, kTransmissionOffset)).toBe(true);
    expect(map.getId(kTransmissionOffset)).toBe(3);
  });

  test("RemapFails", () => {
    const map = new RtpHeaderExtensionMap();
    expect(map.registerByUri(3, kTransmissionOffset)).toBe(true);
    expect(map.registerByUri(4, kTransmissionOffset)).toBe(false);
  });

  // Not upstream: unknown URIs are not registered (RegisterByUri returns
  // false), and ids are uint8_t (RtpHeaderExtensionId's static_cast).
  test("UnknownUriAndIdTruncation", () => {
    const map = new RtpHeaderExtensionMap();
    expect(map.registerByUri(3, "urn:example:unknown")).toBe(false);
    expect(map.registerByUri(256 + 7, kAudioLevel)).toBe(true);
    expect(map.getId(kAudioLevel)).toBe(7);
    expect(map.registerByUri(256, kAbsoluteSendTime)).toBe(false);
  });
});
