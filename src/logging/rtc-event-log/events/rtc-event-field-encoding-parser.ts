// Port of logging/rtc_event_log/events/rtc_event_field_encoding_parser.h @ M154.
//
// RTC_CHECK failures (a programming error upstream) throw.

import {Timestamp} from "../../../api/units/timestamp.js";
import {BitstreamReader} from "../../../rtc-base/bitstream-reader.js";
import {decodeVarInt} from "../encoder/var-int.js";
import {FixedLengthEncodingParametersV3} from "./fixed-length-encoding-parameters-v3.js";
import {FieldParameters, FieldType} from "./rtc-event-field-encoding.js";
import {decodeFromUnsignedToType, IntegerTypes} from "./rtc-event-field-extraction.js";
import {RtcEventLogParseStatus, RtcEventLogParseStatusOr} from "./rtc-event-log-parse-status.js";

function convertFieldType(value: bigint): FieldType | undefined {
  switch (value) {
    case 0n:
      return FieldType.kFixed8;
    case 1n:
      return FieldType.kFixed32;
    case 2n:
      return FieldType.kFixed64;
    case 3n:
      return FieldType.kVarInt;
    case 4n:
      return FieldType.kString;
    default:
      return undefined;
  }
}

function check(condition: boolean, what: string): void {
  if (!condition) throw new Error(`Check failed: ${what}`);
}

export interface ValueAndPostionView {
  values: bigint[];
  positions: number[];
}

export class EventParser {
  // Tracks whether an error has occurred in one of the helper
  // functions above.
  private error = false;

  // Temporary storage for result.
  private positions: number[] = [];
  private values: bigint[] = [];
  private strings: Uint8Array[] = [];

  // Bytes to be consumed.
  private pendingData: Uint8Array = new Uint8Array(0);
  private numEvents = 1n;

  initialize(s: Uint8Array, batched: boolean): RtcEventLogParseStatus {
    this.pendingData = s;
    this.numEvents = 1n;

    if (batched) {
      this.numEvents = this.readVarInt();
      if (!this.ok()) {
        return RtcEventLogParseStatus.error("Failed to read number of events in batch.");
      }
    }
    return RtcEventLogParseStatus.success();
  }

  // Attempts to parse the field specified by `params`, skipping past
  // other fields that may occur before it. If 'required_field == true',
  // then failing to find the field is an error, otherwise the functions
  // return success, but with an empty view of values.
  parseStringField(params: FieldParameters, requiredField = true): RtcEventLogParseStatusOr<Uint8Array[]> {
    const status = this.parseField(params);
    if (!status.ok()) return RtcEventLogParseStatusOr.ofStatus(status);
    const strings = this.strings;
    if (requiredField && BigInt(strings.length) !== this.numEventsInBatch()) {
      return RtcEventLogParseStatusOr.error("Required string field not found");
    }
    return RtcEventLogParseStatusOr.ofValue(strings);
  }

  parseNumericField(params: FieldParameters, requiredField = true): RtcEventLogParseStatusOr<bigint[]> {
    const status = this.parseField(params);
    if (!status.ok()) return RtcEventLogParseStatusOr.ofStatus(status);
    const values = this.values;
    if (requiredField && BigInt(values.length) !== this.numEventsInBatch()) {
      return RtcEventLogParseStatusOr.error("Required numerical field not found");
    }
    return RtcEventLogParseStatusOr.ofValue(values);
  }

  parseOptionalNumericField(params: FieldParameters, requiredField = true): RtcEventLogParseStatusOr<ValueAndPostionView> {
    const status = this.parseField(params);
    if (!status.ok()) return RtcEventLogParseStatusOr.ofStatus(status);
    const view: ValueAndPostionView = {values: this.values, positions: this.positions};
    if (requiredField && BigInt(view.positions.length) !== this.numEventsInBatch()) {
      return RtcEventLogParseStatusOr.error("Required numerical field not found");
    }
    return RtcEventLogParseStatusOr.ofValue(view);
  }

  // Number of events in a batch.
  numEventsInBatch(): bigint {
    return this.numEvents;
  }

  // Bytes remaining in `pending_data_`.
  remainingBytes(): number {
    return this.pendingData.length;
  }

  private readLittleEndian(bytes: number): bigint {
    let value = 0n;

    if (bytes > this.pendingData.length) {
      this.setError();
      return value;
    }

    for (let i = 0; i < bytes; ++i) {
      value += BigInt(this.pendingData[i]) << BigInt(8 * i);
    }

    this.pendingData = this.pendingData.subarray(bytes);
    return value;
  }

  private readVarInt(): bigint {
    const result = decodeVarInt(this.pendingData);
    this.pendingData = result.rest;
    if (!result.success) {
      this.setError();
    }
    return result.value;
  }

  private readOptionalValuePositions(): bigint {
    const bitsToRead = this.numEventsInBatch();
    if (BigInt(this.pendingData.length) * 8n < bitsToRead) {
      this.setError();
      return 0n;
    }

    const n = Number(bitsToRead);
    const reader = new BitstreamReader(this.pendingData);
    for (let i = 0; i < n; i++) {
      this.positions.push(reader.readBit());
    }
    if (!reader.ok()) {
      this.setError();
      return 0n;
    }

    const numExistingValues = this.positions.filter((p) => p === 1).length;
    this.pendingData = this.pendingData.subarray(Math.floor((n + 7) / 8));
    return BigInt(numExistingValues);
  }

  private readSingleValue(fieldType: FieldType): bigint {
    switch (fieldType) {
      case FieldType.kFixed8:
        return this.readLittleEndian(1);
      case FieldType.kFixed32:
        return this.readLittleEndian(4);
      case FieldType.kFixed64:
        return this.readLittleEndian(8);
      case FieldType.kVarInt:
        return this.readVarInt();
      case FieldType.kString:
        this.setError();
        return 0n;
    }
  }

  private readDeltasAndPopulateValues(params: FixedLengthEncodingParametersV3, numDeltas: bigint, base: bigint): void {
    this.values.push(base);

    const deltaBitWidth = params.deltaBitWidth();
    if (BigInt(this.pendingData.length) * 8n < numDeltas * BigInt(deltaBitWidth)) {
      this.setError();
      return;
    }

    const reader = new BitstreamReader(this.pendingData);
    const topBit = 1n << BigInt(deltaBitWidth - 1);

    let value = base;
    const n = Number(numDeltas);
    for (let i = 0; i < n; ++i) {
      const delta = reader.readBits(deltaBitWidth);
      const negativeDelta = params.signedDeltas() && (delta & topBit) !== 0n;
      if (negativeDelta) {
        const deltaAbs = (~delta & params.deltaMask()) + 1n;
        value = BigInt.asUintN(64, value - deltaAbs) & params.valueMask();
      } else {
        value = BigInt.asUintN(64, value + delta) & params.valueMask();
      }
      this.values.push(value);
    }

    if (!reader.ok()) {
      this.setError();
      return;
    }

    this.pendingData = this.pendingData.subarray(Math.floor((n * deltaBitWidth + 7) / 8));
  }

  private parseNumericFieldInternal(valueBitWidth: number, fieldType: FieldType): RtcEventLogParseStatus {
    if (this.numEvents === 1n) {
      // Just a single value in the batch.
      const base = this.readSingleValue(fieldType);
      if (!this.ok()) {
        return RtcEventLogParseStatus.error("Failed to read value");
      }
      this.positions.push(1);
      this.values.push(base);
    } else {
      // Delta compressed batch.
      // Read delta header.
      const headerValue = this.readVarInt();
      if (!this.ok()) return RtcEventLogParseStatus.error("Failed to read delta header");
      // NB: value_bit_width may be incorrect for the field, if this isn't the
      // field we are looking for.
      const deltaHeader = FixedLengthEncodingParametersV3.parseDeltaHeader(headerValue, valueBitWidth);
      if (deltaHeader === undefined) {
        return RtcEventLogParseStatus.error("Failed to parse delta header");
      }

      let numExistingDeltas = this.numEventsInBatch() - 1n;
      if (deltaHeader.valuesOptional()) {
        const numNonemptyValues = this.readOptionalValuePositions();
        if (!this.ok()) {
          return RtcEventLogParseStatus.error("Failed to read positions of optional values");
        }
        if (numNonemptyValues < 1n || this.numEventsInBatch() < numNonemptyValues) {
          return RtcEventLogParseStatus.error("Expected at least one non_empty value");
        }
        numExistingDeltas = numNonemptyValues - 1n;
      } else {
        // All elements in the batch have values.
        this.positions = new Array<number>(Number(this.numEventsInBatch())).fill(1);
      }

      // Read base.
      const base = this.readSingleValue(fieldType);
      if (!this.ok()) {
        return RtcEventLogParseStatus.error("Failed to read value");
      }

      if (deltaHeader.valuesEqual()) {
        // Duplicate the base value num_existing_deltas times.
        this.values = new Array<bigint>(Number(numExistingDeltas + 1n)).fill(base);
      } else {
        // Read deltas; ceil(num_existing_deltas*delta_width/8) bits
        this.readDeltasAndPopulateValues(deltaHeader, numExistingDeltas, base);
        if (!this.ok()) {
          return RtcEventLogParseStatus.error("Failed to decode deltas");
        }
      }
    }
    return RtcEventLogParseStatus.success();
  }

  private parseStringFieldInternal(): RtcEventLogParseStatus {
    if (this.numEvents > 1n) {
      // String encoding params reserved for future use.
      const encodingParams = this.readVarInt();
      if (!this.ok()) {
        return RtcEventLogParseStatus.error("Failed to read string encoding");
      }
      if (encodingParams !== 0n) {
        return RtcEventLogParseStatus.error("Unrecognized string encoding parameters");
      }
    }
    for (let i = 0n; i < this.numEvents; ++i) {
      // Just a single value in the batch.
      const size = this.readVarInt();
      if (!this.ok()) {
        return RtcEventLogParseStatus.error("Failed to read string size");
      }
      if (size > BigInt(this.pendingData.length)) {
        return RtcEventLogParseStatus.error("String size exceeds remaining data");
      }
      this.strings.push(this.pendingData.subarray(0, Number(size)));
      this.pendingData = this.pendingData.subarray(Number(size));
    }
    return RtcEventLogParseStatus.success();
  }

  // Attempts to parse the field specified by `params`, skipping past
  // other fields that may occur before it. Returns success and populates
  // `values_` (and `positions_`) if the field is found. Returns success and
  // clears `values_` (and `positions_`) if the field doesn't exist. Returns an
  // error if the log is incomplete, malformed or otherwise can't be parsed.
  private parseField(params: FieldParameters): RtcEventLogParseStatus {
    // Initialization for positional fields that don't encode field ID and type.
    let fieldId = params.fieldId;
    let fieldType = params.fieldType;

    // Fields are encoded in increasing field_id order.
    // Skip unknown fields with field_id < params.field_id until we either
    // find params.field_id or a field with higher id, in which case we know that
    // params.field_id doesn't exist.
    while (this.pendingData.length !== 0) {
      const fieldStart = this.pendingData;
      this.clearTemporaries();

      // Read tag for non-positional fields.
      if (params.fieldId !== FieldParameters.kTimestampField) {
        const fieldTag = this.readVarInt();
        if (!this.ok()) return RtcEventLogParseStatus.error("Failed to read field tag");
        // Split tag into field ID and field type.
        fieldId = fieldTag >> 3n;
        const conversion = convertFieldType(fieldTag & 7n);
        if (conversion === undefined) return RtcEventLogParseStatus.error("Failed to parse field type");
        fieldType = conversion;
      }

      if (fieldId > params.fieldId) {
        // We've passed all fields with ids less than or equal to what we are
        // looking for. Reset pending_data_ to first field with id higher than
        // params.field_id, since we didn't find the field we were looking for.
        this.pendingData = fieldStart;
        return RtcEventLogParseStatus.success();
      }

      if (fieldType === FieldType.kString) {
        const status = this.parseStringFieldInternal();
        if (!status.ok()) {
          return status;
        }
      } else {
        const status = this.parseNumericFieldInternal(params.valueWidth, fieldType);
        if (!status.ok()) {
          return status;
        }
      }

      if (fieldId === params.fieldId) {
        // The field we're looking for has been found and values populated.
        return RtcEventLogParseStatus.success();
      }
    }

    // Field not found because the event ended.
    this.clearTemporaries();
    return RtcEventLogParseStatus.success();
  }

  private setError(): void {
    this.error = true;
  }

  private ok(): boolean {
    return !this.error;
  }

  private clearTemporaries(): void {
    this.positions = [];
    this.values = [];
    this.strings = [];
  }
}

// PopulateRtcEventMember for an integral (or enum, via `decode`) member: the
// decoded values, one per event of the batch.
export function populateRtcEventMember<E, V>(
  values: readonly bigint[],
  decode: (value: bigint) => RtcEventLogParseStatusOr<V>,
  set: (event: E, value: V) => void,
  output: readonly E[],
): RtcEventLogParseStatus {
  const batchSize = values.length;
  check(output.length === batchSize, "output.size() == batch_size");
  for (let i = 0; i < batchSize; ++i) {
    const result = decode(values[i]);
    if (!result.ok()) {
      return result.status();
    }
    set(output[i], result.value());
  }
  return RtcEventLogParseStatus.success();
}

// PopulateRtcEventMember for an optional integral member.
export function populateOptionalRtcEventMember<E>(
  positions: readonly number[],
  values: readonly bigint[],
  decode: (value: bigint) => bigint,
  set: (event: E, value: bigint | undefined) => void,
  output: readonly E[],
): RtcEventLogParseStatus {
  const batchSize = positions.length;
  check(output.length === batchSize, "output.size() == batch_size");
  check(values.length <= batchSize, "values.size() <= batch_size");
  let valueIt = 0;
  for (let i = 0; i < batchSize; ++i) {
    if (positions[i]) {
      check(valueIt !== values.length, "value_it != values.end()");
      set(output[i], decode(values[valueIt]));
      ++valueIt;
    } else {
      set(output[i], undefined);
    }
  }
  check(valueIt === values.length, "value_it == values.end()");
  return RtcEventLogParseStatus.success();
}

// PopulateRtcEventTimestamp: millisecond values decoded as int64.
export function populateRtcEventTimestamp<E>(
  values: readonly bigint[],
  set: (event: E, timestamp: Timestamp) => void,
  output: readonly E[],
): RtcEventLogParseStatus {
  const batchSize = values.length;
  check(batchSize === output.length, "batch_size == output.size()");
  for (let i = 0; i < batchSize; ++i) {
    set(output[i], Timestamp.millis(decodeFromUnsignedToType(values[i], IntegerTypes.int64)));
  }
  return RtcEventLogParseStatus.success();
}

// ExtendLoggedBatch: appends `newElements` default-constructed events to
// `output` and returns them. A batch size no array can hold throws (upstream's
// vector::resize fails the same way).
export function extendLoggedBatch<E>(output: E[], newElements: bigint, create: () => E): E[] {
  if (newElements > 0xffffffffn) throw new RangeError("ExtendLoggedBatch: batch too large");
  const batch: E[] = [];
  for (let i = 0n; i < newElements; ++i) {
    const e = create();
    output.push(e);
    batch.push(e);
  }
  return batch;
}
