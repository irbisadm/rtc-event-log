// Port of logging/rtc_event_log/events/logged_rtp_rtcp.h @ M154.
//
// RTP packets and raw RTCP packets. The typed RTCP blocks (SR, RR, REMB,
// transport feedback, ...) are added with the RTCP packet parsing.

import type {RTPHeader} from "../../../api/rtp-headers.js";
import {Timestamp} from "../../../api/units/timestamp.js";

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
