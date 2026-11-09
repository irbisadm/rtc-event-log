// Port of logging/rtc_event_log/events/rtc_event_field_encoding_unittest.cc @ M154.
//
// Field values are bigints in their C++ type (bool as 0n/1n); `IntegerType`
// stands in for the C++ template parameter.

import {decodeVarInt} from "../../../../src/logging/rtc-event-log/encoder/var-int.js";
import {EventParser} from "../../../../src/logging/rtc-event-log/events/rtc-event-field-encoding-parser.js";
import {
  EventEncoder,
  FieldParameters,
  FieldType,
  type EncodableRtcEvent,
  type EventParameters,
} from "../../../../src/logging/rtc-event-log/events/rtc-event-field-encoding.js";
import {
  decodeFromUnsignedToType,
  encodeAsUnsigned,
  extractOptionalValues,
  IntegerTypes,
  type IntegerType,
} from "../../../../src/logging/rtc-event-log/events/rtc-event-field-extraction.js";

const kInt32Max = 2n ** 31n - 1n;
const kInt32Min = -(2n ** 31n);
const kUint32Max = 2n ** 32n - 1n;
const kInt64Max = 2n ** 63n - 1n;
const kInt64Min = -(2n ** 63n);
const kUint64Max = 2n ** 64n - 1n;

// C++ integer division truncates toward zero, as bigint division does.

const utf8 = new TextEncoder();

function expectedVarIntSize(value: bigint, type: IntegerType): number {
  let bytes = 0;
  let x = encodeAsUnsigned(value, type);
  do {
    ++bytes;
    x >>= 7n;
  } while (x > 0n);
  return bytes;
}

function expectedBaseValueSize(params: FieldParameters, value: bigint, type: IntegerType): number {
  switch (params.fieldType) {
    case FieldType.kFixed8:
      return 1;
    case FieldType.kFixed32:
      return 4;
    case FieldType.kFixed64:
      return 8;
    case FieldType.kVarInt:
      return expectedVarIntSize(value, type);
    default:
      throw new Error("NOTREACHED");
  }
}

function tagSize(params: FieldParameters): number {
  return expectedVarIntSize((params.fieldId << 3n) + BigInt(params.fieldType), IntegerTypes.uint64);
}

function expectedEncodingSize(params: FieldParameters, v: readonly bigint[], type: IntegerType, expectedBitsPerDelta: number): number {
  if (v.length === 0) return 0;

  const base = v[0];
  const baseSize = expectedBaseValueSize(params, base, type);
  if (v.length === 1) return tagSize(params) + baseSize;

  const deltaHeaderSize = 1;
  // Check if there is an element *not* equal to base.
  if (v.every((x) => x === base)) {
    return tagSize(params) + baseSize + deltaHeaderSize;
  }

  const deltaSize = Math.floor(((v.length - 1) * expectedBitsPerDelta + 7) / 8);
  return tagSize(params) + baseSize + deltaHeaderSize + deltaSize;
}

function expectedOptionalEncodingSize(
  params: FieldParameters,
  v: readonly (bigint | undefined)[],
  type: IntegerType,
  expectedBitsPerDelta: number,
): number {
  const numExistingValues = v.filter((x) => x !== undefined).length;
  if (numExistingValues === 0) return 0;

  const base = v.find((x) => x !== undefined) as bigint;
  const baseSize = expectedBaseValueSize(params, base, type);
  if (numExistingValues === 1 && v.length === 1) return tagSize(params) + baseSize;

  const deltaHeaderSize = numExistingValues === v.length ? 1 : 2;
  const positionsSize = numExistingValues === v.length ? 0 : Math.floor((v.length + 7) / 8);
  // Check if there is an element *not* equal to base.
  if (v.every((x) => x === base)) {
    return tagSize(params) + baseSize + deltaHeaderSize + positionsSize;
  }

  const deltaSize = Math.floor(((numExistingValues - 1) * expectedBitsPerDelta + 7) / 8);
  return tagSize(params) + baseSize + deltaHeaderSize + positionsSize + deltaSize;
}

function expectedStringEncodingSize(params: FieldParameters, values: readonly string[]): number {
  expect(params.fieldType).toBe(FieldType.kString);
  let expectedSize = tagSize(params);
  if (values.length > 1) {
    // VarInt encoding header reserved for future use. Currently always 0.
    expectedSize += 1;
  }
  for (const s of values) {
    const size = utf8.encode(s).length;
    expectedSize += expectedVarIntSize(BigInt(size), IntegerTypes.uint64);
    expectedSize += size;
  }
  return expectedSize;
}

class RtcTestEvent implements EncodableRtcEvent {
  readonly timestampUs = 0n;

  constructor(
    readonly b: boolean,
    readonly signed32: bigint,
    readonly unsigned32: bigint,
    readonly signed64: bigint,
    readonly unsigned64: bigint,
    readonly optionalSigned32: bigint | undefined = undefined,
    readonly optionalSigned64: bigint | undefined = undefined,
    readonly wrapping21: bigint = 0n,
    readonly string: string = "",
  ) {}

  static readonly eventParams: EventParameters = {name: "TestEvent", id: 4711};
  static readonly timestampParams: FieldParameters = {
    name: "timestamp_ms",
    fieldId: FieldParameters.kTimestampField,
    fieldType: FieldType.kVarInt,
    valueWidth: 64,
  };
  static readonly boolParams: FieldParameters = {name: "b", fieldId: 2n, fieldType: FieldType.kFixed8, valueWidth: 1};
  static readonly signed32Params: FieldParameters = {name: "signed32", fieldId: 3n, fieldType: FieldType.kVarInt, valueWidth: 32};
  static readonly unsigned32Params: FieldParameters = {name: "unsigned32", fieldId: 4n, fieldType: FieldType.kFixed32, valueWidth: 32};
  static readonly signed64Params: FieldParameters = {name: "signed64", fieldId: 5n, fieldType: FieldType.kFixed64, valueWidth: 64};
  static readonly unsigned64Params: FieldParameters = {name: "unsigned64", fieldId: 6n, fieldType: FieldType.kVarInt, valueWidth: 64};
  static readonly optional32Params: FieldParameters = {
    name: "optional_signed32",
    fieldId: 7n,
    fieldType: FieldType.kFixed32,
    valueWidth: 32,
  };
  static readonly optional64Params: FieldParameters = {
    name: "optional_signed64",
    fieldId: 8n,
    fieldType: FieldType.kVarInt,
    valueWidth: 64,
  };
  static readonly wrapping21Params: FieldParameters = {name: "wrapping21", fieldId: 9n, fieldType: FieldType.kFixed32, valueWidth: 21};
  static readonly stringParams: FieldParameters = {name: "string", fieldId: 10n, fieldType: FieldType.kString, valueWidth: 0};
}

let batch: RtcTestEvent[];
let parser: EventParser;

beforeEach(() => {
  batch = [];
  parser = new EventParser();
});

// ExtractRtcEventMember for the test event's members.
function extract(member: (e: RtcTestEvent) => bigint | boolean, type: IntegerType): bigint[] {
  return batch.map((e) => encodeAsUnsigned(member(e), type));
}

interface FullValues {
  bool: boolean[];
  signed32: bigint[];
  unsigned32: bigint[];
  signed64: bigint[];
  unsigned64: bigint[];
  optional32: (bigint | undefined)[];
  optional64: (bigint | undefined)[];
  wrapping21: bigint[];
  string: string[];
}

function createFullEvents(v: FullValues): void {
  const size = v.bool.length;
  for (const values of [v.signed32, v.unsigned32, v.signed64, v.unsigned64, v.optional32, v.optional64, v.wrapping21, v.string]) {
    expect(values.length).toBe(size);
  }
  for (let i = 0; i < size; i++) {
    batch.push(
      new RtcTestEvent(
        v.bool[i],
        v.signed32[i],
        v.unsigned32[i],
        v.signed64[i],
        v.unsigned64[i],
        v.optional32[i],
        v.optional64[i],
        v.wrapping21[i],
        v.string[i],
      ),
    );
  }
}

function encodeAllFields(encoder: EventEncoder): void {
  encoder.encodeField(RtcTestEvent.boolParams, extract((e) => e.b, IntegerTypes.bool));
  encoder.encodeField(RtcTestEvent.signed32Params, extract((e) => e.signed32, IntegerTypes.int32));
  encoder.encodeField(RtcTestEvent.unsigned32Params, extract((e) => e.unsigned32, IntegerTypes.uint32));
  encoder.encodeField(RtcTestEvent.signed64Params, extract((e) => e.signed64, IntegerTypes.int64));
  encoder.encodeField(RtcTestEvent.unsigned64Params, extract((e) => e.unsigned64, IntegerTypes.uint64));
  encoder.encodeOptionalField(
    RtcTestEvent.optional32Params,
    extractOptionalValues(
      batch.map((e) => e.optionalSigned32),
      IntegerTypes.int32,
    ),
  );
  encoder.encodeOptionalField(
    RtcTestEvent.optional64Params,
    extractOptionalValues(
      batch.map((e) => e.optionalSigned64),
      IntegerTypes.int64,
    ),
  );
  encoder.encodeField(RtcTestEvent.wrapping21Params, extract((e) => e.wrapping21, IntegerTypes.uint32));
  encoder.encodeStringField(
    RtcTestEvent.stringParams,
    batch.map((e) => utf8.encode(e.string)),
  );
}

function parseEventHeader(encodedEvent: Uint8Array): void {
  const tag = decodeVarInt(encodedEvent);
  expect(tag.success).toBe(true);
  encodedEvent = tag.rest;
  const eventId = tag.value >> 1n;
  expect(eventId).toBe(BigInt(RtcTestEvent.eventParams.id));
  const batched = (tag.value & 1n) !== 0n;
  expect(batched).toBe(batch.length > 1);

  const size = decodeVarInt(encodedEvent);
  encodedEvent = size.rest;
  expect(BigInt(encodedEvent.length)).toBe(size.value);

  expect(parser.initialize(encodedEvent, batched).ok()).toBe(true);
}

function parseAndVerifyTimestamps(): void {
  const result = parser.parseNumericField(RtcTestEvent.timestampParams);
  expect(result.message()).toBe("");
  expect(result.value().length).toBe(batch.length);
  for (let i = 0; i < batch.length; i++) {
    expect(result.value()[i]).toBe(batch[i].timestampUs / 1000n);
  }
}

function parseAndVerifyStringField(params: FieldParameters, expectedValues: readonly string[], expectedSkippedBytes = 0): void {
  const expectedSize = expectedStringEncodingSize(params, expectedValues) + expectedSkippedBytes;
  const sizeBefore = parser.remainingBytes();
  const result = parser.parseStringField(params);
  expect(result.message()).toBe("");
  expect(result.value().length).toBe(expectedValues.length);
  const decoder = new TextDecoder();
  for (let i = 0; i < expectedValues.length; i++) {
    expect(decoder.decode(result.value()[i])).toBe(expectedValues[i]);
  }
  const sizeAfter = parser.remainingBytes();
  expect(sizeBefore - sizeAfter).toBe(expectedSize);
}

function parseAndVerifyField(
  params: FieldParameters,
  expectedValues: readonly (bigint | boolean)[],
  type: IntegerType,
  expectedBitsPerDelta: number,
  expectedSkippedBytes = 0,
): void {
  const expected = expectedValues.map((x) => (typeof x === "boolean" ? (x ? 1n : 0n) : x));
  const expectedSize = expectedEncodingSize(params, expected, type, expectedBitsPerDelta) + expectedSkippedBytes;
  const sizeBefore = parser.remainingBytes();
  const result = parser.parseNumericField(params);
  expect(result.message()).toBe("");
  expect(result.value().length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(decodeFromUnsignedToType(result.value()[i], type)).toBe(expected[i]);
  }
  const sizeAfter = parser.remainingBytes();
  expect(sizeBefore - sizeAfter).toBe(expectedSize);
}

function parseAndVerifyOptionalField(
  params: FieldParameters,
  expectedValues: readonly (bigint | undefined)[],
  type: IntegerType,
  expectedBitsPerDelta: number,
  expectedSkippedBytes = 0,
): void {
  const expectedSize = expectedOptionalEncodingSize(params, expectedValues, type, expectedBitsPerDelta) + expectedSkippedBytes;
  const sizeBefore = parser.remainingBytes();
  const result = parser.parseOptionalNumericField(params);
  expect(result.message()).toBe("");
  const {values, positions} = result.value();
  expect(positions.length).toBe(expectedValues.length);
  let valueIt = 0;
  for (let i = 0; i < expectedValues.length; i++) {
    if (positions[i]) {
      expect(valueIt).not.toBe(values.length);
      expect(expectedValues[i]).toBeDefined();
      expect(decodeFromUnsignedToType(values[valueIt], type)).toBe(expectedValues[i]);
      ++valueIt;
    } else {
      expect(expectedValues[i]).toBeUndefined();
    }
  }
  expect(valueIt).toBe(values.length);
  const sizeAfter = parser.remainingBytes();
  expect(sizeBefore - sizeAfter).toBe(expectedSize);
}

function parseAndVerifyMissingField(params: FieldParameters): void {
  const result = parser.parseNumericField(params, /*required_field=*/ false);
  expect(result.message()).toBe("");
  expect(result.value().length).toBe(0);
}

function parseAndVerifyMissingOptionalField(params: FieldParameters): void {
  const result = parser.parseOptionalNumericField(params, /*required_field=*/ false);
  expect(result.message()).toBe("");
  expect(result.value().positions.length).toBe(0);
  expect(result.value().values.length).toBe(0);
}

// Encodes all fields of `v` and checks that every field parses back with
// `bitsPerDelta` bits per delta.
function roundTripAllFields(v: FullValues, bitsPerDelta: number): void {
  createFullEvents(v);
  const encoder = new EventEncoder(RtcTestEvent.eventParams, batch);
  encodeAllFields(encoder);
  const s = encoder.asBytes();

  parseEventHeader(s);
  parseAndVerifyTimestamps();
  parseAndVerifyField(RtcTestEvent.boolParams, v.bool, IntegerTypes.bool, bitsPerDelta);
  parseAndVerifyField(RtcTestEvent.signed32Params, v.signed32, IntegerTypes.int32, bitsPerDelta);
  parseAndVerifyField(RtcTestEvent.unsigned32Params, v.unsigned32, IntegerTypes.uint32, bitsPerDelta);
  parseAndVerifyField(RtcTestEvent.signed64Params, v.signed64, IntegerTypes.int64, bitsPerDelta);
  parseAndVerifyField(RtcTestEvent.unsigned64Params, v.unsigned64, IntegerTypes.uint64, bitsPerDelta);
  parseAndVerifyOptionalField(RtcTestEvent.optional32Params, v.optional32, IntegerTypes.int32, bitsPerDelta);
  parseAndVerifyOptionalField(RtcTestEvent.optional64Params, v.optional64, IntegerTypes.int64, bitsPerDelta);
  parseAndVerifyField(RtcTestEvent.wrapping21Params, v.wrapping21, IntegerTypes.uint32, bitsPerDelta);
  parseAndVerifyStringField(RtcTestEvent.stringParams, v.string);
  expect(parser.remainingBytes()).toBe(0);
}

describe("RtcEventFieldTest", () => {
  test("EmptyList", () => {
    const encoder = new EventEncoder(RtcTestEvent.eventParams, batch);
    encoder.encodeField(RtcTestEvent.boolParams, extract((e) => e.b, IntegerTypes.bool));
    const s = encoder.asBytes();
    expect(s.length).toBe(0);
  });

  test("Singleton", () => {
    roundTripAllFields(
      {
        bool: [true],
        signed32: [-2n],
        unsigned32: [123456789n],
        signed64: [-9876543210n],
        unsigned64: [9876543210n],
        optional32: [kInt32Min],
        optional64: [kInt64Max],
        wrapping21: [(1n << 21n) - 1n],
        string: ["foo"],
      },
      /*no deltas*/ 0,
    );
  });

  test("EqualElements", () => {
    roundTripAllFields(
      {
        bool: [true, true, true, true],
        signed32: [-2n, -2n, -2n, -2n],
        unsigned32: [123456789n, 123456789n, 123456789n, 123456789n],
        signed64: [-9876543210n, -9876543210n, -9876543210n, -9876543210n],
        unsigned64: [9876543210n, 9876543210n, 9876543210n, 9876543210n],
        optional32: [kInt32Min, kInt32Min, kInt32Min, kInt32Min],
        optional64: [kInt64Max, kInt64Max, kInt64Max, kInt64Max],
        wrapping21: [(1n << 21n) - 1n, (1n << 21n) - 1n, (1n << 21n) - 1n, (1n << 21n) - 1n],
        string: ["foo", "foo", "foo", "foo"],
      },
      /*no deltas*/ 0,
    );
  });

  test("Increasing", () => {
    roundTripAllFields(
      {
        bool: [false, true, false, true],
        signed32: [-2n, -1n, 0n, 1n],
        unsigned32: [kUint32Max - 1n, kUint32Max, 0n, 1n],
        signed64: [kInt64Max - 1n, kInt64Max, kInt64Min, kInt64Min + 1n],
        unsigned64: [kUint64Max - 1n, kUint64Max, 0n, 1n],
        optional32: [kInt32Max - 1n, kInt32Max, kInt32Min, kInt32Min + 1n],
        optional64: [kInt64Max - 1n, kInt64Max, kInt64Min, kInt64Min + 1n],
        wrapping21: [(1n << 21n) - 2n, (1n << 21n) - 1n, 0n, 1n],
        string: ["", "a", "bc", "def"], // No special compression of strings.
      },
      /*expected_bits_per_delta=*/ 1,
    );
  });

  test("Decreasing", () => {
    roundTripAllFields(
      {
        bool: [true, false, true, false],
        signed32: [2n, 1n, 0n, -1n],
        unsigned32: [1n, 0n, kUint32Max, kUint32Max - 1n],
        signed64: [kInt64Min + 1n, kInt64Min, kInt64Max, kInt64Max - 1n],
        unsigned64: [1n, 0n, kUint64Max, kUint64Max - 1n],
        optional32: [kInt32Min + 1n, kInt32Min, kInt32Max, kInt32Max - 1n],
        optional64: [kInt64Min + 1n, kInt64Min, kInt64Max, kInt64Max - 1n],
        wrapping21: [1n, 0n, (1n << 21n) - 1n, (1n << 21n) - 2n],
        string: ["def", "bc", "a", ""], // No special compression of strings.
      },
      /*expected_bits_per_delta=*/ 1,
    );
  });

  const halfValues = (strings: string[]): FullValues => ({
    bool: [true, false],
    signed32: [kInt32Min / 2n, kInt32Max / 2n],
    unsigned32: [0n, kUint32Max / 2n],
    signed64: [kInt64Min / 2n, kInt64Max / 2n],
    unsigned64: [0n, kUint64Max / 2n],
    optional32: [kInt32Max / 2n, kInt32Min / 2n],
    optional64: [kInt64Min / 2n, kInt64Max / 2n],
    wrapping21: [0n, 1n << 20n],
    string: strings,
  });

  test("SkipsDeprecatedFields", () => {
    // Expect parser to skip fields it doesn't recognize, but find subsequent
    // fields.
    const v = halfValues(["foo", "bar"]);

    const signed32EncodingSize = /*tag*/ 1 + /* varint base*/ 5 + /* delta_header*/ 1 + /*deltas*/ 4;
    const signed64EncodingSize = /*tag*/ 1 + /* fixed64 base*/ 8 + /* delta_header*/ 1 + /*deltas*/ 8;
    const optional32EncodingSize = /*tag*/ 1 + /* fixed32 base*/ 4 + /* delta_header*/ 1 + /*deltas*/ 4;

    createFullEvents(v);
    const encoder = new EventEncoder(RtcTestEvent.eventParams, batch);
    encodeAllFields(encoder);
    const s = encoder.asBytes();

    parseEventHeader(s);
    parseAndVerifyTimestamps();
    parseAndVerifyField(RtcTestEvent.boolParams, v.bool, IntegerTypes.bool, /*expected_bits_per_delta=*/ 1);
    // Skips parsing the `signed32_values`. The following unsigned fields should
    // still be found.
    parseAndVerifyField(
      RtcTestEvent.unsigned32Params,
      v.unsigned32,
      IntegerTypes.uint32,
      /*expected_bits_per_delta=*/ 31,
      /*expected_skipped_bytes=*/ signed32EncodingSize,
    );
    // Skips parsing the `signed64_values`. The following unsigned fields should
    // still be found.
    parseAndVerifyField(RtcTestEvent.unsigned64Params, v.unsigned64, IntegerTypes.uint64, /*expected_bits_per_delta=*/ 63, signed64EncodingSize);
    // Skips parsing the `optional32_values`. The following unsigned fields should
    // still be found.
    parseAndVerifyOptionalField(
      RtcTestEvent.optional64Params,
      v.optional64,
      IntegerTypes.int64,
      /*expected_bits_per_delta=*/ 63,
      optional32EncodingSize,
    );
    parseAndVerifyField(RtcTestEvent.wrapping21Params, v.wrapping21, IntegerTypes.uint32, /*expected_bits_per_delta=*/ 20);
    parseAndVerifyStringField(RtcTestEvent.stringParams, v.string);
    expect(parser.remainingBytes()).toBe(0);
  });

  test("SkipsMissingFields", () => {
    // Expect parsing of missing field to succeed but return an empty list.
    const v = halfValues(["foo", "foo"]);
    createFullEvents(v);

    const encoder = new EventEncoder(RtcTestEvent.eventParams, batch);
    // Skip encoding the `bool_values`.
    encoder.encodeField(RtcTestEvent.signed32Params, extract((e) => e.signed32, IntegerTypes.int32));
    // Skip encoding the `unsigned32_values`.
    encoder.encodeField(RtcTestEvent.signed64Params, extract((e) => e.signed64, IntegerTypes.int64));
    // Skip encoding the `unsigned64_values`.
    encoder.encodeOptionalField(
      RtcTestEvent.optional32Params,
      extractOptionalValues(
        batch.map((e) => e.optionalSigned32),
        IntegerTypes.int32,
      ),
    );
    // Skip encoding the `optional64_values`.
    encoder.encodeField(RtcTestEvent.wrapping21Params, extract((e) => e.wrapping21, IntegerTypes.uint32));
    encoder.encodeStringField(
      RtcTestEvent.stringParams,
      batch.map((e) => utf8.encode(e.string)),
    );
    const s = encoder.asBytes();

    parseEventHeader(s);
    parseAndVerifyTimestamps();
    parseAndVerifyMissingField(RtcTestEvent.boolParams);
    parseAndVerifyField(RtcTestEvent.signed32Params, v.signed32, IntegerTypes.int32, /*expected_bits_per_delta=*/ 31);
    parseAndVerifyMissingField(RtcTestEvent.unsigned32Params);
    parseAndVerifyField(RtcTestEvent.signed64Params, v.signed64, IntegerTypes.int64, /*expected_bits_per_delta=*/ 63);
    parseAndVerifyMissingField(RtcTestEvent.unsigned64Params);
    parseAndVerifyOptionalField(RtcTestEvent.optional32Params, v.optional32, IntegerTypes.int32, /*expected_bits_per_delta=*/ 31);
    parseAndVerifyMissingOptionalField(RtcTestEvent.optional64Params);
    parseAndVerifyField(RtcTestEvent.wrapping21Params, v.wrapping21, IntegerTypes.uint32, /*expected_bits_per_delta=*/ 20);
    parseAndVerifyStringField(RtcTestEvent.stringParams, v.string);
    expect(parser.remainingBytes()).toBe(0);
  });

  test("OptionalFields", () => {
    const optional32Values = [2n, undefined, 4n, undefined, 6n, undefined];
    const optional64Values = [undefined, 1024n, undefined, 1025n, undefined, 1026n];
    const wrapping21Values = [(1n << 21n) - 3n, 0n, 2n, 5n, 5n, 6n];

    for (let i = 0; i < optional32Values.length; i++) {
      batch.push(new RtcTestEvent(false, 0n, 0n, 0n, 0n, optional32Values[i], optional64Values[i], wrapping21Values[i], ""));
    }

    const encoder = new EventEncoder(RtcTestEvent.eventParams, batch);
    encoder.encodeOptionalField(RtcTestEvent.optional32Params, extractOptionalValues(optional32Values, IntegerTypes.int32));
    encoder.encodeOptionalField(RtcTestEvent.optional64Params, extractOptionalValues(optional64Values, IntegerTypes.int64));
    encoder.encodeField(RtcTestEvent.wrapping21Params, extract((e) => e.wrapping21, IntegerTypes.uint32));
    const s = encoder.asBytes();

    parseEventHeader(s);
    parseAndVerifyTimestamps();
    parseAndVerifyOptionalField(RtcTestEvent.optional32Params, optional32Values, IntegerTypes.int32, /*expected_bits_per_delta=*/ 2);
    parseAndVerifyOptionalField(RtcTestEvent.optional64Params, optional64Values, IntegerTypes.int64, /*expected_bits_per_delta=*/ 1);
    parseAndVerifyField(RtcTestEvent.wrapping21Params, wrapping21Values, IntegerTypes.uint32, /*expected_bits_per_delta=*/ 2);
    expect(parser.remainingBytes()).toBe(0);
  });

  test("AllNulloptTreatedAsMissing", () => {
    const optional32Values = [undefined, undefined, undefined, undefined, undefined, undefined];
    const optional64Values = [undefined, 1024n, undefined, 1025n, undefined, 1026n];

    for (let i = 0; i < optional32Values.length; i++) {
      batch.push(new RtcTestEvent(false, 0n, 0n, 0n, 0n, optional32Values[i], optional64Values[i], 0n, ""));
    }

    const encoder = new EventEncoder(RtcTestEvent.eventParams, batch);
    encoder.encodeOptionalField(RtcTestEvent.optional32Params, extractOptionalValues(optional32Values, IntegerTypes.int32));
    encoder.encodeOptionalField(RtcTestEvent.optional64Params, extractOptionalValues(optional64Values, IntegerTypes.int64));
    const s = encoder.asBytes();

    parseEventHeader(s);
    parseAndVerifyTimestamps();
    parseAndVerifyMissingOptionalField(RtcTestEvent.optional32Params);
    parseAndVerifyOptionalField(RtcTestEvent.optional64Params, optional64Values, IntegerTypes.int64, /*expected_bits_per_delta=*/ 1);
    expect(parser.remainingBytes()).toBe(0);
  });
});

// Not upstream: the parser's handling of malformed fields.
describe("EventParser errors", () => {
  const parse = (fields: number[], batched: boolean) => {
    const p = new EventParser();
    expect(p.initialize(Uint8Array.from(fields), batched).ok()).toBe(true);
    return p;
  };

  test("unrecognized string encoding parameters", () => {
    // 2 events, timestamps all equal to 0, string field 10 with params 1.
    const p = parse([2, 0x7f, 0, (10 << 3) | 4, 1], true);
    expect(p.parseNumericField(RtcTestEvent.timestampParams).ok()).toBe(true);
    expect(p.parseStringField(RtcTestEvent.stringParams).message()).toBe("Unrecognized string encoding parameters");
  });

  test("string longer than the remaining data", () => {
    const p = parse([0, (10 << 3) | 4, 5, 0x61], false);
    expect(p.parseNumericField(RtcTestEvent.timestampParams).ok()).toBe(true);
    expect(p.parseStringField(RtcTestEvent.stringParams).message()).toBe("String size exceeds remaining data");
  });

  test("unknown field type", () => {
    const p = parse([0, (2 << 3) | 5, 1], false);
    expect(p.parseNumericField(RtcTestEvent.timestampParams).ok()).toBe(true);
    expect(p.parseNumericField(RtcTestEvent.boolParams).message()).toBe("Failed to parse field type");
  });

  test("delta header with unread bits", () => {
    // 2 events, timestamp delta header 0x100.
    const p = parse([2, 0x80, 0x02], true);
    expect(p.parseNumericField(RtcTestEvent.timestampParams).message()).toBe("Failed to parse delta header");
  });

  test("delta wider than the value", () => {
    // 2 events, b (width 1) with a 2-bit delta header.
    const p = parse([2, 0x7f, 0, (2 << 3) | 0, 1, 0, 0], true);
    expect(p.parseNumericField(RtcTestEvent.timestampParams).ok()).toBe(true);
    expect(p.parseNumericField(RtcTestEvent.boolParams).message()).toBe("Failed to parse delta header");
  });

  test("optional values without any value", () => {
    // 2 events, timestamps all equal; optional32 with an all-zero position mask.
    const p = parse([2, 0x7f, 0, (7 << 3) | 1, 0x80, 0x01, 0x00], true);
    expect(p.parseNumericField(RtcTestEvent.timestampParams).ok()).toBe(true);
    expect(p.parseOptionalNumericField(RtcTestEvent.optional32Params).message()).toBe("Expected at least one non_empty value");
  });

  test("truncated deltas", () => {
    // 3 events, timestamps with 8-bit unsigned deltas but only one delta byte.
    const p = parse([3, 7, 0, 1], true);
    expect(p.parseNumericField(RtcTestEvent.timestampParams).message()).toBe("Failed to decode deltas");
  });

  test("missing required field", () => {
    const p = parse([0], false);
    expect(p.parseNumericField(RtcTestEvent.timestampParams).ok()).toBe(true);
    expect(p.parseNumericField(RtcTestEvent.boolParams).message()).toBe("Required numerical field not found");
    expect(p.parseStringField(RtcTestEvent.stringParams).message()).toBe("Required string field not found");
  });

  test("truncated batch size", () => {
    expect(new EventParser().initialize(Uint8Array.of(0x80), true).message()).toBe("Failed to read number of events in batch.");
  });
});
