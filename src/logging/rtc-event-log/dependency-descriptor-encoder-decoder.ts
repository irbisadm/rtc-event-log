// Port of logging/rtc_event_log/dependency_descriptor_encoder_decoder.h @ M154.

import {create} from "@bufbuild/protobuf";

import {
  type DependencyDescriptorsWireInfo,
  DependencyDescriptorsWireInfoSchema,
} from "../../gen/rtc_event_log2_pb.js";
import {has} from "../../proto/presence.js";
import {decodeDeltas, encodeDeltas, type OptionalU64} from "./encoder/delta-encoding.js";
import {decodeOptionalBlobs, encodeOptionalBlobs} from "./encoder/optional-blob-encoding.js";
import {RtcEventLogParseStatus, RtcEventLogParseStatusOr} from "./events/rtc-event-log-parse-status.js";

export const RtcEventLogDependencyDescriptorEncoderDecoder = {
  // Returns undefined when there is nothing to encode or a descriptor is
  // shorter than its 3 mandatory bytes. An empty entry means "no descriptor".
  encode(rawDdData: readonly Uint8Array[]): DependencyDescriptorsWireInfo | undefined {
    if (rawDdData.length === 0) {
      return undefined;
    }

    for (const dd of rawDdData) {
      if (dd.length !== 0 && dd.length < 3) {
        return undefined;
      }
    }

    const res = create(DependencyDescriptorsWireInfoSchema);
    const baseDd = rawDdData[0];
    const deltaDds = rawDdData.slice(1);

    const encodeField = (
      extract: (dd: Uint8Array) => number,
      setBase: (value: number) => void,
      setDeltas: (deltas: Uint8Array) => void,
    ) => {
      let base: number | undefined;
      if (baseDd.length !== 0) {
        base = extract(baseDd);
        setBase(base);
      }
      if (deltaDds.length !== 0) {
        const values: OptionalU64[] = deltaDds.map((dd) => (dd.length !== 0 ? BigInt(extract(dd)) : undefined));
        const encodedDeltas = encodeDeltas(base === undefined ? undefined : BigInt(base), values);
        if (encodedDeltas.length !== 0) {
          setDeltas(encodedDeltas);
        }
      }
    };

    // Start and end bit.
    encodeField(
      (dd) => dd[0] >> 6,
      (v) => (res.startEndBit = v),
      (d) => (res.startEndBitDeltas = d),
    );
    // Template IDs.
    encodeField(
      (dd) => dd[0] & 0b0011_1111,
      (v) => (res.templateId = v),
      (d) => (res.templateIdDeltas = d),
    );
    // Frame IDs.
    encodeField(
      (dd) => (dd[1] << 8) + dd[2],
      (v) => (res.frameId = v),
      (d) => (res.frameIdDeltas = d),
    );

    // Extended info
    {
      const values = rawDdData.map((dd) => (dd.length > 3 ? dd.subarray(3) : undefined));
      const encodedBlobs = encodeOptionalBlobs(values);
      if (encodedBlobs.length !== 0) {
        res.extendedInfos = encodedBlobs;
      }
    }

    return res;
  },

  decode(ddWireInfo: DependencyDescriptorsWireInfo, numPackets: number): RtcEventLogParseStatusOr<Uint8Array[]> {
    if (numPackets === 0) {
      return RtcEventLogParseStatusOr.ofValue([]);
    }

    const S = DependencyDescriptorsWireInfoSchema;
    const res: Uint8Array[] = new Array(numPackets);

    const startEndBitBase: OptionalU64 = has(S, ddWireInfo, "startEndBit") ? BigInt(ddWireInfo.startEndBit) : undefined;
    const templateIdBase: OptionalU64 = has(S, ddWireInfo, "templateId") ? BigInt(ddWireInfo.templateId) : undefined;
    const frameIdBase: OptionalU64 = has(S, ddWireInfo, "frameId") ? BigInt(ddWireInfo.frameId) : undefined;

    const startEndBitDeltas: OptionalU64[] = has(S, ddWireInfo, "startEndBitDeltas")
      ? decodeDeltas(ddWireInfo.startEndBitDeltas, startEndBitBase, numPackets - 1)
      : [];
    const templateIdDeltas: OptionalU64[] = has(S, ddWireInfo, "templateIdDeltas")
      ? decodeDeltas(ddWireInfo.templateIdDeltas, templateIdBase, numPackets - 1)
      : [];
    const frameIdDeltas: OptionalU64[] = has(S, ddWireInfo, "frameIdDeltas")
      ? decodeDeltas(ddWireInfo.frameIdDeltas, frameIdBase, numPackets - 1)
      : [];

    const extendedInfos: (Uint8Array | undefined)[] = has(S, ddWireInfo, "extendedInfos")
      ? decodeOptionalBlobs(ddWireInfo.extendedInfos, numPackets)
      : [];

    const recreateRawDd = (i: number, be: OptionalU64, tid: OptionalU64, fid: OptionalU64): RtcEventLogParseStatus => {
      let ext: Uint8Array = new Uint8Array(0);
      if (extendedInfos.length !== 0 && extendedInfos[i] !== undefined) {
        ext = extendedInfos[i] as Uint8Array;
      }

      if (be !== undefined && tid !== undefined && fid !== undefined) {
        const dd = new Uint8Array(3 + ext.length);
        dd[0] = Number(((be << 6n) | tid) & 0xffn);
        dd[1] = Number((fid >> 8n) & 0xffn);
        dd[2] = Number(fid & 0xffn);
        dd.set(ext, 3);
        res[i] = dd;
      } else if (be !== undefined || tid !== undefined || fid !== undefined) {
        return RtcEventLogParseStatus.error("Not all required fields present.");
      } else if (ext.length !== 0) {
        return RtcEventLogParseStatus.error("Extended info present without required fields present.");
      } else {
        res[i] = new Uint8Array(0);
      }
      return RtcEventLogParseStatus.success();
    };

    let status = recreateRawDd(0, startEndBitBase, templateIdBase, frameIdBase);
    if (!status.ok()) return RtcEventLogParseStatusOr.ofStatus(status);

    for (let i = 1; i < numPackets; ++i) {
      status = recreateRawDd(
        i,
        startEndBitDeltas.length === 0 ? startEndBitBase : startEndBitDeltas[i - 1],
        templateIdDeltas.length === 0 ? templateIdBase : templateIdDeltas[i - 1],
        frameIdDeltas.length === 0 ? frameIdBase : frameIdDeltas[i - 1],
      );
      if (!status.ok()) return RtcEventLogParseStatusOr.ofStatus(status);
    }

    return RtcEventLogParseStatusOr.ofValue(res);
  },
};
