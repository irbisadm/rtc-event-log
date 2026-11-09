// Port of logging/rtc_event_log/rtc_stream_config.h @ M154 (rtclog::StreamConfig).

import {RtcpMode} from "../../api/rtp-headers.js";
import type {RtpExtension} from "../../api/rtp-parameters.js";

export class StreamConfigCodec {
  constructor(
    public payloadName: string,
    public payloadType: number,
    public rtxPayloadType: number,
  ) {}

  equals(other: StreamConfigCodec): boolean {
    return (
      this.payloadName === other.payloadName &&
      this.payloadType === other.payloadType &&
      this.rtxPayloadType === other.rtxPayloadType
    );
  }
}

export class StreamConfig {
  localSsrc = 0;
  remoteSsrc = 0;
  rtxSsrc = 0;
  rsid = "";

  remb = false;
  rtpExtensions: RtpExtension[] = [];

  rtcpMode: RtcpMode = RtcpMode.kReducedSize;

  codecs: StreamConfigCodec[] = [];

  equals(other: StreamConfig): boolean {
    return (
      this.localSsrc === other.localSsrc &&
      this.remoteSsrc === other.remoteSsrc &&
      this.rtxSsrc === other.rtxSsrc &&
      this.rsid === other.rsid &&
      this.remb === other.remb &&
      this.rtcpMode === other.rtcpMode &&
      this.rtpExtensions.length === other.rtpExtensions.length &&
      this.rtpExtensions.every((e, i) => e.equals(other.rtpExtensions[i])) &&
      this.codecs.length === other.codecs.length &&
      this.codecs.every((c, i) => c.equals(other.codecs[i]))
    );
  }
}
