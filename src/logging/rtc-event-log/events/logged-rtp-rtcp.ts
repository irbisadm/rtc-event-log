// Port of logging/rtc_event_log/events/logged_rtp_rtcp.h @ M154.

import type {RTPHeader} from "../../../api/rtp-headers.js";
import {Timestamp} from "../../../api/units/timestamp.js";
import {Bye} from "../../../modules/rtp-rtcp/source/rtcp-packet/bye.js";
import type {CongestionControlFeedback} from "../../../modules/rtp-rtcp/source/rtcp-packet/congestion-control-feedback.js";
import {ExtendedReports} from "../../../modules/rtp-rtcp/source/rtcp-packet/extended-reports.js";
import {Fir} from "../../../modules/rtp-rtcp/source/rtcp-packet/fir.js";
import {LossNotification} from "../../../modules/rtp-rtcp/source/rtcp-packet/loss-notification.js";
import {Nack} from "../../../modules/rtp-rtcp/source/rtcp-packet/nack.js";
import {Pli} from "../../../modules/rtp-rtcp/source/rtcp-packet/pli.js";
import {ReceiverReport} from "../../../modules/rtp-rtcp/source/rtcp-packet/receiver-report.js";
import {Remb} from "../../../modules/rtp-rtcp/source/rtcp-packet/remb.js";
import {SenderReport} from "../../../modules/rtp-rtcp/source/rtcp-packet/sender-report.js";
import {TransportFeedback} from "../../../modules/rtp-rtcp/source/rtcp-packet/transport-feedback.js";

export class LoggedRtpPacket {
  // RTPHeader::extension is a mess, save DD wire format instead.
  dependencyDescriptorWireFormat: Uint8Array = new Uint8Array(0);
  // RTX OSN, only set for RTX packets.
  // https://datatracker.ietf.org/doc/html/rfc4588#section-4
  rtxOriginalSequenceNumber: number | undefined = undefined;

  constructor(
    public timestamp: Timestamp,
    public header: RTPHeader,
    public headerLength: number,
    public totalLength: number,
  ) {}

  logTimeUs(): number {
    return Timestamp.us(this.timestamp);
  }
  logTimeMs(): number {
    return Timestamp.ms(this.timestamp);
  }
  logTime(): Timestamp {
    return this.timestamp;
  }
}

export class LoggedRtpPacketIncoming {
  rtp: LoggedRtpPacket;

  constructor(timestamp: Timestamp, header: RTPHeader, headerLength: number, totalLength: number) {
    this.rtp = new LoggedRtpPacket(timestamp, header, headerLength, totalLength);
  }

  logTimeUs(): number {
    return Timestamp.us(this.rtp.timestamp);
  }
  logTimeMs(): number {
    return Timestamp.ms(this.rtp.timestamp);
  }
  logTime(): Timestamp {
    return this.rtp.timestamp;
  }
}

export class LoggedRtpPacketOutgoing {
  rtp: LoggedRtpPacket;

  constructor(timestamp: Timestamp, header: RTPHeader, headerLength: number, totalLength: number) {
    this.rtp = new LoggedRtpPacket(timestamp, header, headerLength, totalLength);
  }

  logTimeUs(): number {
    return Timestamp.us(this.rtp.timestamp);
  }
  logTimeMs(): number {
    return Timestamp.ms(this.rtp.timestamp);
  }
  logTime(): Timestamp {
    return this.rtp.timestamp;
  }
}

export class LoggedRtcpPacket {
  // The packet bytes (a copy, as upstream).
  rawData: Uint8Array;

  constructor(
    public timestamp: Timestamp,
    packet: Uint8Array,
  ) {
    this.rawData = packet.slice();
  }

  logTimeUs(): number {
    return Timestamp.us(this.timestamp);
  }
  logTimeMs(): number {
    return Timestamp.ms(this.timestamp);
  }
  logTime(): Timestamp {
    return this.timestamp;
  }
}

export class LoggedRtcpPacketIncoming {
  rtcp: LoggedRtcpPacket;

  constructor(timestamp: Timestamp, packet: Uint8Array) {
    this.rtcp = new LoggedRtcpPacket(timestamp, packet);
  }

  logTimeUs(): number {
    return Timestamp.us(this.rtcp.timestamp);
  }
  logTimeMs(): number {
    return Timestamp.ms(this.rtcp.timestamp);
  }
  logTime(): Timestamp {
    return this.rtcp.timestamp;
  }
}

export class LoggedRtcpPacketOutgoing {
  rtcp: LoggedRtcpPacket;

  constructor(timestamp: Timestamp, packet: Uint8Array) {
    this.rtcp = new LoggedRtcpPacket(timestamp, packet);
  }

  logTimeUs(): number {
    return Timestamp.us(this.rtcp.timestamp);
  }
  logTimeMs(): number {
    return Timestamp.ms(this.rtcp.timestamp);
  }
  logTime(): Timestamp {
    return this.rtcp.timestamp;
  }
}

// Parsed RTCP blocks (StoreRtcpBlocks). Each carries the log time of the
// RTCP packet it came from.

class LoggedRtcpBlock {
  constructor(public timestamp: Timestamp = Timestamp.minusInfinity()) {}

  logTimeUs(): number {
    return Timestamp.us(this.timestamp);
  }
  logTimeMs(): number {
    return Timestamp.ms(this.timestamp);
  }
  logTime(): Timestamp {
    return this.timestamp;
  }
}

export class LoggedRtcpPacketReceiverReport extends LoggedRtcpBlock {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public rr: ReceiverReport = new ReceiverReport(),
  ) {
    super(timestamp);
  }
}

export class LoggedRtcpPacketSenderReport extends LoggedRtcpBlock {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public sr: SenderReport = new SenderReport(),
  ) {
    super(timestamp);
  }
}

export class LoggedRtcpPacketExtendedReports extends LoggedRtcpBlock {
  xr = new ExtendedReports();
}

export class LoggedRtcpPacketRemb extends LoggedRtcpBlock {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public remb: Remb = new Remb(),
  ) {
    super(timestamp);
  }
}

export class LoggedRtcpPacketNack extends LoggedRtcpBlock {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public nack: Nack = new Nack(),
  ) {
    super(timestamp);
  }
}

export class LoggedRtcpPacketFir extends LoggedRtcpBlock {
  fir = new Fir();
}

export class LoggedRtcpPacketPli extends LoggedRtcpBlock {
  pli = new Pli();
}

export class LoggedRtcpPacketTransportFeedback extends LoggedRtcpBlock {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public transportFeedback: TransportFeedback = new TransportFeedback(/*include_timestamps=*/ true),
  ) {
    super(timestamp);
  }
}

export class LoggedRtcpCongestionControlFeedback extends LoggedRtcpBlock {
  constructor(
    timestamp: Timestamp,
    public congestionFeedback: CongestionControlFeedback,
  ) {
    super(timestamp);
  }
}

export class LoggedRtcpPacketLossNotification extends LoggedRtcpBlock {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public lossNotification: LossNotification = new LossNotification(),
  ) {
    super(timestamp);
  }
}

export class LoggedRtcpPacketBye extends LoggedRtcpBlock {
  bye = new Bye();
}
