// Port of modules/rtp_rtcp/include/rtp_header_extension_map.h @ M154.
//
// Extension types are identified by their URI (upstream: RTPExtensionType,
// registered through the URI). All known extensions take part in
// registration, so id conflicts resolve as upstream, even for extensions this
// package does not parse.

import {RtpExtension} from "../../../api/rtp-parameters.js";

// kExtensions in rtp_header_extension_map.cc, in RTPExtensionType order.
const kKnownExtensionUris: readonly string[] = [
  RtpExtension.kTimestampOffsetUri,
  RtpExtension.kAudioLevelUri,
  RtpExtension.kCsrcAudioLevelsUri,
  RtpExtension.kAbsSendTimeUri,
  RtpExtension.kAbsoluteCaptureTimeUri,
  RtpExtension.kVideoRotationUri,
  RtpExtension.kTransportSequenceNumberUri,
  RtpExtension.kTransportSequenceNumberV2Uri,
  RtpExtension.kPlayoutDelayUri,
  RtpExtension.kVideoContentTypeUri,
  RtpExtension.kVideoLayersAllocationUri,
  RtpExtension.kVideoTimingUri,
  RtpExtension.kRidUri,
  RtpExtension.kRepairedRidUri,
  RtpExtension.kMidUri,
  RtpExtension.kGenericFrameDescriptorUri00,
  RtpExtension.kDependencyDescriptorUri,
  RtpExtension.kColorSpaceUri,
  "http://www.webrtc.org/experiments/rtp-hdrext/inband-cn",
  RtpExtension.kVideoFrameTrackingIdUri,
  RtpExtension.kCorruptionDetectionUri,
];

// RtpHeaderExtensionId::kInvalidId / NotSet.
const kInvalidId = 0;

export class RtpHeaderExtensionMap {
  // uri -> id (only registered extensions).
  private ids = new Map<string, number>();

  constructor(extensions: readonly RtpExtension[] = []) {
    for (const extension of extensions) this.registerByUri(extension.id, extension.uri);
  }

  // The map ParsedRtcEventLog uses for streams without a logged mapping.
  static defaultHeaderExtensionMap(): RtpHeaderExtensionMap {
    // Values from before the default RTP header extension IDs were removed.
    const map = new RtpHeaderExtensionMap();
    map.registerByUri(1, RtpExtension.kAudioLevelUri);
    map.registerByUri(2, RtpExtension.kTimestampOffsetUri);
    map.registerByUri(3, RtpExtension.kAbsSendTimeUri);
    map.registerByUri(4, RtpExtension.kVideoRotationUri);
    map.registerByUri(5, RtpExtension.kTransportSequenceNumberUri);
    map.registerByUri(6, RtpExtension.kPlayoutDelayUri);
    map.registerByUri(7, RtpExtension.kVideoContentTypeUri);
    map.registerByUri(8, RtpExtension.kVideoTimingUri);
    map.registerByUri(9, RtpExtension.kDependencyDescriptorUri);
    return map;
  }

  registerByUri(id: number, uri: string): boolean {
    if (!kKnownExtensionUris.includes(uri)) return false;
    return this.register(id & 0xff, uri);
  }

  // GetId(type) by URI; kInvalidId when not registered.
  getId(uri: string): number {
    return this.ids.get(uri) ?? kInvalidId;
  }

  // GetType(id) as the URI; undefined for kInvalidType.
  getType(id: number): string | undefined {
    for (const uri of kKnownExtensionUris) {
      if (this.ids.get(uri) === id) return uri;
    }
    return undefined;
  }

  deregister(uri: string): void {
    this.ids.delete(uri);
  }

  isRegistered(uri: string): boolean {
    return this.ids.has(uri);
  }

  clone(): RtpHeaderExtensionMap {
    const copy = new RtpHeaderExtensionMap();
    copy.ids = new Map(this.ids);
    return copy;
  }

  private register(id: number, uri: string): boolean {
    // RtpHeaderExtensionId::Valid(): 1..255.
    if (id < 1 || id > 255) {
      return false;
    }
    const registeredType = this.getType(id);
    if (registeredType === uri) {
      // Same type/id pair already registered.
      return true;
    }
    if (registeredType !== undefined) {
      // `id` used by another extension type.
      return false;
    }
    if (this.isRegistered(uri)) {
      return false;
    }
    this.ids.set(uri, id);
    return true;
  }
}
