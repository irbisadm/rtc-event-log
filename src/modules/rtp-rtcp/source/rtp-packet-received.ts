// Port of modules/rtp_rtcp/source/rtp_packet_received.h @ M154 (with the
// parsing of rtp_packet.cc and the header extensions GetHeader() fills into
// the RTPHeader fields this package has: transmission time offset,
// abs-send-time, transport sequence number (v1/v2), audio level, video
// rotation; see rtp_header_extensions.cc).

import {AudioLevel, RTPHeader} from "../../../api/rtp-headers.js";
import {RtpExtension} from "../../../api/rtp-parameters.js";
import type {RtpHeaderExtensionMap} from "../include/rtp-header-extension-map.js";
import {convertCVOByteToVideoRotation} from "../include/rtp-cvo.js";
import {ByteReader} from "./byte-io.js";

const kFixedHeaderSize = 12;
const kRtpVersion = 2;
const kOneByteExtensionProfileId = 0xbede;
const kTwoByteExtensionProfileId = 0x1000;
const kTwobyteExtensionProfileIdAppBitsFilter = 0xfff0;
const kOneByteExtensionHeaderLength = 1;
const kTwoByteExtensionHeaderLength = 2;

interface ExtensionInfo {
  id: number;
  offset: number;
  length: number;
}

export class RtpPacketReceived {
  private buffer: Uint8Array = new Uint8Array(0);
  private markerValue = false;
  private payloadTypeValue = 0;
  private sequenceNumberValue = 0;
  private timestampValue = 0;
  private ssrcValue = 0;
  private payloadOffset = kFixedHeaderSize;
  private payloadSize = 0;
  private paddingSizeValue = 0;
  private extensionEntries: ExtensionInfo[] = [];
  private extensions: RtpHeaderExtensionMap | null = null;

  // Parse and copy given buffer into Packet. Returns false on failure (the
  // packet is cleared).
  parse(buffer: Uint8Array): boolean {
    if (!this.parseBuffer(buffer)) {
      this.clear();
      return false;
    }
    this.buffer = buffer.slice();
    return true;
  }

  identifyExtensions(extensions: RtpHeaderExtensionMap): void {
    this.extensions = extensions.clone();
  }

  marker(): boolean {
    return this.markerValue;
  }
  payloadType(): number {
    return this.payloadTypeValue;
  }
  sequenceNumber(): number {
    return this.sequenceNumberValue;
  }
  timestamp(): number {
    return this.timestampValue;
  }
  ssrc(): number {
    return this.ssrcValue;
  }
  csrcs(): number[] {
    const numCsrc = this.buffer[0] & 0x0f;
    const csrcs: number[] = [];
    for (let i = 0; i < numCsrc; ++i) csrcs.push(ByteReader.u32(this.buffer, kFixedHeaderSize + 4 * i));
    return csrcs;
  }
  headersSize(): number {
    return this.payloadOffset;
  }
  payloadSizeBytes(): number {
    return this.payloadSize;
  }
  payload(): Uint8Array {
    return this.buffer.subarray(this.payloadOffset, this.payloadOffset + this.payloadSize);
  }
  paddingSize(): number {
    return this.paddingSizeValue;
  }
  hasPadding(): boolean {
    return (this.buffer[0] & 0x20) !== 0;
  }
  size(): number {
    return this.payloadOffset + this.payloadSize + this.paddingSizeValue;
  }

  getHeader(): RTPHeader {
    const header = new RTPHeader();
    header.markerBit = this.marker();
    header.payloadType = this.payloadType();
    header.sequenceNumber = this.sequenceNumber();
    header.timestamp = this.timestamp();
    header.ssrc = this.ssrc();
    const csrcs = this.csrcs();
    header.numCSRCs = csrcs.length;
    header.arrOfCSRCs = csrcs;
    header.paddingLength = this.paddingSize();
    header.headerLength = this.headersSize();

    const tto = this.findExtension(RtpExtension.kTimestampOffsetUri);
    if (tto !== undefined && tto.length === 3) {
      header.extension.hasTransmissionTimeOffset = true;
      header.extension.transmissionTimeOffset = ByteReader.i24(tto, 0);
    }
    const abs = this.findExtension(RtpExtension.kAbsSendTimeUri);
    if (abs !== undefined && abs.length === 3) {
      header.extension.hasAbsoluteSendTime = true;
      header.extension.absoluteSendTime = ByteReader.u24(abs, 0);
    }
    // TransportSequenceNumberV2 first (2 or 4 bytes), then v1 (2 bytes).
    const tseqV2 = this.findExtension(RtpExtension.kTransportSequenceNumberV2Uri);
    const tseq = this.findExtension(RtpExtension.kTransportSequenceNumberUri);
    if (tseqV2 !== undefined && (tseqV2.length === 2 || tseqV2.length === 4)) {
      header.extension.hasTransportSequenceNumber = true;
      header.extension.transportSequenceNumber = ByteReader.u16(tseqV2, 0);
    } else if (tseq !== undefined && tseq.length === 2) {
      header.extension.hasTransportSequenceNumber = true;
      header.extension.transportSequenceNumber = ByteReader.u16(tseq, 0);
    }
    const level = this.findExtension(RtpExtension.kAudioLevelUri);
    if (level !== undefined && level.length === 1) {
      header.extension.setAudioLevel(new AudioLevel((level[0] & 0x80) !== 0, level[0] & 0x7f));
    }
    const rotation = this.findExtension(RtpExtension.kVideoRotationUri);
    if (rotation !== undefined && rotation.length === 1) {
      header.extension.hasVideoRotation = true;
      header.extension.videoRotation = convertCVOByteToVideoRotation(rotation[0]);
    }
    return header;
  }

  // The raw data of the extension registered under `uri`, if present.
  private findExtension(uri: string): Uint8Array | undefined {
    if (this.extensions === null) return undefined;
    const id = this.extensions.getId(uri);
    for (const extension of this.extensionEntries) {
      if (extension.id === id) {
        return this.buffer.subarray(extension.offset, extension.offset + extension.length);
      }
    }
    return undefined;
  }

  private clear(): void {
    this.markerValue = false;
    this.payloadTypeValue = 0;
    this.sequenceNumberValue = 0;
    this.timestampValue = 0;
    this.ssrcValue = 0;
    this.payloadOffset = kFixedHeaderSize;
    this.payloadSize = 0;
    this.paddingSizeValue = 0;
    this.extensionEntries = [];
    this.buffer = new Uint8Array(kFixedHeaderSize);
    this.buffer[0] = kRtpVersion << 6;
  }

  private findOrCreateExtensionInfo(id: number): ExtensionInfo {
    for (const extension of this.extensionEntries) {
      if (extension.id === id) return extension;
    }
    const info = {id, offset: 0, length: 0};
    this.extensionEntries.push(info);
    return info;
  }

  private parseBuffer(buffer: Uint8Array): boolean {
    const size = buffer.length;
    if (size < kFixedHeaderSize) {
      return false;
    }
    const version = buffer[0] >> 6;
    if (version !== kRtpVersion) {
      return false;
    }
    const hasPadding = (buffer[0] & 0x20) !== 0;
    const hasExtension = (buffer[0] & 0x10) !== 0;
    const numberOfCrcs = buffer[0] & 0x0f;
    this.markerValue = (buffer[1] & 0x80) !== 0;
    this.payloadTypeValue = buffer[1] & 0x7f;

    this.sequenceNumberValue = ByteReader.u16(buffer, 2);
    this.timestampValue = ByteReader.u32(buffer, 4);
    this.ssrcValue = ByteReader.u32(buffer, 8);
    if (size < kFixedHeaderSize + numberOfCrcs * 4) {
      return false;
    }
    this.payloadOffset = kFixedHeaderSize + numberOfCrcs * 4;

    let extensionsSize = 0;
    this.extensionEntries = [];
    if (hasExtension) {
      // RTP header extension, RFC 3550.
      const extensionOffset = this.payloadOffset + 4;
      if (extensionOffset > size) {
        return false;
      }
      const profile = ByteReader.u16(buffer, this.payloadOffset);
      const extensionsCapacity = ByteReader.u16(buffer, this.payloadOffset + 2) * 4;
      if (extensionOffset + extensionsCapacity > size) {
        return false;
      }
      if (
        profile !== kOneByteExtensionProfileId &&
        (profile & kTwobyteExtensionProfileIdAppBitsFilter) !== kTwoByteExtensionProfileId
      ) {
        // Unsupported rtp extension.
      } else {
        const extensionHeaderLength =
          profile === kOneByteExtensionProfileId ? kOneByteExtensionHeaderLength : kTwoByteExtensionHeaderLength;
        const kPaddingByte = 0;
        const kPaddingId = 0;
        const kOneByteHeaderExtensionReservedId = 15;
        while (extensionsSize + extensionHeaderLength < extensionsCapacity) {
          if (buffer[extensionOffset + extensionsSize] === kPaddingByte) {
            extensionsSize++;
            continue;
          }
          let id: number;
          let length: number;
          if (profile === kOneByteExtensionProfileId) {
            id = buffer[extensionOffset + extensionsSize] >> 4;
            length = 1 + (buffer[extensionOffset + extensionsSize] & 0xf);
            if (id === kOneByteHeaderExtensionReservedId || (id === kPaddingId && length !== 1)) {
              break;
            }
          } else {
            id = buffer[extensionOffset + extensionsSize];
            length = buffer[extensionOffset + extensionsSize + 1];
          }

          if (extensionsSize + extensionHeaderLength + length > extensionsCapacity) {
            // Oversized rtp header extension.
            break;
          }

          const extensionInfo = this.findOrCreateExtensionInfo(id);
          // (A duplicate id overwrites the earlier one.)
          const offset = extensionOffset + extensionsSize + extensionHeaderLength;
          if (offset > 0xffff) {
            // Oversized rtp header extension.
            break;
          }
          extensionInfo.offset = offset;
          extensionInfo.length = length;
          extensionsSize += extensionHeaderLength + length;
        }
      }
      this.payloadOffset = extensionOffset + extensionsCapacity;
    }

    if (hasPadding && this.payloadOffset < size) {
      this.paddingSizeValue = buffer[size - 1];
      if (this.paddingSizeValue === 0) {
        // Padding was set, but padding size is zero.
        return false;
      }
    } else {
      this.paddingSizeValue = 0;
    }

    if (this.payloadOffset + this.paddingSizeValue > size) {
      return false;
    }
    this.payloadSize = size - this.payloadOffset - this.paddingSizeValue;
    return true;
  }
}
