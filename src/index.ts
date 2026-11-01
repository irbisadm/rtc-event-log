// rtc-event-log: parser for WebRTC RtcEventLog files (new format,
// logging/rtc_event_log/rtc_event_log2.proto), ported from libwebrtc.
import {fromBinary} from "@bufbuild/protobuf";
import {EventStreamSchema, type EventStream} from "./gen/rtc_event_log2_pb.js";

export type {EventStream} from "./gen/rtc_event_log2_pb.js";

// Decodes only the protobuf layer of a new-format event log; batched fields
// stay delta encoded. ParsedRtcEventLog gives the typed events.
export function decodeEventStream(bytes: Uint8Array): EventStream {
  return fromBinary(EventStreamSchema, bytes);
}

export {
  getRuntimeCodecType,
  getRuntimeDetectorState,
  getRuntimeDtlsTransportState,
  getRuntimeIceCandidatePairAddressFamily,
  getRuntimeIceCandidatePairConfigType,
  getRuntimeIceCandidatePairEventType,
  getRuntimeIceCandidatePairProtocol,
  getRuntimeIceCandidateNetworkType,
  getRuntimeIceCandidateType,
  getRuntimeProbeFailureReason,
  getRuntimeRtpHeaderExtensionConfig,
  InferredRouteChangeEvent,
  LoggedIceEvent,
  LoggedIceEventType,
  LoggedMediaType,
  LoggedPacketInfo,
  LoggedRtpStreamIncoming,
  LoggedRtpStreamOutgoing,
  LoggedRtpStreamView,
  LogSegment,
  MediaType,
  PacketDirection,
  ParsedRtcEventLog,
  type ParseStatus,
  UnconfiguredHeaderExtensions,
} from "./logging/rtc-event-log/rtc-event-log-parser.js";
export {RtcEventLogParseStatus} from "./logging/rtc-event-log/events/rtc-event-log-parse-status.js";
export * from "./logging/rtc-event-log/events/logged-rtp-rtcp.js";
export {LoggedStartEvent} from "./logging/rtc-event-log/events/rtc-event-begin-log.js";
export {LoggedStopEvent} from "./logging/rtc-event-log/events/rtc-event-end-log.js";
export {LoggedEvent} from "./logging/rtc-event-log/events/logged-event.js";
export {LoggedAlrStateEvent} from "./logging/rtc-event-log/events/rtc-event-alr-state.js";
export {LoggedRouteChangeEvent} from "./logging/rtc-event-log/events/rtc-event-route-change.js";
export {LoggedRemoteEstimateEvent} from "./logging/rtc-event-log/events/rtc-event-remote-estimate.js";
export {LoggedBweDelayBasedUpdate} from "./logging/rtc-event-log/events/rtc-event-bwe-update-delay-based.js";
export {LoggedBweLossBasedUpdate} from "./logging/rtc-event-log/events/rtc-event-bwe-update-loss-based.js";
export {LoggedBweScreamUpdate} from "./logging/rtc-event-log/events/rtc-event-bwe-update-scream.js";
export {LoggedBweProbeClusterCreatedEvent} from "./logging/rtc-event-log/events/rtc-event-probe-cluster-created.js";
export {LoggedBweProbeSuccessEvent} from "./logging/rtc-event-log/events/rtc-event-probe-result-success.js";
export {
  LoggedBweProbeFailureEvent,
  ProbeFailureReason,
} from "./logging/rtc-event-log/events/rtc-event-probe-result-failure.js";
export {LoggedAudioPlayoutEvent} from "./logging/rtc-event-log/events/rtc-event-audio-playout.js";
export {LoggedNetEqSetMinimumDelayEvent} from "./logging/rtc-event-log/events/rtc-event-neteq-set-minimum-delay.js";
export {LoggedAudioNetworkAdaptationEvent} from "./logging/rtc-event-log/events/rtc-event-audio-network-adaptation.js";
export {LoggedDtlsTransportState} from "./logging/rtc-event-log/events/rtc-event-dtls-transport-state.js";
export {LoggedDtlsWritableState} from "./logging/rtc-event-log/events/rtc-event-dtls-writable-state.js";
export {LoggedFrameDecoded} from "./logging/rtc-event-log/events/rtc-event-frame-decoded.js";
export * from "./logging/rtc-event-log/events/rtc-event-ice-candidate-pair-config.js";
export * from "./logging/rtc-event-log/events/rtc-event-ice-candidate-pair.js";
export {LoggedAudioRecvConfig} from "./logging/rtc-event-log/events/rtc-event-audio-receive-stream-config.js";
export {LoggedAudioSendConfig} from "./logging/rtc-event-log/events/rtc-event-audio-send-stream-config.js";
export {LoggedVideoRecvConfig} from "./logging/rtc-event-log/events/rtc-event-video-receive-stream-config.js";
export {LoggedVideoSendConfig} from "./logging/rtc-event-log/events/rtc-event-video-send-stream-config.js";
export {StreamConfig, StreamConfigCodec} from "./logging/rtc-event-log/rtc-stream-config.js";
export {AudioEncoderRuntimeConfig} from "./modules/audio-coding/audio-network-adaptor/include/audio-network-adaptor-config.js";
export {BandwidthUsage} from "./api/transport/bandwidth-usage.js";
export {IceCandidateType} from "./api/candidate.js";
export {DtlsTransportState} from "./api/dtls-transport-interface.js";
export {RtpExtension} from "./api/rtp-parameters.js";
export {VideoCodecType} from "./api/video/video-codec-type.js";
export {AudioLevel, RTPHeader, RTPHeaderExtension, RtcpMode} from "./api/rtp-headers.js";
export {VideoRotation} from "./api/video/video-rotation.js";
export {Timestamp} from "./api/units/timestamp.js";
export {TimeDelta} from "./api/units/time-delta.js";
export {DataRate} from "./api/units/data-rate.js";
export {DataSize} from "./api/units/data-size.js";
export {RtcEventProcessor} from "./logging/rtc-event-log/rtc-event-processor.js";
export {TypeOrder} from "./logging/rtc-event-log/rtc-event-processor-order.js";
export {EcnMarking} from "./api/transport/ecn-marking.js";
export {NtpTime} from "./system-wrappers/include/ntp-time.js";
export {CommonHeader} from "./modules/rtp-rtcp/source/rtcp-packet/common-header.js";
export {RtcpPacket} from "./modules/rtp-rtcp/source/rtcp-packet.js";
export {ReportBlock} from "./modules/rtp-rtcp/source/rtcp-packet/report-block.js";
export {SenderReport} from "./modules/rtp-rtcp/source/rtcp-packet/sender-report.js";
export {ReceiverReport} from "./modules/rtp-rtcp/source/rtcp-packet/receiver-report.js";
export {ExtendedReports} from "./modules/rtp-rtcp/source/rtcp-packet/extended-reports.js";
export {Rrtr} from "./modules/rtp-rtcp/source/rtcp-packet/rrtr.js";
export {Dlrr, ReceiveTimeInfo} from "./modules/rtp-rtcp/source/rtcp-packet/dlrr.js";
export {BitrateItem, TargetBitrate} from "./modules/rtp-rtcp/source/rtcp-packet/target-bitrate.js";
export {Bye} from "./modules/rtp-rtcp/source/rtcp-packet/bye.js";
export {Rtpfb} from "./modules/rtp-rtcp/source/rtcp-packet/rtpfb.js";
export {Psfb} from "./modules/rtp-rtcp/source/rtcp-packet/psfb.js";
export {Nack} from "./modules/rtp-rtcp/source/rtcp-packet/nack.js";
export {Pli} from "./modules/rtp-rtcp/source/rtcp-packet/pli.js";
export {Fir, FirRequest} from "./modules/rtp-rtcp/source/rtcp-packet/fir.js";
export {Remb} from "./modules/rtp-rtcp/source/rtcp-packet/remb.js";
export {LossNotification} from "./modules/rtp-rtcp/source/rtcp-packet/loss-notification.js";
export {ReceivedPacket, TransportFeedback} from "./modules/rtp-rtcp/source/rtcp-packet/transport-feedback.js";
export {
  CongestionControlFeedback,
  CongestionControlPacketInfo,
} from "./modules/rtp-rtcp/source/rtcp-packet/congestion-control-feedback.js";
