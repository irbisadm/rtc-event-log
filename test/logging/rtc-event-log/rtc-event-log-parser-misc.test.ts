// Parser tests for the remaining event types of the new format: stream
// configs, audio playout, NetEq, ANA, DTLS, decoded frames, ICE.

import {IceCandidateType} from "../../../src/api/candidate.js";
import {DtlsTransportState} from "../../../src/api/dtls-transport-interface.js";
import {RtpExtension} from "../../../src/api/rtp-parameters.js";
import {VideoCodecType} from "../../../src/api/video/video-codec-type.js";
import {
  DtlsTransportStateEvent_DtlsTransportState as DtlsState,
  FrameDecodedEvents_Codec as Codec,
  IceCandidatePairConfig_AddressFamily as AddressFamily,
  IceCandidatePairConfig_IceCandidatePairConfigType as ConfigType,
  IceCandidatePairConfig_IceCandidateType as CandidateType,
  IceCandidatePairConfig_NetworkType as NetworkType,
  IceCandidatePairConfig_Protocol as Protocol,
  IceCandidatePairEvent_IceCandidatePairEventType as CheckType,
} from "../../../src/gen/rtc_event_log2_pb.js";
import {convertPacketLossFractionToProtoFormat} from "../../../src/logging/rtc-event-log/encoder/rtc-event-log-encoder-common.js";
import {
  IceCandidateNetworkType,
  IceCandidatePairAddressFamily,
  IceCandidatePairConfigType,
  IceCandidatePairProtocol,
} from "../../../src/logging/rtc-event-log/events/rtc-event-ice-candidate-pair-config.js";
import {IceCandidatePairEventType} from "../../../src/logging/rtc-event-log/events/rtc-event-ice-candidate-pair.js";
import {MediaType, PacketDirection, ParsedRtcEventLog} from "../../../src/logging/rtc-event-log/rtc-event-log-parser.js";
import {batchInit, concatBytes, eventStreamBytes} from "./new-format-builder.js";

function parse(log: Uint8Array): ParsedRtcEventLog {
  const parsed = new ParsedRtcEventLog();
  const status = parsed.parseString(log);
  if (!status.ok()) throw new Error(status.message());
  return parsed;
}

function parseError(log: Uint8Array): string {
  const status = new ParsedRtcEventLog().parseString(log);
  expect(status.ok()).toBe(false);
  return status.message();
}

describe("Stream configs", () => {
  const log = concatBytes(
    eventStreamBytes({
      videoRecvStreamConfigs: [
        {timestampMs: 1n, remoteSsrc: 100, localSsrc: 1, rtxSsrc: 101, headerExtensions: {transportSequenceNumberId: 5, videoRotationId: 4}},
      ],
    }),
    eventStreamBytes({videoSendStreamConfigs: [{timestampMs: 2n, ssrc: 200}]}),
    eventStreamBytes({
      audioRecvStreamConfigs: [{timestampMs: 3n, remoteSsrc: 300, localSsrc: 1, headerExtensions: {audioLevelId: 1, absoluteSendTimeId: 3}}],
    }),
    eventStreamBytes({
      audioSendStreamConfigs: [
        {timestampMs: 4n, ssrc: 400, headerExtensions: {transmissionTimeOffsetId: 2, dependencyDescriptorId: 0x109}},
      ],
    }),
  );

  test("ConfigsAndHeaderExtensions", () => {
    const parsed = parse(log);
    const videoRecv = parsed.videoRecvConfigs()[0];
    expect(videoRecv.logTimeMs()).toBe(1);
    expect([videoRecv.config.remoteSsrc, videoRecv.config.localSsrc, videoRecv.config.rtxSsrc]).toEqual([100, 1, 101]);
    // In the upstream (field) order, not the proto order.
    expect(videoRecv.config.rtpExtensions.map((e) => [e.uri, e.id])).toEqual([
      [RtpExtension.kTransportSequenceNumberUri, 5],
      [RtpExtension.kVideoRotationUri, 4],
    ]);
    expect(parsed.videoSendConfigs()[0].config.localSsrc).toBe(200);
    expect(parsed.videoSendConfigs()[0].config.rtxSsrc).toBe(0);
    expect(parsed.audioRecvConfigs()[0].config.rtpExtensions.map((e) => e.uri)).toEqual([
      RtpExtension.kAbsSendTimeUri,
      RtpExtension.kAudioLevelUri,
    ]);
    // RtpHeaderExtensionId stores a uint8_t.
    expect(parsed.audioSendConfigs()[0].config.rtpExtensions.map((e) => e.id)).toEqual([2, 9]);
  });

  test("ConfiguredSsrcs", () => {
    const parsed = parse(log);
    expect([...parsed.incomingVideoSsrcs()]).toEqual([100, 101]);
    expect([...parsed.incomingRtxSsrcs()]).toEqual([101]);
    // An unset rtx_ssrc (0) is inserted too, as upstream does.
    expect([...parsed.outgoingVideoSsrcs()]).toEqual([200, 0]);
    expect([...parsed.incomingAudioSsrcs()]).toEqual([300]);
    expect([...parsed.outgoingAudioSsrcs()]).toEqual([400]);
    expect(parsed.getMediaType(101, PacketDirection.kIncomingPacket)).toBe(MediaType.VIDEO);
    expect(parsed.getMediaType(300, PacketDirection.kIncomingPacket)).toBe(MediaType.AUDIO);
    expect(parsed.getMediaType(300, PacketDirection.kOutgoingPacket)).toBe(MediaType.ANY);
    expect(parsed.getMediaType(400, PacketDirection.kOutgoingPacket)).toBe(MediaType.AUDIO);
  });

  test("MissingSsrc", () => {
    expect(parseError(eventStreamBytes({videoSendStreamConfigs: [{timestampMs: 2n}]}))).toBe("proto.has_ssrc()");
  });
});

describe("Audio events", () => {
  test("AudioPlayoutGroupedBySsrc", () => {
    const parsed = parse(eventStreamBytes({audioPlayoutEvents: [batchInit([10, 20, 30, 40], {localSsrc: [7, 3, 7, 3]})]}));
    const events = parsed.audioPlayoutEvents();
    expect([...events.keys()]).toEqual([3, 7]); // std::map order
    expect(events.get(7)!.map((e) => e.logTimeMs())).toEqual([10, 30]);
    expect(events.get(3)!.map((e) => e.ssrc)).toEqual([3, 3]);
    expect(parsed.firstTimestamp()).toBe(10_000);
    expect(parsed.lastTimestamp()).toBe(40_000);
  });

  test("NetEqSetMinimumDelay", () => {
    const parsed = parse(
      eventStreamBytes({
        neteqSetMinimumDelay: [batchInit([1, 2, 3], {remoteSsrc: [5, 5, 6], minimumDelayMs: [100, -20, 0]}, {minimumDelayMs: 32})],
      }),
    );
    const events = parsed.neteqSetMinimumDelayEvents();
    expect(events.get(5)!.map((e) => e.minimumDelayMs)).toEqual([100, -20]);
    expect(events.get(6)![0].remoteSsrc).toBe(6);
  });

  test("AudioNetworkAdaptation", () => {
    const fractions = [0.5, undefined, 0.1].map((f) => (f === undefined ? undefined : convertPacketLossFractionToProtoFormat(f)));
    const numChannels = [2, 1, undefined];
    const init = batchInit(
      [1, 2, 3],
      {
        bitrateBps: [32000, -1, undefined],
        frameLengthMs: [20, 60, 20],
        uplinkPacketLossFraction: fractions,
        enableFec: [true, false, undefined],
        enableDtx: [undefined, true, true],
        numChannels,
      },
      {bitrateBps: 32, frameLengthMs: 32},
    );
    // The encoder delta encodes num_channels - 1.
    init.numChannelsDeltas = batchInit([1, 2, 3], {x: numChannels.map((n) => (n === undefined ? undefined : n - 1))}).xDeltas;
    const parsed = parse(eventStreamBytes({audioNetworkAdaptations: [init]}));
    const configs = parsed.audioNetworkAdaptationEvents().map((e) => e.config);
    expect(configs.map((c) => c.bitrateBps)).toEqual([32000, -1, undefined]);
    expect(configs.map((c) => c.frameLengthMs)).toEqual([20, 60, 20]);
    expect(configs[0].uplinkPacketLossFraction).toBe(Math.fround(8191 / 16383));
    expect(configs[1].uplinkPacketLossFraction).toBeUndefined();
    expect(configs[2].uplinkPacketLossFraction).toBe(Math.fround(1638 / 16383));
    expect(configs.map((c) => c.enableFec)).toEqual([true, false, undefined]);
    expect(configs.map((c) => c.enableDtx)).toEqual([undefined, true, true]);
    expect(configs.map((c) => c.numChannels)).toEqual([2, 1, undefined]);
  });

  test("AudioNetworkAdaptationRejectsOutOfRangeLossFraction", () => {
    const log = eventStreamBytes({audioNetworkAdaptations: [{timestampMs: 1n, uplinkPacketLossFraction: 0x3fff}]});
    expect(parseError(log)).toMatch(/^ParsePacketLossFractionFromProtoFormat/);
  });
});

describe("Video and transport events", () => {
  test("FrameDecoded", () => {
    const parsed = parse(
      eventStreamBytes({
        frameDecodedEvents: [
          batchInit(
            [100, 133, 166],
            {
              ssrc: [9, 9, 9],
              renderTimeMs: [150n, 183n, 216n],
              width: [1280, 1280, 640],
              height: [720, 720, 360],
              codec: [Codec.VP8, Codec.AV1, Codec.UNKNOWN],
              qp: [30, 40, 255],
            },
            {renderTimeMs: 64, width: 32, height: 32},
          ),
        ],
      }),
    );
    const frames = parsed.decodedFrames().get(9)!;
    expect(frames.map((f) => f.renderTimeMs)).toEqual([150n, 183n, 216n]);
    expect(frames.map((f) => [f.width, f.height])).toEqual([
      [1280, 720],
      [1280, 720],
      [640, 360],
    ]);
    expect(frames.map((f) => f.codec)).toEqual([VideoCodecType.kVideoCodecVP8, VideoCodecType.kVideoCodecAV1, VideoCodecType.kVideoCodecGeneric]);
    expect(frames.map((f) => f.qp)).toEqual([30, 40, 255]);
  });

  test("FrameDecodedRejectsLargeQp", () => {
    const frame = {timestampMs: 1n, ssrc: 1, renderTimeMs: 1n, width: 1, height: 1, codec: Codec.VP8, qp: 256};
    expect(parseError(eventStreamBytes({frameDecodedEvents: [frame]}))).toBe("proto.qp()<=255");
  });

  test("Dtls", () => {
    const parsed = parse(
      concatBytes(
        eventStreamBytes({dtlsTransportStateEvents: [{timestampMs: 1n, dtlsTransportState: DtlsState.DTLS_TRANSPORT_CONNECTING}]}),
        eventStreamBytes({dtlsTransportStateEvents: [{timestampMs: 2n, dtlsTransportState: DtlsState.UNKNOWN_DTLS_TRANSPORT_STATE}]}),
        eventStreamBytes({dtlsWritableStates: [{timestampMs: 3n, writable: true}]}),
      ),
    );
    expect(parsed.dtlsTransportStates().map((s) => s.dtlsTransportState)).toEqual([
      DtlsTransportState.kConnecting,
      DtlsTransportState.kNumValues,
    ]);
    expect(parsed.dtlsWritableStates()[0].writable).toBe(true);
  });

  test("GenericPacketsAreIgnored", () => {
    const parsed = parse(
      concatBytes(
        eventStreamBytes({genericPacketsSent: [{timestampMs: 1n, packetNumber: 1n, overheadLength: 1, payloadLength: 1, paddingLength: 0}]}),
        eventStreamBytes({dtlsWritableStates: [{timestampMs: 3n, writable: false}]}),
      ),
    );
    expect(parsed.dtlsWritableStates()).toHaveLength(1);
  });
});

describe("ICE", () => {
  const config = (timestampMs: bigint, id: number, type: ConfigType, remote: CandidateType, family: AddressFamily) => ({
    timestampMs,
    configType: type,
    candidatePairId: id,
    localCandidateType: CandidateType.LOCAL,
    localRelayProtocol: Protocol.UNKNOWN_PROTOCOL,
    localNetworkType: NetworkType.WIFI,
    localAddressFamily: AddressFamily.IPV4,
    remoteCandidateType: remote,
    remoteAddressFamily: family,
    candidatePairProtocol: Protocol.UDP,
  });

  test("CandidatePairsRouteChangesAndChecks", () => {
    const parsed = parse(
      concatBytes(
        eventStreamBytes({iceCandidateConfigs: [config(1n, 1, ConfigType.ADDED, CandidateType.LOCAL, AddressFamily.IPV4)]}),
        eventStreamBytes({iceCandidateConfigs: [config(2n, 2, ConfigType.ADDED, CandidateType.RELAY, AddressFamily.IPV6)]}),
        eventStreamBytes({iceCandidateConfigs: [config(3n, 1, ConfigType.SELECTED, CandidateType.LOCAL, AddressFamily.IPV4)]}),
        eventStreamBytes({iceCandidateConfigs: [config(4n, 2, ConfigType.SELECTED, CandidateType.RELAY, AddressFamily.IPV6)]}),
        eventStreamBytes({iceCandidateEvents: [{timestampMs: 5n, eventType: CheckType.CHECK_RESPONSE_RECEIVED, candidatePairId: 2, transactionId: 77}]}),
        eventStreamBytes({iceCandidateEvents: [{timestampMs: 6n, eventType: CheckType.CHECK_SENT, candidatePairId: 2}]}),
      ),
    );
    const configs = parsed.iceCandidatePairConfigs();
    expect(configs).toHaveLength(4);
    expect(configs[0].localNetworkType).toBe(IceCandidateNetworkType.kWifi);
    expect(configs[1].remoteCandidateType).toBe(IceCandidateType.kRelay);
    expect(configs[1].remoteAddressFamily).toBe(IceCandidatePairAddressFamily.kIpv6);
    expect(configs[1].candidatePairProtocol).toBe(IceCandidatePairProtocol.kUdp);
    expect(configs[2].type).toBe(IceCandidatePairConfigType.kSelected);

    expect(parsed.getIceCandidates().map((c) => c.logTimeMs())).toEqual([1, 2]);

    const routes = parsed.getRouteChanges();
    expect(routes.map((r) => [r.routeId, r.logTimeMs(), r.sendOverhead, r.returnOverhead])).toEqual([
      [1, 3, 38, 38],
      [2, 4, 38 + 20 + 4, 38 + 20 + 4],
    ]);

    expect(parsed.iceCandidatePairEvents().map((e) => [e.type, e.transactionId])).toEqual([
      [IceCandidatePairEventType.kCheckResponseReceived, 77],
      [IceCandidatePairEventType.kCheckSent, 0],
    ]);
  });

  test("UnknownCandidateTypeIsRejected", () => {
    const log = eventStreamBytes({
      iceCandidateConfigs: [config(1n, 1, ConfigType.ADDED, CandidateType.UNKNOWN_CANDIDATE_TYPE, AddressFamily.IPV4)],
    });
    expect(parseError(log)).toBe("GetRuntimeIceCandidateType(proto.remote_candidate_type(), ice_config.remote_candidate_type)");
  });
});
