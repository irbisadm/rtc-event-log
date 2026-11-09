// Port of modules/rtp_rtcp/source/rtcp_packet/transport_feedback.h @ M154.
//
// Timestamps and deltas are microseconds as numbers (see api/units).

import {TimeDelta} from "../../../../api/units/time-delta.js";
import {Timestamp} from "../../../../api/units/timestamp.js";
import {isNewerSequenceNumber} from "../../../include/module-common-types-public.js";
import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import {CommonHeader} from "./common-header.js";
import {Rtpfb} from "./rtpfb.js";

// Header size:
// * 4 bytes Common RTCP Packet Header
// * 8 bytes Common Packet Format for RTCP Feedback Messages
// * 8 bytes FeedbackPacket header
const kTransportFeedbackHeaderSizeBytes = 4 + 8 + 8;
const kChunkSizeBytes = 2;
// TODO(sprang): Add support for dynamic max size for easier fragmentation,
// eg. set it to what's left in the buffer or IP_PACKET_SIZE.
// Size constraint imposed by RTCP common header: 16bit size field interpreted
// as number of four byte words minus the first header word.
const kMaxSizeBytes = (1 << 16) * 4;
// Payload size:
// * 8 bytes Common Packet Format for RTCP Feedback Messages
// * 8 bytes FeedbackPacket header.
// * 2 bytes for one chunk.
const kMinPayloadSizeBytes = 8 + 8 + 2;
const kDeltaTickUs = 250;
const kBaseTimeTickUs = kDeltaTickUs * (1 << 8);
const kTimeWrapPeriodUs = kBaseTimeTickUs * (1 << 24);

type DeltaSize = number;

// int16_t narrowing.
const asInt16 = (v: number): number => (v << 16) >> 16;

export class ReceivedPacket {
  constructor(
    private readonly sequenceNumberValue: number,
    private readonly deltaTicksValue: number,
  ) {}

  sequenceNumber(): number {
    return this.sequenceNumberValue;
  }
  deltaTicks(): number {
    return this.deltaTicksValue;
  }
  delta(): TimeDelta {
    return this.deltaTicksValue * kDeltaTickUs;
  }
}

// Keeps DeltaSizes that haven't been encoded into chunks yet.
class LastChunk {
  static readonly kMaxRunLengthCapacity = 0x1fff;

  private static readonly kMaxOneBitCapacity = 14;
  private static readonly kMaxTwoBitCapacity = 7;
  private static readonly kMaxVectorCapacity = LastChunk.kMaxOneBitCapacity;
  private static readonly kLarge: DeltaSize = 2;

  private deltaSizes: DeltaSize[] = new Array(LastChunk.kMaxVectorCapacity).fill(0);
  private size = 0;
  private allSame = true;
  private hasLargeDelta = false;

  constructor() {
    this.clear();
  }

  empty(): boolean {
    return this.size === 0;
  }

  clear(): void {
    this.size = 0;
    this.allSame = true;
    this.hasLargeDelta = false;
  }

  // Return if delta sizes still can be encoded into single chunk with added
  // `delta_size`.
  canAdd(deltaSize: DeltaSize): boolean {
    if (this.size < LastChunk.kMaxTwoBitCapacity) return true;
    if (this.size < LastChunk.kMaxOneBitCapacity && !this.hasLargeDelta && deltaSize !== LastChunk.kLarge) return true;
    if (this.size < LastChunk.kMaxRunLengthCapacity && this.allSame && this.deltaSizes[0] === deltaSize) return true;
    return false;
  }

  // Add `delta_size`, assumes `CanAdd(delta_size)`,
  add(deltaSize: DeltaSize): void {
    if (this.size < LastChunk.kMaxVectorCapacity) this.deltaSizes[this.size] = deltaSize;
    this.size++;
    this.allSame = this.allSame && deltaSize === this.deltaSizes[0];
    this.hasLargeDelta = this.hasLargeDelta || deltaSize === LastChunk.kLarge;
  }

  // Equivalent to calling Add(0) `num_missing` times. Assumes `Empty()`.
  addMissingPackets(numMissing: number): void {
    this.deltaSizes.fill(0);
    this.size = numMissing;
  }

  // Encode all stored delta_sizes into single chunk, pad with 0s if needed.
  emit(): number {
    if (this.allSame) {
      const chunk = this.encodeRunLength();
      this.clear();
      return chunk;
    }
    if (this.size === LastChunk.kMaxOneBitCapacity) {
      const chunk = this.encodeOneBit();
      this.clear();
      return chunk;
    }
    // Encode delta sizes using two bit chunk.
    const chunk = this.encodeTwoBit(LastChunk.kMaxTwoBitCapacity);
    // Remove deltas sizes encoded from the chunk.
    this.size -= LastChunk.kMaxTwoBitCapacity;
    this.allSame = true;
    this.hasLargeDelta = false;
    for (let i = 0; i < this.size; ++i) {
      const deltaSize = this.deltaSizes[LastChunk.kMaxTwoBitCapacity + i];
      this.deltaSizes[i] = deltaSize;
      this.allSame = this.allSame && deltaSize === this.deltaSizes[0];
      this.hasLargeDelta = this.hasLargeDelta || deltaSize === LastChunk.kLarge;
    }
    return chunk;
  }

  // Encode all stored delta_sizes into single chunk, pad with 0s if needed.
  encodeLast(): number {
    if (this.allSame) return this.encodeRunLength();
    if (this.size <= LastChunk.kMaxTwoBitCapacity) return this.encodeTwoBit(this.size);
    return this.encodeOneBit();
  }

  // Decode up to `max_size` delta sizes from `chunk`.
  decode(chunk: number, maxSize: number): void {
    if ((chunk & 0x8000) === 0) {
      this.decodeRunLength(chunk, maxSize);
    } else if ((chunk & 0x4000) === 0) {
      this.decodeOneBit(chunk, maxSize);
    } else {
      this.decodeTwoBit(chunk, maxSize);
    }
  }

  // Appends content of the Lastchunk to `deltas`.
  appendTo(deltas: DeltaSize[]): void {
    if (this.allSame) {
      for (let i = 0; i < this.size; ++i) deltas.push(this.deltaSizes[0]);
    } else {
      for (let i = 0; i < this.size; ++i) deltas.push(this.deltaSizes[i]);
    }
  }

  clone(): LastChunk {
    const copy = new LastChunk();
    copy.deltaSizes = this.deltaSizes.slice();
    copy.size = this.size;
    copy.allSame = this.allSame;
    copy.hasLargeDelta = this.hasLargeDelta;
    return copy;
  }

  //  One Bit Status Vector Chunk
  private encodeOneBit(): number {
    let chunk = 0x8000;
    for (let i = 0; i < this.size; ++i) chunk |= this.deltaSizes[i] << (LastChunk.kMaxOneBitCapacity - 1 - i);
    return chunk & 0xffff;
  }

  private decodeOneBit(chunk: number, maxSize: number): void {
    this.size = Math.min(LastChunk.kMaxOneBitCapacity, maxSize);
    this.hasLargeDelta = false;
    this.allSame = false;
    for (let i = 0; i < this.size; ++i) this.deltaSizes[i] = (chunk >> (LastChunk.kMaxOneBitCapacity - 1 - i)) & 0x01;
  }

  //  Two Bit Status Vector Chunk
  private encodeTwoBit(size: number): number {
    let chunk = 0xc000;
    for (let i = 0; i < size; ++i) chunk |= this.deltaSizes[i] << (2 * (LastChunk.kMaxTwoBitCapacity - 1 - i));
    return chunk & 0xffff;
  }

  private decodeTwoBit(chunk: number, maxSize: number): void {
    this.size = Math.min(LastChunk.kMaxTwoBitCapacity, maxSize);
    this.hasLargeDelta = true;
    this.allSame = false;
    for (let i = 0; i < this.size; ++i) this.deltaSizes[i] = (chunk >> (2 * (LastChunk.kMaxTwoBitCapacity - 1 - i))) & 0x03;
  }

  //  Run Length Status Vector Chunk
  private encodeRunLength(): number {
    return ((this.deltaSizes[0] << 13) | this.size) & 0xffff;
  }

  private decodeRunLength(chunk: number, maxCount: number): void {
    this.size = Math.min(chunk & 0x1fff, maxCount);
    const deltaSize = (chunk >> 13) & 0x03;
    this.hasLargeDelta = deltaSize >= LastChunk.kLarge;
    this.allSame = true;
    // To make it consistent with Add function, populate delta_sizes_ beyond 1st.
    for (let i = 0; i < Math.min(this.size, LastChunk.kMaxVectorCapacity); ++i) this.deltaSizes[i] = deltaSize;
  }
}

export class TransportFeedback extends Rtpfb {
  static readonly kFeedbackMessageType = 15;
  // Convert to multiples of 0.25ms.
  static readonly kDeltaTick: TimeDelta = kDeltaTickUs;
  // Maximum number of packets (including missing) TransportFeedback can report.
  static readonly kMaxReportedPackets = 0xffff;

  private baseSeqNo = 0;
  private numSeqNo = 0;
  private baseTimeTicks = 0;
  private feedbackSeq = 0;
  private includeTimestampsValue: boolean;

  private lastTimestamp: Timestamp = Timestamp.zero();
  private receivedPackets: ReceivedPacket[] = [];
  // All but last encoded packet chunks.
  private encodedChunks: number[] = [];
  private lastChunk = new LastChunk();
  private sizeBytes = kTransportFeedbackHeaderSizeBytes;

  // If `include_timestamps` is set to false, the created packet will not
  // contain the receive delta block.
  constructor(includeTimestamps = true) {
    super();
    this.includeTimestampsValue = includeTimestamps;
  }

  setBase(
    baseSequence: number, // Seq# of first packet in this msg.
    refTimestamp: Timestamp, // Reference timestamp for this msg.
  ): void {
    this.baseSeqNo = baseSequence & 0xffff;
    // C++ % and / truncate toward zero; the result is stored in a uint32_t.
    this.baseTimeTicks = Math.trunc((refTimestamp % kTimeWrapPeriodUs) / kBaseTimeTickUs) >>> 0;
    this.lastTimestamp = this.baseTime();
  }

  setFeedbackSequenceNumber(feedbackSequence: number): void {
    this.feedbackSeq = feedbackSequence & 0xff;
  }

  // NOTE: This method requires increasing sequence numbers (excepting wraps).
  addReceivedPacket(sequenceNumber: number, timestamp: Timestamp): boolean {
    sequenceNumber &= 0xffff;
    // Set delta to zero if timestamps are not included, this will simplify the
    // encoding process.
    let delta = 0;
    if (this.includeTimestampsValue) {
      // Convert to ticks and round.
      if (this.lastTimestamp > timestamp) {
        const diff = this.lastTimestamp - timestamp;
        timestamp += Math.trunc((diff + kTimeWrapPeriodUs - 1) / kTimeWrapPeriodUs) * kTimeWrapPeriodUs;
      }
      let deltaFull = (timestamp - this.lastTimestamp) % kTimeWrapPeriodUs;
      if (deltaFull > kTimeWrapPeriodUs / 2) {
        deltaFull -= kTimeWrapPeriodUs;
        deltaFull -= kDeltaTickUs / 2;
      } else {
        deltaFull += kDeltaTickUs / 2;
      }
      deltaFull = Math.trunc(deltaFull / kDeltaTickUs);

      delta = asInt16(deltaFull);
      // If larger than 16bit signed, we can't represent it - need new fb packet.
      if (delta !== deltaFull) {
        return false;
      }
    }

    const nextSeqNo = (this.baseSeqNo + this.numSeqNo) & 0xffff;
    if (sequenceNumber !== nextSeqNo) {
      const lastSeqNo = (nextSeqNo - 1) & 0xffff;
      if (!isNewerSequenceNumber(sequenceNumber, lastSeqNo)) return false;
      const numMissingPackets = (sequenceNumber - nextSeqNo) & 0xffff;
      if (!this.addMissingPackets(numMissingPackets)) return false;
    }

    const deltaSize: DeltaSize = delta >= 0 && delta <= 0xff ? 1 : 2;
    if (!this.addDeltaSize(deltaSize)) return false;

    this.receivedPackets.push(new ReceivedPacket(sequenceNumber, delta));
    this.lastTimestamp += delta * kDeltaTickUs;
    if (this.includeTimestampsValue) {
      this.sizeBytes += deltaSize;
    }
    return true;
  }

  // Returns received packets only.
  getReceivedPackets(): readonly ReceivedPacket[] {
    return this.receivedPackets;
  }

  // Calls `handler` for all packets this feedback describes.
  // For received packets pass receieve time as `delta_since_base` since the
  // `BaseTime()`. For missed packets calls `handler` with `delta_since_base =
  // PlusInfinity()`.
  forAllPackets(handler: (sequenceNumber: number, deltaSinceBase: TimeDelta) => void): void {
    let deltaSinceBase = 0;
    let receivedIt = 0;
    const lastSeqNum = (this.baseSeqNo + this.numSeqNo) & 0xffff;
    for (let seqNum = this.baseSeqNo; seqNum !== lastSeqNum; seqNum = (seqNum + 1) & 0xffff) {
      if (receivedIt !== this.receivedPackets.length && this.receivedPackets[receivedIt].sequenceNumber() === seqNum) {
        deltaSinceBase += this.receivedPackets[receivedIt].delta();
        handler(seqNum, deltaSinceBase);
        ++receivedIt;
      } else {
        handler(seqNum, Infinity);
      }
    }
  }

  getBaseSequence(): number {
    return this.baseSeqNo;
  }

  // Returns number of packets (including missing) this feedback describes.
  getPacketStatusCount(): number {
    return this.numSeqNo;
  }

  // Get the reference time including any precision loss.
  baseTime(): Timestamp {
    // Add an extra kTimeWrapPeriod to allow add received packets arrived earlier
    // than the first added packet (and thus allow to record negative deltas)
    // even when ref_timestamp can be initialized at zero.
    return kTimeWrapPeriodUs + this.baseTimeTicks * kBaseTimeTickUs;
  }

  // Get the unwrapped delta between current base time and `prev_timestamp`.
  getBaseDelta(prevTimestamp: Timestamp): TimeDelta {
    let delta = this.baseTime() - prevTimestamp;
    // Compensate for wrap around.
    if (Math.abs(delta - kTimeWrapPeriodUs) < Math.abs(delta)) {
      delta -= kTimeWrapPeriodUs; // Wrap backwards.
    } else if (Math.abs(delta + kTimeWrapPeriodUs) < Math.abs(delta)) {
      delta += kTimeWrapPeriodUs; // Wrap forwards.
    }
    return delta;
  }

  // Does the feedback packet contain timestamp information?
  includeTimestamps(): boolean {
    return this.includeTimestampsValue;
  }

  parse(packet: CommonHeader): boolean {
    if (packet.payloadSizeBytes() < kMinPayloadSizeBytes) {
      return false;
    }

    const payload = packet.payload();
    this.parseCommonFeedback(payload);

    this.baseSeqNo = ByteReader.u16(payload, 8);
    const statusCount = ByteReader.u16(payload, 10);
    this.baseTimeTicks = ByteReader.u24(payload, 12);
    this.feedbackSeq = payload[15];
    this.clear();
    let index = 16;
    const endIndex = packet.payloadSizeBytes();

    if (statusCount === 0) {
      return false;
    }

    const deltaSizes: number[] = [];
    while (deltaSizes.length < statusCount) {
      if (index + kChunkSizeBytes > endIndex) {
        this.clear();
        return false;
      }

      const chunk = ByteReader.u16(payload, index);
      index += kChunkSizeBytes;
      this.encodedChunks.push(chunk);
      this.lastChunk.decode(chunk, statusCount - deltaSizes.length);
      this.lastChunk.appendTo(deltaSizes);
    }
    // Last chunk is stored in the `last_chunk_`.
    this.encodedChunks.pop();
    this.numSeqNo = statusCount;

    let seqNo = this.baseSeqNo;
    const recvDeltaSize = deltaSizes.reduce((sum, d) => sum + d, 0);

    // Determine if timestamps, that is, recv_delta are included in the packet.
    if (endIndex >= index + recvDeltaSize) {
      for (const deltaSize of deltaSizes) {
        switch (deltaSize) {
          case 0:
            break;
          case 1: {
            const delta = payload[index];
            this.receivedPackets.push(new ReceivedPacket(seqNo, delta));
            this.lastTimestamp += delta * kDeltaTickUs;
            index += deltaSize;
            break;
          }
          case 2: {
            const delta = ByteReader.i16(payload, index);
            this.receivedPackets.push(new ReceivedPacket(seqNo, delta));
            this.lastTimestamp += delta * kDeltaTickUs;
            index += deltaSize;
            break;
          }
          case 3:
            this.clear();
            return false;
        }
        seqNo = (seqNo + 1) & 0xffff;
      }
    } else {
      // The packet does not contain receive deltas.
      this.includeTimestampsValue = false;
      for (const deltaSize of deltaSizes) {
        // Use delta sizes to detect if packet was received.
        if (deltaSize > 0) {
          this.receivedPackets.push(new ReceivedPacket(seqNo, 0));
        }
        seqNo = (seqNo + 1) & 0xffff;
      }
    }
    this.sizeBytes = RtcpPacket.kHeaderLength + index;
    return true;
  }

  static parseFrom(buffer: Uint8Array): TransportFeedback | null {
    const header = new CommonHeader();
    if (!header.parse(buffer)) return null;
    if (header.type() !== Rtpfb.kPacketType || header.fmt() !== TransportFeedback.kFeedbackMessageType) return null;
    const parsed = new TransportFeedback();
    if (!parsed.parse(header)) return null;
    return parsed;
  }

  // Pre and postcondition for all public methods. Should always return true.
  // This function is for tests.
  isConsistent(): boolean {
    let packetSize = kTransportFeedbackHeaderSizeBytes;
    const deltaSizes: DeltaSize[] = [];
    const chunkDecoder = new LastChunk();
    for (const chunk of this.encodedChunks) {
      chunkDecoder.decode(chunk, TransportFeedback.kMaxReportedPackets);
      chunkDecoder.appendTo(deltaSizes);
      packetSize += kChunkSizeBytes;
    }
    if (!this.lastChunk.empty()) {
      this.lastChunk.appendTo(deltaSizes);
      packetSize += kChunkSizeBytes;
    }
    if (this.numSeqNo !== deltaSizes.length) {
      return false;
    }
    let timestamp = this.baseTime();
    let packetIt = 0;
    let seqNo = this.baseSeqNo;
    for (const deltaSize of deltaSizes) {
      if (deltaSize > 0) {
        if (packetIt === this.receivedPackets.length) {
          return false;
        }
        const packet = this.receivedPackets[packetIt];
        if (packet.sequenceNumber() !== seqNo) {
          return false;
        }
        if (deltaSize === 1 && (packet.deltaTicks() < 0 || packet.deltaTicks() > 0xff)) {
          return false;
        }
        timestamp += packet.delta();
        ++packetIt;
      }
      if (this.includeTimestampsValue) {
        packetSize += deltaSize;
      }
      seqNo = (seqNo + 1) & 0xffff;
    }
    if (packetIt !== this.receivedPackets.length) {
      return false;
    }
    if (timestamp !== this.lastTimestamp) {
      return false;
    }
    if (this.sizeBytes !== packetSize) {
      return false;
    }
    return true;
  }

  blockLength(): number {
    // Round size_bytes_ up to multiple of 32bits.
    return (this.sizeBytes + 3) & ~3;
  }

  paddingLength(): number {
    return this.blockLength() - this.sizeBytes;
  }

  create(packet: Uint8Array, position: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    if (this.numSeqNo === 0) return false;

    while (position.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(packet, position, callback)) return false;
    }
    const paddingLength = this.paddingLength();
    const hasPadding = paddingLength > 0;
    RtcpPacket.createHeader(TransportFeedback.kFeedbackMessageType, Rtpfb.kPacketType, this.headerLength(), packet, position, hasPadding);
    this.createCommonFeedback(packet, position.value);
    position.value += Rtpfb.kCommonFeedbackLength;

    ByteWriter.u16(packet, position.value, this.baseSeqNo);
    position.value += 2;

    ByteWriter.u16(packet, position.value, this.numSeqNo);
    position.value += 2;

    ByteWriter.u24(packet, position.value, this.baseTimeTicks);
    position.value += 3;

    packet[position.value++] = this.feedbackSeq;

    for (const chunk of this.encodedChunks) {
      ByteWriter.u16(packet, position.value, chunk);
      position.value += 2;
    }
    if (!this.lastChunk.empty()) {
      const chunk = this.lastChunk.encodeLast();
      ByteWriter.u16(packet, position.value, chunk);
      position.value += 2;
    }

    if (this.includeTimestampsValue) {
      for (const receivedPacket of this.receivedPackets) {
        const delta = receivedPacket.deltaTicks();
        if (delta >= 0 && delta <= 0xff) {
          packet[position.value++] = delta;
        } else {
          ByteWriter.u16(packet, position.value, delta & 0xffff);
          position.value += 2;
        }
      }
    }

    if (paddingLength > 0) {
      for (let i = 0; i < paddingLength - 1; ++i) {
        packet[position.value++] = 0;
      }
      packet[position.value++] = paddingLength;
    }
    return true;
  }

  // C++ copies feedback packets by value.
  clone(): TransportFeedback {
    const copy = new TransportFeedback(this.includeTimestampsValue);
    copy.setSenderSsrc(this.senderSsrc());
    copy.setMediaSsrc(this.mediaSsrc());
    copy.baseSeqNo = this.baseSeqNo;
    copy.numSeqNo = this.numSeqNo;
    copy.baseTimeTicks = this.baseTimeTicks;
    copy.feedbackSeq = this.feedbackSeq;
    copy.lastTimestamp = this.lastTimestamp;
    copy.receivedPackets = this.receivedPackets.slice();
    copy.encodedChunks = this.encodedChunks.slice();
    copy.lastChunk = this.lastChunk.clone();
    copy.sizeBytes = this.sizeBytes;
    return copy;
  }

  // Reset packet to consistent empty state.
  private clear(): void {
    this.numSeqNo = 0;
    this.lastTimestamp = this.baseTime();
    this.receivedPackets = [];
    this.encodedChunks = [];
    this.lastChunk.clear();
    this.sizeBytes = kTransportFeedbackHeaderSizeBytes;
  }

  private addDeltaSize(deltaSize: DeltaSize): boolean {
    if (this.numSeqNo === TransportFeedback.kMaxReportedPackets) return false;
    const addChunkSize = this.lastChunk.empty() ? kChunkSizeBytes : 0;

    if (this.sizeBytes + deltaSize + addChunkSize > kMaxSizeBytes) return false;

    if (this.lastChunk.canAdd(deltaSize)) {
      this.sizeBytes += addChunkSize;
      this.lastChunk.add(deltaSize);
      ++this.numSeqNo;
      return true;
    }
    if (this.sizeBytes + deltaSize + kChunkSizeBytes > kMaxSizeBytes) return false;

    this.encodedChunks.push(this.lastChunk.emit());
    this.sizeBytes += kChunkSizeBytes;
    this.lastChunk.add(deltaSize);
    ++this.numSeqNo;
    return true;
  }

  private addMissingPackets(numMissingPackets: number): boolean {
    const newNumSeqNo = this.numSeqNo + numMissingPackets;
    if (newNumSeqNo > TransportFeedback.kMaxReportedPackets) {
      return false;
    }

    if (!this.lastChunk.empty()) {
      while (numMissingPackets > 0 && this.lastChunk.canAdd(0)) {
        this.lastChunk.add(0);
        --numMissingPackets;
      }
      if (numMissingPackets === 0) {
        this.numSeqNo = newNumSeqNo;
        return true;
      }
      this.encodedChunks.push(this.lastChunk.emit());
    }
    const fullChunks = Math.floor(numMissingPackets / LastChunk.kMaxRunLengthCapacity);
    const partialChunk = numMissingPackets % LastChunk.kMaxRunLengthCapacity;
    const numChunks = fullChunks + (partialChunk > 0 ? 1 : 0);
    if (this.sizeBytes + kChunkSizeBytes * numChunks > kMaxSizeBytes) {
      this.numSeqNo = newNumSeqNo - numMissingPackets;
      return false;
    }
    this.sizeBytes += kChunkSizeBytes * numChunks;
    // T = 0, S = 0, run length = kMaxRunLengthCapacity, see EncodeRunLength().
    for (let i = 0; i < fullChunks; ++i) this.encodedChunks.push(LastChunk.kMaxRunLengthCapacity);
    this.lastChunk.addMissingPackets(partialChunk);
    this.numSeqNo = newNumSeqNo;
    return true;
  }
}
