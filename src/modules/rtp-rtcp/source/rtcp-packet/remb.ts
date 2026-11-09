// Port of modules/rtp_rtcp/source/rtcp_packet/remb.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";
import {Psfb} from "./psfb.js";

// Receiver Estimated Max Bitrate (REMB) (draft-alvestrand-rmcat-remb).
// The media SSRC of the common feedback is unused (zero).
export class Remb extends Psfb {
  static readonly kMaxNumberOfSsrcs = 0xff;

  private static readonly kUniqueIdentifier = 0x52454d42; // 'R' 'E' 'M' 'B'.

  private bitrateBpsValue = 0; // int64_t
  private ssrcsValue: number[] = [];

  parse(packet: CommonHeader): boolean {
    if (packet.payloadSizeBytes() < 16) {
      return false;
    }
    const payload = packet.payload();
    if (Remb.kUniqueIdentifier !== ByteReader.u32(payload, 8)) {
      return false;
    }
    const numberOfSsrcs = payload[12];
    if (packet.payloadSizeBytes() !== Psfb.kCommonFeedbackLength + (2 + numberOfSsrcs) * 4) {
      return false;
    }

    this.parseCommonFeedback(payload);
    const exponent = BigInt(payload[13] >> 2);
    const mantissa = BigInt(((payload[13] & 0x03) << 16) | ByteReader.u16(payload, 14));
    const shifted = BigInt.asUintN(64, mantissa << exponent);
    const bitrateBps = BigInt.asIntN(64, shifted);
    const shiftOverflow = shifted >> exponent !== mantissa;
    if (bitrateBps < 0n || shiftOverflow) {
      return false;
    }
    this.bitrateBpsValue = Number(bitrateBps);

    let nextSsrc = 16;
    this.ssrcsValue = [];
    for (let i = 0; i < numberOfSsrcs; ++i) {
      this.ssrcsValue.push(ByteReader.u32(payload, nextSsrc));
      nextSsrc += 4;
    }

    return true;
  }

  setSsrcs(ssrcs: readonly number[]): boolean {
    if (ssrcs.length > Remb.kMaxNumberOfSsrcs) {
      return false;
    }
    this.ssrcsValue = ssrcs.map((s) => s >>> 0);
    return true;
  }

  setBitrateBps(bitrateBps: number): void {
    this.bitrateBpsValue = bitrateBps;
  }

  bitrateBps(): number {
    return this.bitrateBpsValue;
  }
  ssrcs(): readonly number[] {
    return this.ssrcsValue;
  }

  blockLength(): number {
    return RtcpPacket.kHeaderLength + Psfb.kCommonFeedbackLength + (2 + this.ssrcsValue.length) * 4;
  }

  create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    while (index.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(packet, index, callback)) return false;
    }
    RtcpPacket.createHeader(Psfb.kAfbMessageType, Psfb.kPacketType, this.headerLength(), packet, index);
    this.createCommonFeedback(packet, index.value);
    index.value += Psfb.kCommonFeedbackLength;

    ByteWriter.u32(packet, index.value, Remb.kUniqueIdentifier);
    index.value += 4;
    const kMaxMantissa = 0x3ffffn; // 18 bits.
    let mantissa = BigInt.asUintN(64, BigInt(Math.trunc(this.bitrateBpsValue)));
    let exponenta = 0;
    while (mantissa > kMaxMantissa) {
      mantissa >>= 1n;
      ++exponenta;
    }
    packet[index.value++] = this.ssrcsValue.length & 0xff;
    packet[index.value++] = ((exponenta << 2) | Number(mantissa >> 16n)) & 0xff;
    ByteWriter.u16(packet, index.value, Number(mantissa & 0xffffn));
    index.value += 2;

    for (const ssrc of this.ssrcsValue) {
      ByteWriter.u32(packet, index.value, ssrc);
      index.value += 4;
    }
    return true;
  }
}
