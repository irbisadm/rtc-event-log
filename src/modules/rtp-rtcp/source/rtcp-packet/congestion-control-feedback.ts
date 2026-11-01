// Port of modules/rtp_rtcp/source/rtcp_packet/congestion_control_feedback.h @ M154.
//
// Congestion control feedback message as specified in
// https://www.rfc-editor.org/rfc/rfc8888.html

import {EcnMarking} from "../../../../api/transport/ecn-marking.js";
import type {TimeDelta} from "../../../../api/units/time-delta.js";
import {ByteReader, ByteWriter} from "../byte-io.js";
import {type Index, type PacketReadyCallback, RtcpPacket} from "../rtcp-packet.js";
import type {CommonHeader} from "./common-header.js";
import {Rtpfb} from "./rtpfb.js";

const kSenderSsrcLength = 4;
const kHeaderPerMediaSssrcLength = 8;
const kTimestampLength = 4;

// RFC-3168, Section 5
const kEcnEct1 = 0x01;
const kEcnEct0 = 0x02;
const kEcnCe = 0x03;

// Arrival time offset (ATO, 13 bits):
// The arrival time of the RTP packet at the receiver, as an offset before the
// time represented by the Report Timestamp (RTS) field of this RTCP congestion
// control feedback report. The ATO field is in units of 1/1024 seconds (this
// unit is chosen to give exact offsets from the RTS field) so, for example, an
// ATO value of 512 indicates that the corresponding RTP packet arrived exactly
// half a second before the time instant represented by the RTS field. If the
// measured value is greater than 8189/1024 seconds (the value that would be
// coded as 0x1FFD), the value 0x1FFE MUST be reported to indicate an over-range
// measurement. If the measurement is unavailable or if the arrival time of the
// RTP packet is after the time represented by the RTS field, then an ATO value
// of 0x1FFF MUST be reported for the packet.
function to13bitAto(arrivalTimeOffset: TimeDelta): number {
  if (arrivalTimeOffset < 0) {
    return 0x1fff;
  }
  // 1024 * arrival_time_offset.seconds<float>(), in float arithmetic.
  const seconds = Math.fround(Math.fround(arrivalTimeOffset) * Math.fround(1 / 1000000));
  return Math.min(Math.trunc(Math.fround(1024 * seconds)), 0x1ffe);
}

function atoToTimeDelta(receiveInfo: number): TimeDelta {
  const ato = receiveInfo & 0x1fff;
  if (ato === 0x1ffe) {
    return Infinity;
  }
  if (ato === 0x1fff) {
    return -Infinity;
  }
  // TimeDelta::Seconds(ato) / 1024 (integer microseconds).
  return Math.trunc((ato * 1000000) / 1024);
}

function to2BitEcn(ecnMarking: EcnMarking): number {
  switch (ecnMarking) {
    case EcnMarking.kNotEct:
      return 0;
    case EcnMarking.kEct1:
      return kEcnEct1 << 13;
    case EcnMarking.kEct0:
      return kEcnEct0 << 13;
    case EcnMarking.kCe:
      return kEcnCe << 13;
  }
}

function toEcnMarking(receiveInfo: number): EcnMarking {
  const ecn = (receiveInfo >> 13) & 0b11;
  if (ecn === kEcnEct1) {
    return EcnMarking.kEct1;
  }
  if (ecn === kEcnEct0) {
    return EcnMarking.kEct0;
  }
  if (ecn === kEcnCe) {
    return EcnMarking.kCe;
  }
  return EcnMarking.kNotEct;
}

export class CongestionControlPacketInfo {
  constructor(
    public ssrc = 0,
    public sequenceNumber = 0,
    //  Time offset from report timestamp. Minus infinity if the packet has not
    //  been received.
    public arrivalTimeOffset: TimeDelta = -Infinity,
    public ecn: EcnMarking = EcnMarking.kNotEct,
  ) {}

  received(): boolean {
    return this.arrivalTimeOffset !== -Infinity;
  }
}

export class CongestionControlFeedback extends Rtpfb {
  static readonly kFeedbackMessageType = 11;

  private packetsValue: CongestionControlPacketInfo[];
  private reportTimestampCompactNtpValue: number;

  // `Packets` MUST be sorted in sequence_number order per SSRC. There MUST not
  // be missing sequence numbers between `Packets`. `Packets` MUST not include
  // duplicate sequence numbers.
  constructor(packets: CongestionControlPacketInfo[] = [], reportTimestampCompactNtp = 0) {
    super();
    this.packetsValue = packets;
    this.reportTimestampCompactNtpValue = reportTimestampCompactNtp >>> 0;
  }

  parse(packet: CommonHeader): boolean {
    const data = packet.payload();
    let payload = 0;
    let payloadEnd = packet.payloadSizeBytes();

    if (packet.payloadSizeBytes() % 4 !== 0 || packet.payloadSizeBytes() < kSenderSsrcLength + kTimestampLength) {
      return false;
    }

    this.setSenderSsrc(ByteReader.u32(data, payload));
    payload += 4;

    this.reportTimestampCompactNtpValue = ByteReader.u32(data, payloadEnd - 4);
    payloadEnd -= 4;

    while (payload + kHeaderPerMediaSssrcLength < payloadEnd) {
      const ssrc = ByteReader.u32(data, payload);
      payload += 4;

      const baseSeqno = ByteReader.u16(data, payload);
      payload += 2;
      const numReports = ByteReader.u16(data, payload);
      payload += 2;

      const kPerPacketLength = 2;
      if (payload + kPerPacketLength * numReports > payloadEnd) {
        return false;
      }

      for (let i = 0; i < numReports; ++i) {
        const packetInfo = ByteReader.u16(data, payload);
        payload += 2;

        const seqNo = (baseSeqno + i) & 0xffff;
        const received = (packetInfo & 0x8000) !== 0;
        this.packetsValue.push(
          new CongestionControlPacketInfo(ssrc, seqNo, received ? atoToTimeDelta(packetInfo) : -Infinity, toEcnMarking(packetInfo)),
        );
      }
      if (numReports % 2) {
        // 2 bytes padding
        payload += 2;
      }
    }
    return payload === payloadEnd;
  }

  packets(): readonly CongestionControlPacketInfo[] {
    return this.packetsValue;
  }

  reportTimestampCompactNtp(): number {
    return this.reportTimestampCompactNtpValue;
  }

  create(buffer: Uint8Array, position: Index, maxLength: number, callback: PacketReadyCallback | null): boolean {
    // Ensure there is enough room for this packet.
    while (position.value + this.blockLength() > maxLength) {
      if (!this.onBufferFull(buffer, position, callback)) return false;
    }

    //   RTCP Header
    RtcpPacket.createHeader(CongestionControlFeedback.kFeedbackMessageType, Rtpfb.kPacketType, this.headerLength(), buffer, position);

    ByteWriter.u32(buffer, position.value, this.senderSsrc());
    position.value += 4;

    //   Report block
    const writeReportForSsrc = (packets: readonly CongestionControlPacketInfo[]) => {
      // SSRC of nth RTP stream.
      ByteWriter.u32(buffer, position.value, packets[0].ssrc);
      position.value += 4;

      // begin_seq
      ByteWriter.u16(buffer, position.value, packets[0].sequenceNumber);
      position.value += 2;
      // num_reports
      const numReports = packets.length & 0xffff;
      if (numReports > 16384) {
        // RTC_DCHECK_NOTREACHED: Unexpected number of reports.
        return;
      }
      ByteWriter.u16(buffer, position.value, numReports);
      position.value += 2;

      for (const packet of packets) {
        const received = Number.isFinite(packet.arrivalTimeOffset);
        let packetInfo = 0;
        if (received) {
          packetInfo = 0x8000 | to2BitEcn(packet.ecn) | to13bitAto(packet.arrivalTimeOffset);
        }
        ByteWriter.u16(buffer, position.value, packetInfo);
        position.value += 2;
      }
      // 32bit align per SSRC block.
      if (numReports % 2 !== 0) {
        ByteWriter.u16(buffer, position.value, 0);
        position.value += 2;
      }
    };

    let remaining = this.packetsValue;
    while (remaining.length !== 0) {
      let numberOfPacketsForSsrc = 0;
      const ssrc = remaining[0].ssrc;
      for (const packetInfo of remaining) {
        if (packetInfo.ssrc !== ssrc) {
          break;
        }
        ++numberOfPacketsForSsrc;
      }
      writeReportForSsrc(remaining.slice(0, numberOfPacketsForSsrc));
      remaining = remaining.slice(numberOfPacketsForSsrc);
    }

    // RTS
    ByteWriter.u32(buffer, position.value, this.reportTimestampCompactNtpValue);
    position.value += 4;

    return true;
  }

  blockLength(): number {
    // Total size of this packet
    let totalSize = kSenderSsrcLength + RtcpPacket.kHeaderLength + kTimestampLength;
    if (this.packetsValue.length === 0) {
      return totalSize;
    }

    const increaseSizePerSsrc = (numberOfPacketsForSsrc: number) => {
      // Each packet report needs two bytes.
      const packetBlockSize = numberOfPacketsForSsrc * 2;
      // 32 bit aligned.
      return kHeaderPerMediaSssrcLength + packetBlockSize + (numberOfPacketsForSsrc % 2 !== 0 ? 2 : 0);
    };

    let ssrc = this.packetsValue[0].ssrc;
    let firstSequenceNumber = this.packetsValue[0].sequenceNumber;
    for (let i = 0; i < this.packetsValue.length; ++i) {
      if (this.packetsValue[i].ssrc !== ssrc) {
        const numberOfPackets = (this.packetsValue[i - 1].sequenceNumber - firstSequenceNumber + 1) & 0xffff;
        totalSize += increaseSizePerSsrc(numberOfPackets);
        ssrc = this.packetsValue[i].ssrc;
        firstSequenceNumber = this.packetsValue[i].sequenceNumber;
      }
    }
    const numberOfPackets = (this.packetsValue[this.packetsValue.length - 1].sequenceNumber - firstSequenceNumber + 1) & 0xffff;
    totalSize += increaseSizePerSsrc(numberOfPackets);

    return totalSize;
  }
}
