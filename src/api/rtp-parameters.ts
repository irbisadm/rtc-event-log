// Port of api/rtp_parameters.h @ M154 (RtpExtension; the header extension
// URIs the event log uses).

export class RtpExtension {
  static readonly kAudioLevelUri = "urn:ietf:params:rtp-hdrext:ssrc-audio-level";
  static readonly kTimestampOffsetUri = "urn:ietf:params:rtp-hdrext:toffset";
  static readonly kAbsSendTimeUri = "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time";
  static readonly kAbsoluteCaptureTimeUri = "http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time";
  static readonly kVideoRotationUri = "urn:3gpp:video-orientation";
  static readonly kVideoContentTypeUri = "http://www.webrtc.org/experiments/rtp-hdrext/video-content-type";
  static readonly kVideoTimingUri = "http://www.webrtc.org/experiments/rtp-hdrext/video-timing";
  static readonly kDependencyDescriptorUri =
    "https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension";
  static readonly kTransportSequenceNumberUri =
    "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01";
  static readonly kTransportSequenceNumberV2Uri = "http://www.webrtc.org/experiments/rtp-hdrext/transport-wide-cc-02";
  static readonly kPlayoutDelayUri = "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay";
  static readonly kMidUri = "urn:ietf:params:rtp-hdrext:sdes:mid";
  static readonly kRidUri = "urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id";
  static readonly kRepairedRidUri = "urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id";
  static readonly kGenericFrameDescriptorUri00 = "http://www.webrtc.org/experiments/rtp-hdrext/generic-frame-descriptor-00";
  static readonly kVideoLayersAllocationUri = "http://www.webrtc.org/experiments/rtp-hdrext/video-layers-allocation00";
  static readonly kColorSpaceUri = "http://www.webrtc.org/experiments/rtp-hdrext/color-space";
  static readonly kVideoFrameTrackingIdUri = "http://www.webrtc.org/experiments/rtp-hdrext/video-frame-tracking-id";
  static readonly kCsrcAudioLevelsUri = "urn:ietf:params:rtp-hdrext:csrc-audio-level";
  static readonly kCorruptionDetectionUri = "http://www.webrtc.org/experiments/rtp-hdrext/corruption-detection";

  constructor(
    public uri = "",
    // RtpHeaderExtensionId: the value is stored as uint8_t.
    public id = 0,
    public encrypt = false,
  ) {
    this.id = id & 0xff;
  }

  equals(rhs: RtpExtension): boolean {
    return this.uri === rhs.uri && this.id === rhs.id && this.encrypt === rhs.encrypt;
  }

  toString(): string {
    return `{uri: ${this.uri}, id: ${this.id}${this.encrypt ? ", encrypt" : ""}}`;
  }
}
