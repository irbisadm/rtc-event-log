// Port of modules/rtp_rtcp/source/rtcp_packet/loss_notification.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";
import {Psfb} from "./psfb.js";

export class LossNotification extends Psfb {
  private static readonly kUniqueIdentifier = 0x4c4e5446; // 'L' 'N' 'T' 'F'.
  private static readonly kLossNotificationPayloadLength = 8;

  private lastDecodedValue: number;
  private lastReceivedValue: number;
  private decodabilityFlagValue: boolean;

  constructor(lastDecoded = 0, lastReceived = 0, decodabilityFlag = false) {
    super();
    this.lastDecodedValue = lastDecoded & 0xffff;
    this.lastReceivedValue = lastReceived & 0xffff;
    this.decodabilityFlagValue = decodabilityFlag;
  }

  blockLength(): number {
    return RtcpPacket.kHeaderLength + Psfb.kCommonFeedbackLength + LossNotification.kLossNotificationPayloadLength;
  }

  create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    while (index.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(packet, index, callback)) return false;
    }

    RtcpPacket.createHeader(Psfb.kAfbMessageType, Psfb.kPacketType, this.headerLength(), packet, index);

    this.createCommonFeedback(packet, index.value);
    index.value += Psfb.kCommonFeedbackLength;

    ByteWriter.u32(packet, index.value, LossNotification.kUniqueIdentifier);
    index.value += 4;

    ByteWriter.u16(packet, index.value, this.lastDecodedValue);
    index.value += 2;

    const lastReceivedDelta = (this.lastReceivedValue - this.lastDecodedValue) & 0xffff;
    const lastReceivedDeltaAndDecodability = ((lastReceivedDelta << 1) | (this.decodabilityFlagValue ? 0x0001 : 0x0000)) & 0xffff;
    ByteWriter.u16(packet, index.value, lastReceivedDeltaAndDecodability);
    index.value += 2;

    return true;
  }

  // Parse assumes header is already parsed and validated.
  parse(packet: CommonHeader): boolean {
    if (packet.payloadSizeBytes() < Psfb.kCommonFeedbackLength + LossNotification.kLossNotificationPayloadLength) {
      return false;
    }

    const payload = packet.payload();

    if (ByteReader.u32(payload, 8) !== LossNotification.kUniqueIdentifier) {
      return false;
    }

    this.parseCommonFeedback(payload);

    this.lastDecodedValue = ByteReader.u16(payload, 12);

    const lastReceivedDeltaAndDecodability = ByteReader.u16(payload, 14);
    this.lastReceivedValue = (this.lastDecodedValue + (lastReceivedDeltaAndDecodability >> 1)) & 0xffff;
    this.decodabilityFlagValue = (lastReceivedDeltaAndDecodability & 0x0001) !== 0;

    return true;
  }

  // Set all of the values transmitted by the loss notification message.
  // If the values may not be represented by a loss notification message,
  // false is returned, and no change is made to the object; this happens
  // when `last_received` is ahead of `last_decoded` by more than 0x7fff.
  set(lastDecoded: number, lastReceived: number, decodabilityFlag: boolean): boolean {
    const delta = (lastReceived - lastDecoded) & 0xffff;
    if (delta > 0x7fff) {
      return false;
    }
    this.lastReceivedValue = lastReceived & 0xffff;
    this.lastDecodedValue = lastDecoded & 0xffff;
    this.decodabilityFlagValue = decodabilityFlag;
    return true;
  }

  lastDecoded(): number {
    return this.lastDecodedValue;
  }
  lastReceived(): number {
    return this.lastReceivedValue;
  }
  decodabilityFlag(): boolean {
    return this.decodabilityFlagValue;
  }
}
