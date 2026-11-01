// Port of modules/rtp_rtcp/source/rtcp_packet/common_header.h @ M154.

import {ByteReader} from "../byte-io.js";

export class CommonHeader {
  static readonly kHeaderSizeBytes = 4;

  private packetType = 0;
  private countOrFormat = 0;
  private paddingSize = 0;
  private payloadSize = 0;
  private payloadView: Uint8Array = new Uint8Array(0);

  // Parse assumes buffer starts at the beginning of an RTCP packet; the whole
  // of `buffer` is the remaining data (C++ `buffer`, `size_bytes`).
  parse(buffer: Uint8Array): boolean {
    const kVersion = 2;
    const sizeBytes = buffer.length;
    if (sizeBytes < CommonHeader.kHeaderSizeBytes) {
      return false;
    }

    const version = buffer[0] >> 6;
    if (version !== kVersion) {
      return false;
    }

    const hasPadding = (buffer[0] & 0x20) !== 0;
    this.countOrFormat = buffer[0] & 0x1f;
    this.packetType = buffer[1];
    this.payloadSize = ByteReader.u16(buffer, 2) * 4;
    this.paddingSize = 0;

    if (sizeBytes < CommonHeader.kHeaderSizeBytes + this.payloadSize) {
      return false;
    }
    this.payloadView = buffer.subarray(CommonHeader.kHeaderSizeBytes, CommonHeader.kHeaderSizeBytes + this.payloadSize);

    if (hasPadding) {
      if (this.payloadSize === 0) {
        return false;
      }

      this.paddingSize = this.payloadView[this.payloadSize - 1];
      if (this.paddingSize === 0) {
        return false;
      }
      if (this.paddingSize > this.payloadSize) {
        return false;
      }
      this.payloadSize -= this.paddingSize;
      this.payloadView = this.payloadView.subarray(0, this.payloadSize);
    }
    return true;
  }

  type(): number {
    return this.packetType;
  }
  // Depending on packet type same header field can be used either as count or
  // as feedback message type (fmt). Caller expected to know how it is used.
  fmt(): number {
    return this.countOrFormat;
  }
  count(): number {
    return this.countOrFormat;
  }
  payloadSizeBytes(): number {
    return this.payloadSize;
  }
  payload(): Uint8Array {
    return this.payloadView;
  }
  packetSize(): number {
    return CommonHeader.kHeaderSizeBytes + this.payloadSize + this.paddingSize;
  }
  // Offset of the next packet from the start of this one (C++ NextPacket()).
  nextPacketOffset(): number {
    return this.packetSize();
  }
}
