// Port of api/rtp_headers.h @ M154 (the fields the event log parser fills).

import {VideoRotation} from "./video/video-rotation.js";
import {Timestamp} from "./units/timestamp.js";

export class AudioLevel {
  constructor(
    private readonly voiceActivityValue = false,
    private readonly audioLevel = 0,
  ) {}

  // Flag indicating whether the encoder believes the audio packet contains
  // voice activity.
  voiceActivity(): boolean {
    return this.voiceActivityValue;
  }

  // Audio level in -dBov. Values range from 0 to 127, representing 0 to -127
  // dBov. 127 represents digital silence.
  level(): number {
    return this.audioLevel;
  }
}

export class RTPHeaderExtension {
  static readonly kAbsSendTimeFraction = 18;

  getAbsoluteSendTimestamp(): Timestamp {
    return Timestamp.micros(Math.trunc((this.absoluteSendTime * 1000000) / (1 << RTPHeaderExtension.kAbsSendTimeFraction)));
  }

  hasTransmissionTimeOffset = false;
  transmissionTimeOffset = 0;
  hasAbsoluteSendTime = false;
  absoluteSendTime = 0;

  hasTransportSequenceNumber = false;
  transportSequenceNumber = 0;

  private audioLevelValue: AudioLevel | undefined = undefined;

  audioLevel(): AudioLevel | undefined {
    return this.audioLevelValue;
  }

  setAudioLevel(audioLevel: AudioLevel | undefined): void {
    this.audioLevelValue = audioLevel;
  }

  // For Coordination of Video Orientation. See
  // http://www.etsi.org/deliver/etsi_ts/126100_126199/126114/12.07.00_60/
  // ts_126114v120700p.pdf
  hasVideoRotation = false;
  videoRotation: VideoRotation = VideoRotation.kVideoRotation_0;
}

export class RTPHeader {
  markerBit = false;
  payloadType = 0;
  sequenceNumber = 0;
  timestamp = 0;
  ssrc = 0;
  numCSRCs = 0;
  arrOfCSRCs: number[] = [];
  paddingLength = 0;
  headerLength = 0;
  extension = new RTPHeaderExtension();
}

export enum RtcpMode {
  kOff,
  kCompound,
  kReducedSize,
}
