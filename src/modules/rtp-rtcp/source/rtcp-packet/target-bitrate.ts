// Port of modules/rtp_rtcp/source/rtcp_packet/target_bitrate.h @ M154.

import {ByteReader, ByteWriter} from "../byte-io.js";

const kTargetBitrateHeaderSizeBytes = 4;

export class BitrateItem {
  constructor(
    public spatialLayer = 0,
    public temporalLayer = 0,
    public targetBitrateKbps = 0,
  ) {}
}

export class TargetBitrate {
  // TODO(sprang): This block type is just a place holder. We need to get an
  //               id assigned by IANA.
  static readonly kBlockType = 42;
  static readonly kBitrateItemSizeBytes = 4;

  private bitrates: BitrateItem[] = [];

  addTargetBitrate(spatialLayer: number, temporalLayer: number, targetBitrateKbps: number): void {
    this.bitrates.push(new BitrateItem(spatialLayer & 0xff, temporalLayer & 0xff, targetBitrateKbps >>> 0));
  }

  getTargetBitrates(): readonly BitrateItem[] {
    return this.bitrates;
  }

  parse(block: Uint8Array, blockLength: number): void {
    // Validate block header (should already have been parsed and checked).

    // Header specifies block length - 1, but since we ignore the header, which
    // occupies exactly on block, we can just treat this as payload length.
    const payloadBytes = blockLength * 4;
    const numItems = Math.floor(payloadBytes / TargetBitrate.kBitrateItemSizeBytes);
    let index = kTargetBitrateHeaderSizeBytes;
    this.bitrates = [];
    for (let i = 0; i < numItems; ++i) {
      const layers = block[index];
      const bitrateKbps = ByteReader.u24(block, index + 1);
      index += TargetBitrate.kBitrateItemSizeBytes;
      this.addTargetBitrate((layers >> 4) & 0x0f, layers & 0x0f, bitrateKbps);
    }
  }

  blockLength(): number {
    return kTargetBitrateHeaderSizeBytes + this.bitrates.length * TargetBitrate.kBitrateItemSizeBytes;
  }

  create(buffer: Uint8Array): void {
    buffer[0] = TargetBitrate.kBlockType;
    buffer[1] = 0; // Reserved.
    const blockLengthWords = this.blockLength() / 4 - 1;
    ByteWriter.u16(buffer, 2, blockLengthWords);

    let index = kTargetBitrateHeaderSizeBytes;
    for (const item of this.bitrates) {
      buffer[index] = ((item.spatialLayer << 4) | item.temporalLayer) & 0xff;
      ByteWriter.u24(buffer, index + 1, item.targetBitrateKbps);
      index += TargetBitrate.kBitrateItemSizeBytes;
    }
  }

  clone(): TargetBitrate {
    const copy = new TargetBitrate();
    for (const item of this.bitrates) copy.addTargetBitrate(item.spatialLayer, item.temporalLayer, item.targetBitrateKbps);
    return copy;
  }
}
