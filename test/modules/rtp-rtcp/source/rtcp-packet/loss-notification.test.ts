// Port of modules/rtp_rtcp/source/rtcp_packet/loss_notification_unittest.cc @ M154.

import {LossNotification} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/loss-notification.js";
import {parseSinglePacket} from "../../../../rtcp-packet-parser.js";

const c = (ch: string) => ch.charCodeAt(0);
const packetBytes = () =>
  Uint8Array.from([
    0x8f, 206, 0x00, 0x04, 0x12, 0x34, 0x56, 0x78, //
    0xab, 0xcd, 0xef, 0x01, c("L"), c("N"), c("T"), c("F"), //
    0x3c, 0x7b, 0x65, 0x43,
  ]);

describe("RtcpPacketLossNotificationTest", () => {
  test("SetWithIllegalValuesFails", () => {
    const kLastDecoded = 0x3c7b;
    const kLastReceived = (kLastDecoded + 0x7fff + 1) & 0xffff;
    const kDecodabilityFlag = true;
    const lossNotification = new LossNotification();
    expect(lossNotification.set(kLastDecoded, kLastReceived, kDecodabilityFlag)).toBe(false);
  });

  test("SetWithLegalValuesSucceeds", () => {
    const kLastDecoded = 0x3c7b;
    const kLastReceived = (kLastDecoded + 0x7fff) & 0xffff;
    const kDecodabilityFlag = true;
    const lossNotification = new LossNotification();
    expect(lossNotification.set(kLastDecoded, kLastReceived, kDecodabilityFlag)).toBe(true);
  });

  test("CreateProducesExpectedWireFormat", () => {
    // Note that (0x6542 >> 1) is used just to make the pattern in kPacket
    // more apparent; there's nothing truly special about the value,
    // it's only an implementation detail that last-received is represented
    // as a delta from last-decoded, and that this delta is shifted before
    // it's put on the wire.
    const kLastDecoded = 0x3c7b;
    const kLastReceived = kLastDecoded + (0x6542 >> 1);
    const kDecodabilityFlag = true;

    const lossNotification = new LossNotification();
    lossNotification.setSenderSsrc(0x12345678);
    lossNotification.setMediaSsrc(0xabcdef01);
    expect(lossNotification.set(kLastDecoded, kLastReceived, kDecodabilityFlag)).toBe(true);

    expect(lossNotification.build()).toEqual(packetBytes());
  });

  test("ParseFailsOnTooSmallPacketToBeLossNotification", () => {
    const packet = packetBytes();
    let packetLengthBytes = packet.length;

    const lossNotification = new LossNotification();
    expect(parseSinglePacket(packet.subarray(0, packetLengthBytes), lossNotification)).toBe(true);

    // Show that after shaving off a word, the packet is no longer parsable.
    packet[3] -= 1; // Change the `length` field of the RTCP packet.
    packetLengthBytes -= 4; // Effectively forget the last 32-bit word.
    expect(parseSinglePacket(packet.subarray(0, packetLengthBytes), lossNotification)).toBe(false);
  });

  test("ParseFailsWhenUniqueIdentifierIsNotLossNotification", () => {
    const packet = packetBytes();

    const lossNotification = new LossNotification();
    expect(parseSinglePacket(packet, lossNotification)).toBe(true);

    // Show that after changing the identifier, the packet is no longer parsable.
    packet[14] = c("x");
    expect(parseSinglePacket(packet, lossNotification)).toBe(false);
  });

  test("ParseLegalLossNotificationMessagesCorrectly", () => {
    const kLastDecoded = 0x3c7b;
    const kLastReceived = kLastDecoded + (0x6542 >> 1);
    const kDecodabilityFlag = true;

    const lossNotification = new LossNotification();
    expect(parseSinglePacket(packetBytes(), lossNotification)).toBe(true);

    expect(lossNotification.senderSsrc()).toBe(0x12345678);
    expect(lossNotification.mediaSsrc()).toBe(0xabcdef01);
    expect(lossNotification.lastDecoded()).toBe(kLastDecoded);
    expect(lossNotification.lastReceived()).toBe(kLastReceived);
    expect(lossNotification.decodabilityFlag()).toBe(kDecodabilityFlag);
  });
});
