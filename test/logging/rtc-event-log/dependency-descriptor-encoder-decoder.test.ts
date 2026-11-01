// Port of logging/rtc_event_log/dependency_descriptor_encoder_decoder_unittest.cc @ M154.

import {clearField, clone, create} from "@bufbuild/protobuf";

import {DependencyDescriptorsWireInfoSchema} from "../../../src/gen/rtc_event_log2_pb.js";
import {has} from "../../../src/proto/presence.js";
import {RtcEventLogDependencyDescriptorEncoderDecoder} from "../../../src/logging/rtc-event-log/dependency-descriptor-encoder-decoder.js";
import {encodeDeltas, type OptionalU64} from "../../../src/logging/rtc-event-log/encoder/delta-encoding.js";
import {encodeOptionalBlobs} from "../../../src/logging/rtc-event-log/encoder/optional-blob-encoding.js";

const kNone = 0n;
const kEnd = 1n;
const kBegin = 2n;
const kBeginEnd = 3n;

const S = DependencyDescriptorsWireInfoSchema;
const s = (text: string) => new TextEncoder().encode(text);
const blobs = (...values: (string | undefined)[]) => encodeOptionalBlobs(values.map((v) => (v === undefined ? undefined : s(v))));
const deltas = (base: OptionalU64, values: OptionalU64[]) => encodeDeltas(base, values);

class DdBuilder {
  private rawDd: number[] = [0, 0, 0];

  B(): this {
    this.rawDd[0] |= 1 << 7;
    return this;
  }
  E(): this {
    this.rawDd[0] |= 1 << 6;
    return this;
  }
  Tid(id: number): this {
    this.rawDd[0] |= id;
    return this;
  }
  Fid(id: number): this {
    this.rawDd[1] = (id >> 8) & 0xff;
    this.rawDd[2] = id & 0xff;
    return this;
  }
  Ext(ext: string): this {
    this.rawDd.push(...s(ext));
    return this;
  }
  Build(): Uint8Array {
    return Uint8Array.from(this.rawDd);
  }
}

const empty = new Uint8Array(0);

describe("RtcEventLogDependencyDescriptorEncoding", () => {
  test("SinglePacket", () => {
    const encoded = RtcEventLogDependencyDescriptorEncoderDecoder.encode([
      new DdBuilder().B().E().Tid(12).Fid(345).Ext("abc").Build(),
    ])!;
    expect(BigInt(encoded.startEndBit)).toBe(kBeginEnd);
    expect(encoded.templateId).toBe(12);
    expect(encoded.frameId).toBe(345);
    expect(encoded.extendedInfos).toEqual(blobs("abc"));
    expect(has(S, encoded, "startEndBitDeltas")).toBe(false);
    expect(has(S, encoded, "templateIdDeltas")).toBe(false);
    expect(has(S, encoded, "frameIdDeltas")).toBe(false);
  });

  test("MultiplePackets", () => {
    const encoded = RtcEventLogDependencyDescriptorEncoderDecoder.encode([
      new DdBuilder().B().E().Tid(1).Fid(1).Ext("abc").Build(),
      new DdBuilder().B().Tid(2).Fid(3).Ext("def").Build(),
      new DdBuilder().E().Tid(2).Fid(3).Build(),
    ])!;
    expect(BigInt(encoded.startEndBit)).toBe(kBeginEnd);
    expect(encoded.templateId).toBe(1);
    expect(encoded.frameId).toBe(1);
    expect(encoded.extendedInfos).toEqual(blobs("abc", "def", undefined));
    expect(encoded.startEndBitDeltas).toEqual(deltas(kBeginEnd, [kBegin, kEnd]));
    expect(encoded.templateIdDeltas).toEqual(deltas(1n, [2n, 2n]));
    expect(encoded.frameIdDeltas).toEqual(deltas(1n, [3n, 3n]));
  });

  test("MultiplePacketsOneFrame", () => {
    const encoded = RtcEventLogDependencyDescriptorEncoderDecoder.encode([
      new DdBuilder().B().Tid(1).Fid(1).Ext("abc").Build(),
      new DdBuilder().Tid(1).Fid(1).Build(),
      new DdBuilder().E().Tid(1).Fid(1).Build(),
    ])!;
    expect(BigInt(encoded.startEndBit)).toBe(kBegin);
    expect(encoded.templateId).toBe(1);
    expect(encoded.frameId).toBe(1);
    expect(encoded.extendedInfos).toEqual(blobs("abc", undefined, undefined));
    expect(encoded.startEndBitDeltas).toEqual(deltas(kBegin, [kNone, kEnd]));
    expect(has(S, encoded, "templateIdDeltas")).toBe(false);
    expect(has(S, encoded, "frameIdDeltas")).toBe(false);
  });

  test("FirstPacketMissingDd", () => {
    const encoded = RtcEventLogDependencyDescriptorEncoderDecoder.encode([
      empty,
      new DdBuilder().B().E().Tid(1).Fid(1).Build(),
      new DdBuilder().E().Tid(2).Fid(3).Ext("three!").Build(),
    ])!;
    expect(has(S, encoded, "startEndBit")).toBe(false);
    expect(has(S, encoded, "templateId")).toBe(false);
    expect(has(S, encoded, "frameId")).toBe(false);
    expect(encoded.extendedInfos).toEqual(blobs(undefined, undefined, "three!"));
    expect(encoded.startEndBitDeltas).toEqual(deltas(undefined, [kBeginEnd, kEnd]));
    expect(encoded.templateIdDeltas).toEqual(deltas(undefined, [1n, 2n]));
    expect(encoded.frameIdDeltas).toEqual(deltas(undefined, [1n, 3n]));
  });

  test("SomePacketMissingDd", () => {
    const encoded = RtcEventLogDependencyDescriptorEncoderDecoder.encode([
      new DdBuilder().B().E().Tid(1).Fid(1).Build(),
      empty,
      new DdBuilder().E().Tid(2).Fid(3).Build(),
    ])!;
    expect(BigInt(encoded.startEndBit)).toBe(kBeginEnd);
    expect(encoded.templateId).toBe(1);
    expect(encoded.frameId).toBe(1);
    expect(encoded.extendedInfos).toEqual(blobs(undefined, undefined, undefined));
    expect(encoded.startEndBitDeltas).toEqual(deltas(kBeginEnd, [undefined, kEnd]));
    expect(encoded.templateIdDeltas).toEqual(deltas(1n, [undefined, 2n]));
    expect(encoded.frameIdDeltas).toEqual(deltas(1n, [undefined, 3n]));
  });
});

describe("RtcEventLogDependencyDescriptorDecoding", () => {
  test("SinglePacket", () => {
    const encoded = create(S, {
      startEndBit: Number(kBeginEnd),
      templateId: 1,
      frameId: 2,
      extendedInfos: blobs("abc"),
    });

    const decoded = RtcEventLogDependencyDescriptorEncoderDecoder.decode(encoded, 1);
    const expected = new DdBuilder().B().E().Tid(1).Fid(2).Ext("abc").Build();
    expect(decoded.ok()).toBe(true);
    expect(decoded.value()).toEqual([expected]);
  });

  test("MultiplePackets", () => {
    const encoded = create(S, {
      startEndBit: Number(kBeginEnd),
      templateId: 1,
      frameId: 1,
      extendedInfos: blobs("abc", "def", undefined),
      startEndBitDeltas: deltas(kBeginEnd, [kBegin, kEnd]),
      templateIdDeltas: deltas(1n, [2n, 2n]),
      frameIdDeltas: deltas(1n, [3n, 3n]),
    });

    const decoded = RtcEventLogDependencyDescriptorEncoderDecoder.decode(encoded, 3);
    expect(decoded.ok()).toBe(true);
    expect(decoded.value()).toEqual([
      new DdBuilder().B().E().Tid(1).Fid(1).Ext("abc").Build(),
      new DdBuilder().B().Tid(2).Fid(3).Ext("def").Build(),
      new DdBuilder().E().Tid(2).Fid(3).Build(),
    ]);
  });

  test("MultiplePacketsOneFrame", () => {
    const encoded = create(S, {
      startEndBit: Number(kBegin),
      templateId: 1,
      frameId: 1,
      extendedInfos: blobs("abc", undefined, undefined),
      startEndBitDeltas: deltas(kBegin, [kNone, kEnd]),
    });

    const decoded = RtcEventLogDependencyDescriptorEncoderDecoder.decode(encoded, 3);
    expect(decoded.ok()).toBe(true);
    expect(decoded.value()).toEqual([
      new DdBuilder().B().Tid(1).Fid(1).Ext("abc").Build(),
      new DdBuilder().Tid(1).Fid(1).Build(),
      new DdBuilder().E().Tid(1).Fid(1).Build(),
    ]);
  });

  test("FirstPacketMissingDd", () => {
    const encoded = create(S, {
      extendedInfos: blobs(undefined, undefined, "three!"),
      startEndBitDeltas: deltas(undefined, [kBeginEnd, kEnd]),
      templateIdDeltas: deltas(undefined, [1n, 2n]),
      frameIdDeltas: deltas(undefined, [1n, 3n]),
    });

    const decoded = RtcEventLogDependencyDescriptorEncoderDecoder.decode(encoded, 3);
    expect(decoded.ok()).toBe(true);
    expect(decoded.value()).toEqual([
      empty,
      new DdBuilder().B().E().Tid(1).Fid(1).Build(),
      new DdBuilder().E().Tid(2).Fid(3).Ext("three!").Build(),
    ]);
  });

  test("SomePacketMissingDd", () => {
    const encoded = create(S, {
      startEndBit: Number(kBeginEnd),
      templateId: 1,
      frameId: 1,
      extendedInfos: blobs(undefined, undefined, undefined),
      startEndBitDeltas: deltas(kBeginEnd, [undefined, kEnd]),
      templateIdDeltas: deltas(1n, [undefined, 2n]),
      frameIdDeltas: deltas(1n, [undefined, 3n]),
    });

    const decoded = RtcEventLogDependencyDescriptorEncoderDecoder.decode(encoded, 3);
    expect(decoded.ok()).toBe(true);
    expect(decoded.value()).toEqual([
      new DdBuilder().B().E().Tid(1).Fid(1).Build(),
      empty,
      new DdBuilder().E().Tid(2).Fid(3).Build(),
    ]);
  });

  test("ExtendedWithoutRequiredFields", () => {
    const encoded = create(S, {
      startEndBitDeltas: deltas(undefined, [kNone]),
      templateIdDeltas: deltas(undefined, [1n]),
      frameIdDeltas: deltas(undefined, [1n]),
      extendedInfos: blobs("Should not be here", undefined),
    });

    const decoded = RtcEventLogDependencyDescriptorEncoderDecoder.decode(encoded, 2);
    expect(decoded.ok()).toBe(false);
  });

  test("MissingRequiredField", () => {
    const encoded = create(S, {
      startEndBit: Number(kBeginEnd),
      templateId: 1,
      frameId: 1,
    });

    for (const field of ["startEndBit", "templateId", "frameId"] as const) {
      const missing = clone(S, encoded);
      clearField(missing, S.field[field]);
      expect(has(S, missing, field)).toBe(false);
      expect(RtcEventLogDependencyDescriptorEncoderDecoder.decode(missing, 1).ok()).toBe(false);
    }
  });
});
