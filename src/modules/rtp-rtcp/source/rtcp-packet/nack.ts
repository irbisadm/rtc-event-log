// Port of modules/rtp_rtcp/source/rtcp_packet/nack.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";
import {Rtpfb} from "./rtpfb.js";

interface PackedNack {
  firstPid: number;
  bitmask: number;
}

export class Nack extends Rtpfb {
  static readonly kFeedbackMessageType = 1;

  private static readonly kNackItemLength = 4;

  private packed: PackedNack[] = [];
  private packetIdsValue: number[] = [];

  // Parse assumes header is already parsed and validated.
  parse(packet: CommonHeader): boolean {
    if (packet.payloadSizeBytes() < Rtpfb.kCommonFeedbackLength + Nack.kNackItemLength) {
      return false;
    }
    const nackItems = Math.floor((packet.payloadSizeBytes() - Rtpfb.kCommonFeedbackLength) / Nack.kNackItemLength);

    this.parseCommonFeedback(packet.payload());
    let nextNack = Rtpfb.kCommonFeedbackLength;

    this.packetIdsValue = [];
    // packed_.resize(nack_items) overwrites (and drops) any previous items.
    this.packed = [];
    for (let index = 0; index < nackItems; ++index) {
      this.packed.push({firstPid: ByteReader.u16(packet.payload(), nextNack), bitmask: ByteReader.u16(packet.payload(), nextNack + 2)});
      nextNack += Nack.kNackItemLength;
    }
    this.unpack();

    return true;
  }

  setPacketIds(nackList: readonly number[]): void {
    this.packetIdsValue = nackList.map((id) => id & 0xffff);
    this.pack();
  }

  packetIds(): readonly number[] {
    return this.packetIdsValue;
  }

  blockLength(): number {
    return RtcpPacket.kHeaderLength + Rtpfb.kCommonFeedbackLength + this.packed.length * Nack.kNackItemLength;
  }

  create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    // If nack list can't fit in packet, try to fragment.
    const kNackHeaderLength = RtcpPacket.kHeaderLength + Rtpfb.kCommonFeedbackLength;
    for (let nackIndex = 0; nackIndex < this.packed.length; ) {
      const bytesLeftInBuffer = maxLength - index.value;
      if (bytesLeftInBuffer < kNackHeaderLength + Nack.kNackItemLength) {
        if (!this.onBufferFull(packet, index, callback)) return false;
        continue;
      }
      const numNackFields = Math.min(
        Math.floor((bytesLeftInBuffer - kNackHeaderLength) / Nack.kNackItemLength),
        this.packed.length - nackIndex,
      );

      const payloadSizeBytes = Rtpfb.kCommonFeedbackLength + numNackFields * Nack.kNackItemLength;
      const payloadSize32bits = payloadSizeBytes / 4;
      RtcpPacket.createHeader(Nack.kFeedbackMessageType, Rtpfb.kPacketType, payloadSize32bits, packet, index);

      this.createCommonFeedback(packet, index.value);
      index.value += Rtpfb.kCommonFeedbackLength;

      const nackEndIndex = nackIndex + numNackFields;
      for (; nackIndex < nackEndIndex; ++nackIndex) {
        const item = this.packed[nackIndex];
        ByteWriter.u16(packet, index.value + 0, item.firstPid);
        ByteWriter.u16(packet, index.value + 2, item.bitmask);
        index.value += Nack.kNackItemLength;
      }
    }
    return true;
  }

  // Fills packed_ using packed_ids_. (used in SetPacketIds). Appends, like
  // upstream (which never clears packed_ here).
  private pack(): void {
    let it = 0;
    const end = this.packetIdsValue.length;
    while (it !== end) {
      const item: PackedNack = {firstPid: this.packetIdsValue[it++], bitmask: 0};
      // Add all following sequence numbers that fits into the bitmask.
      while (it !== end) {
        const shift = (this.packetIdsValue[it] - item.firstPid - 1) & 0xffff;
        if (shift <= 15) {
          item.bitmask |= 1 << shift;
          ++it;
        } else {
          break;
        }
      }
      this.packed.push(item);
    }
  }

  // Fills packet_ids_ using packed_. (used in Parse).
  private unpack(): void {
    for (const item of this.packed) {
      this.packetIdsValue.push(item.firstPid);
      let pid = (item.firstPid + 1) & 0xffff;
      for (let bitmask = item.bitmask; bitmask !== 0; bitmask >>= 1, pid = (pid + 1) & 0xffff) {
        if (bitmask & 1) this.packetIdsValue.push(pid);
      }
    }
  }
}
