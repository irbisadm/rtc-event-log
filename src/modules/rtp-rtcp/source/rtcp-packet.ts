// Port of modules/rtp_rtcp/source/rtcp_packet.h @ M154.

// IP_PACKET_SIZE (modules/rtp_rtcp/include/rtp_rtcp_defines.h).
export const IP_PACKET_SIZE = 1500;

// Called with each finished (compound) packet; the bytes are only valid
// during the call.
export type PacketReadyCallback = (packet: Uint8Array) => void;

// The C++ `size_t* index` in-out parameter.
export interface Index {
  value: number;
}

export abstract class RtcpPacket {
  protected static readonly kHeaderLength = 4;

  private senderSsrcValue = 0;

  setSenderSsrc(ssrc: number): void {
    this.senderSsrcValue = ssrc >>> 0;
  }

  senderSsrc(): number {
    return this.senderSsrcValue;
  }

  // Convenience method mostly used for test. Creates packet without
  // fragmentation using BlockLength() to allocate big enough buffer.
  build(): Uint8Array;
  // Returns true if call to Create succeeded.
  build(maxLength: number, callback: PacketReadyCallback): boolean;
  build(maxLength?: number, callback?: PacketReadyCallback): Uint8Array | boolean {
    if (maxLength === undefined) {
      const packet = new Uint8Array(this.blockLength());
      const length: Index = {value: 0};
      const created = this.create(packet, length, packet.length, null);
      if (!created || length.value !== packet.length) {
        throw new Error("BlockLength mispredicted size used by Create");
      }
      return packet;
    }
    if (maxLength > IP_PACKET_SIZE) throw new Error("max_length <= IP_PACKET_SIZE");
    const buffer = new Uint8Array(IP_PACKET_SIZE);
    const index: Index = {value: 0};
    if (!this.create(buffer, index, maxLength, callback ?? null)) return false;
    return this.onBufferFull(buffer, index, callback ?? null);
  }

  // Size of this packet in bytes (including headers).
  abstract blockLength(): number;

  // Creates packet in the given buffer at the given position.
  // Calls PacketReadyCallback::OnPacketReady if remaining buffer is too small
  // and assume buffer can be reused after OnPacketReady returns.
  abstract create(packet: Uint8Array, index: Index, maxLength: number, callback: PacketReadyCallback | null): boolean;

  protected static createHeader(
    countOrFormat: number,
    packetType: number,
    length: number, // Payload size in 32bit words.
    buffer: Uint8Array,
    pos: Index,
    padding = false, // True if there are padding bytes.
  ): void {
    const kVersionBits = 2 << 6;
    const paddingBit = padding ? 1 << 5 : 0;
    buffer[pos.value + 0] = (kVersionBits | paddingBit | countOrFormat) & 0xff;
    buffer[pos.value + 1] = packetType & 0xff;
    buffer[pos.value + 2] = (length >> 8) & 0xff;
    buffer[pos.value + 3] = length & 0xff;
    pos.value += RtcpPacket.kHeaderLength;
  }

  protected onBufferFull(packet: Uint8Array, index: Index, callback: PacketReadyCallback | null): boolean {
    if (index.value === 0) return false;
    if (callback === null) throw new Error("Fragmentation not supported.");
    callback(packet.subarray(0, index.value));
    index.value = 0;
    return true;
  }

  // Size of the rtcp packet as written in header.
  protected headerLength(): number {
    const lengthInBytes = this.blockLength();
    return (lengthInBytes - RtcpPacket.kHeaderLength) / 4;
  }
}
