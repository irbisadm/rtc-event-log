// Port of modules/rtp_rtcp/source/rtcp_packet/common_header_unittest.cc @ M154.

import {CommonHeader} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/common-header.js";

const sub = (buffer: Uint8Array, size: number) => buffer.subarray(0, size);

describe("RtcpCommonHeaderTest", () => {
  test("TooSmallBuffer", () => {
    const buffer = Uint8Array.from([0x80, 0x00, 0x00, 0x00]);
    const header = new CommonHeader();
    // Buffer needs to be able to hold the header.
    expect(header.parse(sub(buffer, 0))).toBe(false);
    expect(header.parse(sub(buffer, 1))).toBe(false);
    expect(header.parse(sub(buffer, 2))).toBe(false);
    expect(header.parse(sub(buffer, 3))).toBe(false);
    expect(header.parse(sub(buffer, 4))).toBe(true);
  });

  test("Version", () => {
    const buffer = Uint8Array.from([0x00, 0x00, 0x00, 0x00]);
    const header = new CommonHeader();
    // Version 2 is the only allowed.
    buffer[0] = 0 << 6;
    expect(header.parse(buffer)).toBe(false);
    buffer[0] = 1 << 6;
    expect(header.parse(buffer)).toBe(false);
    buffer[0] = 2 << 6;
    expect(header.parse(buffer)).toBe(true);
    buffer[0] = 3 << 6;
    expect(header.parse(buffer)).toBe(false);
  });

  test("PacketSize", () => {
    const buffer = Uint8Array.from([0x80, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const header = new CommonHeader();
    expect(header.parse(sub(buffer, buffer.length - 1))).toBe(false);
    expect(header.parse(buffer)).toBe(true);
    expect(header.payloadSizeBytes()).toBe(8);
    expect(header.nextPacketOffset()).toBe(buffer.length);
    expect(header.packetSize()).toBe(buffer.length);
  });

  test("PaddingAndPayloadSize", () => {
    // Set v = 2, p = 1, but leave fmt, pt as 0.
    const buffer = Uint8Array.from([0xa0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const header = new CommonHeader();
    // Padding bit set, but no byte for padding (can't specify padding length).
    expect(header.parse(sub(buffer, 4))).toBe(false);

    buffer[3] = 2; //  Set payload size to 2x32bit.
    const kPayloadSizeBytes = buffer[3] * 4;
    const kPaddingAddress = CommonHeader.kHeaderSizeBytes + kPayloadSizeBytes - 1;

    // Padding one byte larger than possible.
    buffer[kPaddingAddress] = kPayloadSizeBytes + 1;
    expect(header.parse(buffer)).toBe(false);

    // Invalid zero padding size.
    buffer[kPaddingAddress] = 0;
    expect(header.parse(buffer)).toBe(false);

    // Pure padding packet.
    buffer[kPaddingAddress] = kPayloadSizeBytes;
    expect(header.parse(buffer)).toBe(true);
    expect(header.payloadSizeBytes()).toBe(0);
    expect(header.nextPacketOffset()).toBe(buffer.length);
    expect(header.payload().byteOffset).toBe(buffer.byteOffset + CommonHeader.kHeaderSizeBytes);
    expect(header.packetSize()).toBe(buffer.length);

    // Single byte of actual data.
    buffer[kPaddingAddress] = kPayloadSizeBytes - 1;
    expect(header.parse(buffer)).toBe(true);
    expect(header.payloadSizeBytes()).toBe(1);
    expect(header.nextPacketOffset()).toBe(buffer.length);
    expect(header.packetSize()).toBe(buffer.length);
  });

  test("FormatAndPayloadType", () => {
    const buffer = Uint8Array.from([0x9e, 0xab, 0x00, 0x00]);
    const header = new CommonHeader();
    expect(header.parse(buffer)).toBe(true);

    expect(header.count()).toBe(0x1e);
    expect(header.fmt()).toBe(0x1e);
    expect(header.type()).toBe(0xab);
    expect(header.payloadSizeBytes()).toBe(0);
    expect(header.payload().byteOffset).toBe(buffer.byteOffset + CommonHeader.kHeaderSizeBytes);
  });
});
