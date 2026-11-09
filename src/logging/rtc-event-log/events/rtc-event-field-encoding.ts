// Port of logging/rtc_event_log/events/rtc_event_field_encoding.h @ M154.
//
// The encoder is only used by tests (the library parses logs); it is kept
// next to the parser as upstream does.

import type {RtcEventType} from "../../../api/rtc-event-log/rtc-event.js";
import {BitWriter} from "../encoder/bit-writer.js";
import {encodeVarInt} from "../encoder/var-int.js";
import {FixedLengthEncodingParametersV3} from "./fixed-length-encoding-parameters-v3.js";
import {encodeAsUnsigned, IntegerTypes, unsignedDelta, type ValuesWithPositions} from "./rtc-event-field-extraction.js";

// To maintain backwards compatibility with past (or future) logs,
// the constants in this enum must not be changed.
// New field types with numerical IDs 5-7 can be added, but old
// parsers will fail to parse events containing the new fields.
export enum FieldType {
  kFixed8 = 0,
  kFixed32 = 1,
  kFixed64 = 2,
  kVarInt = 3,
  kString = 4,
}

// EventParameters map an event name to a numerical ID.
export interface EventParameters {
  // The name is primarily used for debugging purposes.
  readonly name: string;
  readonly id: RtcEventType | number;
}

// FieldParameters define the encoding for a field.
export interface FieldParameters {
  // The name is primarily used for debugging purposes.
  readonly name: string;
  // Numerical ID for the field. Must be strictly greater than 0,
  // and unique within each event type.
  readonly fieldId: bigint;
  // Encoding type for the base (i.e. non-delta) field in a batch.
  readonly fieldType: FieldType;
  // Number of bits after which wrap-around occurs.
  readonly valueWidth: number;
}

export const FieldParameters = {
  // Field ID 0 is reserved for timestamps.
  kTimestampField: 0n,
};

// The timestamp field every event starts with.
export const kTimestampParams: FieldParameters = {
  name: "timestamp_ms",
  fieldId: FieldParameters.kTimestampField,
  fieldType: FieldType.kVarInt,
  valueWidth: 64,
};

// What the EventEncoder needs from an RtcEvent: its log time.
export interface EncodableRtcEvent {
  // RtcEvent::timestamp_us().
  readonly timestampUs: bigint;
}

function serializeLittleEndian(value: bigint, bytes: number): Uint8Array {
  const output = new Uint8Array(bytes);
  let v = BigInt.asUintN(64, value);
  for (let i = 0; i < bytes; ++i) {
    output[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return output;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function encodeOptionalValuePositions(positions: readonly boolean[]): Uint8Array {
  const writer = new BitWriter(Math.floor((positions.length + 7) / 8));
  for (const position of positions) {
    writer.writeBitsNumber(position ? 1 : 0, 1);
  }
  return writer.getBytes();
}

export function encodeSingleValue(value: bigint, fieldType: FieldType): Uint8Array {
  switch (fieldType) {
    case FieldType.kFixed8:
      return serializeLittleEndian(value, 1);
    case FieldType.kFixed32:
      return serializeLittleEndian(value, 4);
    case FieldType.kFixed64:
      return serializeLittleEndian(value, 8);
    case FieldType.kVarInt:
      return encodeVarInt(value);
    case FieldType.kString:
      return new Uint8Array(0);
  }
}

export function encodeDeltasV3(params: FixedLengthEncodingParametersV3, base: bigint, values: readonly bigint[]): Uint8Array {
  const outputbound = Math.floor((values.length * params.deltaBitWidth() + 7) / 8);
  const writer = new BitWriter(outputbound);

  let previous = base;
  for (const value of values) {
    if (params.signedDeltas()) {
      const positiveDelta = unsignedDelta(previous, value, params.valueMask());
      const negativeDelta = unsignedDelta(value, previous, params.valueMask());
      let delta: bigint;
      if (positiveDelta <= negativeDelta) {
        delta = positiveDelta;
      } else {
        // Compute the two's complement representation of a negative
        // delta, in a field width params_.delta_mask().
        delta = params.deltaMask() - negativeDelta + 1n;
      }
      writer.writeBits(delta, params.deltaBitWidth());
    } else {
      const delta = unsignedDelta(previous, value, params.valueMask());
      writer.writeBits(delta, params.deltaBitWidth());
    }
    previous = value;
  }

  return writer.getBytes();
}

// The EventEncoder is used to encode a batch of events.
export class EventEncoder {
  private readonly batchSize: number;
  private eventTag = 0n;
  private readonly encodedFields: Uint8Array[] = [];

  constructor(params: EventParameters, batch: readonly EncodableRtcEvent[]) {
    this.batchSize = batch.length;
    if (batch.length !== 0) {
      // Encode event type.
      const batched = batch.length > 1 ? 1n : 0n;
      this.eventTag = (BigInt(params.id) << 1n) + batched;

      // Encode number of events in batch
      if (batched) {
        this.encodedFields.push(encodeVarInt(BigInt(batch.length)));
      }

      // Encode timestamp (RtcEvent::timestamp_ms(): truncating division).
      const timestamps = batch.map((event) => encodeAsUnsigned(event.timestampUs / 1000n, IntegerTypes.int64));
      this.encodeField(kTimestampParams, timestamps);
    }
  }

  // EncodeField(params, ValuesWithPositions).
  encodeOptionalField(params: FieldParameters, values: ValuesWithPositions): void {
    this.encodeField(params, values.values, values.positionMask);
  }

  encodeField(params: FieldParameters, values: readonly bigint[], positions?: readonly boolean[]): void {
    if (values.length === 0) {
      // If all values for a particular field is empty/nullopt,
      // then we completely skip the field even if the the batch is non-empty.
      return;
    }

    // We know that each event starts with the varint encoded timestamp,
    // so we omit that field tag (field id + field type). In all other
    // cases, we write the field tag.
    if (params.fieldId !== FieldParameters.kTimestampField) {
      const fieldTag = (params.fieldId << 3n) + BigInt(params.fieldType);
      this.encodedFields.push(encodeVarInt(fieldTag));
    }

    if (this.batchSize === 1) {
      this.encodedFields.push(encodeSingleValue(values[0], params.fieldType));
      return;
    }

    const valuesOptional = values.length !== this.batchSize;

    // Compute delta parameters
    const base = values[0];
    const remainingValues = values.slice(1);

    const deltaParams = FixedLengthEncodingParametersV3.calculateParameters(
      base,
      remainingValues,
      params.valueWidth,
      valuesOptional,
    );

    this.encodedFields.push(encodeVarInt(deltaParams.deltaHeaderAsInt()));

    if (valuesOptional) {
      if (positions === undefined) throw new Error("Check failed: positions");
      this.encodedFields.push(encodeOptionalValuePositions(positions));
    }
    // Base element, encoded as uint8, uint32, uint64 or varint
    this.encodedFields.push(encodeSingleValue(base, params.fieldType));

    // If all (existing) values are equal to the base, then we can skip
    // writing the all-zero deltas, and instead infer those from the delta
    // header.
    if (!deltaParams.valuesEqual()) {
      this.encodedFields.push(encodeDeltasV3(deltaParams, base, remainingValues));
    }
  }

  encodeStringField(params: FieldParameters, values: readonly Uint8Array[]): void {
    if (values.length === 0) {
      return;
    }

    // Write the field tag.
    if (params.fieldId === FieldParameters.kTimestampField) {
      throw new Error("Check failed: params.field_id != kTimestampField");
    }
    const fieldTag = (params.fieldId << 3n) + BigInt(params.fieldType);
    this.encodedFields.push(encodeVarInt(fieldTag));

    if (values.length > 1) {
      // If multiple values in the batch, write the encoding
      // parameters. (Values >0 reserved for future use.)
      this.encodedFields.push(encodeVarInt(0n));
    }

    // Write the strings as (length, data) pairs.
    for (const s of values) {
      this.encodedFields.push(encodeVarInt(BigInt(s.length)));
      this.encodedFields.push(s.slice());
    }
  }

  asBytes(): Uint8Array {
    if (this.batchSize === 0) {
      return new Uint8Array(0);
    }
    const fields = concat(this.encodedFields);
    // Encode event tag (event id and whether batch or single event), the size
    // of the remaining fields and the fields.
    return concat([encodeVarInt(this.eventTag), encodeVarInt(BigInt(fields.length)), fields]);
  }
}
