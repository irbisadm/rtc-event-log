// Port of logging/rtc_event_log/encoder/delta_encoding.h @ M154.
//
// Fixed-length delta encoding of a sequence of optional uint64 values relative
// to an optional base. Values are `bigint` in [0, 2^64); a missing value
// (std::nullopt) is `undefined`.

import {BitstreamReader} from "../../../rtc-base/bitstream-reader.js";
import {BitWriter} from "./bit-writer.js";
import {decodeVarIntFromReader, encodeVarInt, kMaxVarIntLengthBytes} from "./var-int.js";

export type OptionalU64 = bigint | undefined;

const kU64Max = (1n << 64n) - 1n;

let gForceUnsignedForTesting = false;
let gForceSignedForTesting = false;

function bitsToBytes(bits: number): number {
  return Math.ceil(bits / 8);
}

function unsignedBitWidth(input: bigint, zeroValAsZeroWidth = false): number {
  if (zeroValAsZeroWidth && input === 0n) {
    return 0;
  }
  let width = 0;
  do {
    // input == 0 -> width == 1
    width += 1;
    input >>= 1n;
  } while (input !== 0n);
  return width;
}

function signedBitWidth(maxPosMagnitude: bigint, maxNegMagnitude: bigint): number {
  const bitwidthPos = unsignedBitWidth(maxPosMagnitude, true);
  const bitwidthNeg = maxNegMagnitude > 0n ? unsignedBitWidth(maxNegMagnitude - 1n, true) : 0;
  return 1 + Math.max(bitwidthPos, bitwidthNeg);
}

function maxUnsignedValueOfBitWidth(bitWidth: number): bigint {
  return bitWidth === 64 ? kU64Max : (1n << BigInt(bitWidth)) - 1n;
}

// (current - previous) & bitMask, in uint64 arithmetic.
function unsignedDelta(previous: bigint, current: bigint, bitMask: bigint): bigint {
  return (current - previous) & bitMask;
}

const enum EncodingType {
  kFixedSizeUnsignedDeltasNoEarlyWrapNoOpt = 0,
  kFixedSizeSignedDeltasEarlyWrapAndOptSupported = 1,
  kReserved1 = 2,
  kReserved2 = 3,
}

const kBitsInHeaderForEncodingType = 2;
const kBitsInHeaderForDeltaWidthBits = 6;
const kBitsInHeaderForSignedDeltas = 1;
const kBitsInHeaderForValuesOptional = 1;
const kBitsInHeaderForValueWidthBits = 6;

const kDefaultSignedDeltas = false;
const kDefaultValuesOptional = false;
const kDefaultValueWidthBits = 64;

class FixedLengthEncodingParameters {
  static validParameters(deltaWidthBits: number, _signedDeltas: boolean, valueWidthBits: number): boolean {
    return (
      1 <= deltaWidthBits &&
      deltaWidthBits <= 64 &&
      1 <= valueWidthBits &&
      valueWidthBits <= 64 &&
      deltaWidthBits <= valueWidthBits
    );
  }

  deltaWidthBits: number; // Normally const, but mutable in tests.
  signedDeltas: boolean; // Normally const, but mutable in tests.
  readonly valuesOptional: boolean;
  readonly valueWidthBits: number;
  deltaMask: bigint; // Normally const, but mutable in tests.
  readonly valueMask: bigint;

  constructor(deltaWidthBits: number, signedDeltas: boolean, valuesOptional: boolean, valueWidthBits: number) {
    this.deltaWidthBits = deltaWidthBits;
    this.signedDeltas = signedDeltas;
    this.valuesOptional = valuesOptional;
    this.valueWidthBits = valueWidthBits;
    this.deltaMask = maxUnsignedValueOfBitWidth(deltaWidthBits);
    this.valueMask = maxUnsignedValueOfBitWidth(valueWidthBits);
  }

  setSignedDeltas(signedDeltas: boolean): void {
    this.signedDeltas = signedDeltas;
  }

  setDeltaWidthBits(deltaWidthBits: number): void {
    this.deltaWidthBits = deltaWidthBits;
    this.deltaMask = maxUnsignedValueOfBitWidth(deltaWidthBits);
  }
}

interface MinAndMaxDeltas {
  maxUnsignedDelta: bigint;
  maxPosSignedDelta: bigint;
  minNegSignedDelta: bigint;
}

class FixedLengthDeltaEncoder {
  // See encodeDeltas() below.
  static encodeDeltas(base: OptionalU64, values: readonly OptionalU64[]): Uint8Array {
    if (values.every((val) => val === base)) {
      // Either all values are nullopt, or all values are equal to the base.
      return new Uint8Array(0);
    }

    let nonDecreasing = true;
    let maxValueIncludingBase = base ?? 0n;
    let existentValuesCount = 0;
    {
      let previous = base ?? 0n;
      for (const value of values) {
        if (value === undefined) {
          continue;
        }
        ++existentValuesCount;
        nonDecreasing &&= previous <= value;
        if (value > maxValueIncludingBase) maxValueIncludingBase = value;
        previous = value;
      }
    }

    // If the sequence is non-decreasing, it may be assumed to have width = 64;
    // there's no reason to encode the actual max width in the encoding header.
    const valueWidthBits = nonDecreasing ? 64 : unsignedBitWidth(maxValueIncludingBase);

    const deltas = FixedLengthDeltaEncoder.calculateMinAndMaxDeltas(base, values, valueWidthBits);

    const deltaWidthBitsUnsigned = unsignedBitWidth(deltas.maxUnsignedDelta);
    const deltaWidthBitsSigned = signedBitWidth(deltas.maxPosSignedDelta, deltas.minNegSignedDelta);

    // Note: Preference for unsigned if the two have the same width (efficiency).
    const signedDeltas = deltaWidthBitsSigned < deltaWidthBitsUnsigned;
    const deltaWidthBits = signedDeltas ? deltaWidthBitsSigned : deltaWidthBitsUnsigned;

    const valuesOptional = base === undefined || existentValuesCount < values.length;

    const params = new FixedLengthEncodingParameters(deltaWidthBits, signedDeltas, valuesOptional, valueWidthBits);

    // No effect in production.
    FixedLengthDeltaEncoder.considerTestOverrides(params, deltaWidthBitsSigned, deltaWidthBitsUnsigned);

    const encoder = new FixedLengthDeltaEncoder(params, base, values, existentValuesCount);
    return encoder.encode();
  }

  private static calculateMinAndMaxDeltas(
    base: OptionalU64,
    values: readonly OptionalU64[],
    bitWidth: number,
  ): MinAndMaxDeltas {
    const bitMask = maxUnsignedValueOfBitWidth(bitWidth);

    let maxUnsignedDelta = 0n;
    let maxPosSignedDelta = 0n;
    let minNegSignedDelta = 0n;

    let prev = base;
    for (const value of values) {
      if (value === undefined) {
        continue;
      }

      if (prev === undefined) {
        // If the base is non-existent, the first existent value is encoded as
        // a varint, rather than as a delta.
        prev = value;
        continue;
      }

      const current = value;

      const forwardDelta = unsignedDelta(prev, current, bitMask);
      const backwardDelta = unsignedDelta(current, prev, bitMask);

      if (forwardDelta > maxUnsignedDelta) maxUnsignedDelta = forwardDelta;

      if (forwardDelta < backwardDelta) {
        if (forwardDelta > maxPosSignedDelta) maxPosSignedDelta = forwardDelta;
      } else {
        if (backwardDelta > minNegSignedDelta) minNegSignedDelta = backwardDelta;
      }

      prev = current;
    }

    return {maxUnsignedDelta, maxPosSignedDelta, minNegSignedDelta};
  }

  private static considerTestOverrides(
    params: FixedLengthEncodingParameters,
    deltaWidthBitsSigned: number,
    deltaWidthBitsUnsigned: number,
  ): void {
    if (gForceUnsignedForTesting) {
      params.setDeltaWidthBits(deltaWidthBitsUnsigned);
      params.setSignedDeltas(false);
    } else if (gForceSignedForTesting) {
      params.setDeltaWidthBits(deltaWidthBitsSigned);
      params.setSignedDeltas(true);
    } else {
      // Unchanged.
    }
  }

  private readonly params: FixedLengthEncodingParameters;
  private readonly base: OptionalU64;
  private readonly values: readonly OptionalU64[];
  private readonly writer: BitWriter;

  private constructor(
    params: FixedLengthEncodingParameters,
    base: OptionalU64,
    values: readonly OptionalU64[],
    existentValuesCount: number,
  ) {
    this.params = params;
    this.base = base;
    this.values = values;
    this.writer = new BitWriter(this.outputLengthBytes(existentValuesCount));
  }

  private encode(): Uint8Array {
    this.encodeHeader();

    if (this.params.valuesOptional) {
      for (const value of this.values) {
        this.writer.writeBitsNumber(value !== undefined ? 1 : 0, 1);
      }
    }

    let previous = this.base;
    for (const value of this.values) {
      if (value === undefined) {
        continue;
      }

      if (previous === undefined) {
        this.writer.writeBytes(encodeVarInt(value));
      } else {
        this.encodeDelta(previous, value);
      }

      previous = value;
    }

    return this.writer.getBytes();
  }

  private outputLengthBytes(existentValuesCount: number): number {
    return bitsToBytes(this.headerLengthBits() + this.encodedDeltasLengthBits(existentValuesCount));
  }

  private headerLengthBits(): number {
    if (
      this.params.signedDeltas === kDefaultSignedDeltas &&
      this.params.valuesOptional === kDefaultValuesOptional &&
      this.params.valueWidthBits === kDefaultValueWidthBits
    ) {
      return kBitsInHeaderForEncodingType + kBitsInHeaderForDeltaWidthBits;
    } else {
      return (
        kBitsInHeaderForEncodingType +
        kBitsInHeaderForDeltaWidthBits +
        kBitsInHeaderForSignedDeltas +
        kBitsInHeaderForValuesOptional +
        kBitsInHeaderForValueWidthBits
      );
    }
  }

  private encodedDeltasLengthBits(existentValuesCount: number): number {
    if (!this.params.valuesOptional) {
      return this.values.length * this.params.deltaWidthBits;
    } else {
      const existenceBitmapSizeBits = 1 * this.values.length;
      const firstValueIsVarint = this.base === undefined && existentValuesCount >= 1;
      const firstValueVarintSizeBits = 8 * kMaxVarIntLengthBytes;
      const deltasCount = existentValuesCount - (firstValueIsVarint ? 1 : 0);
      const deltasSizeBits = deltasCount * this.params.deltaWidthBits;
      return existenceBitmapSizeBits + firstValueVarintSizeBits + deltasSizeBits;
    }
  }

  private encodeHeader(): void {
    const encodingType =
      this.params.valueWidthBits === kDefaultValueWidthBits &&
      this.params.signedDeltas === kDefaultSignedDeltas &&
      this.params.valuesOptional === kDefaultValuesOptional
        ? EncodingType.kFixedSizeUnsignedDeltasNoEarlyWrapNoOpt
        : EncodingType.kFixedSizeSignedDeltasEarlyWrapAndOptSupported;

    this.writer.writeBitsNumber(encodingType, kBitsInHeaderForEncodingType);

    // Widths are never 0, so width w is written as w - 1.
    this.writer.writeBitsNumber(this.params.deltaWidthBits - 1, kBitsInHeaderForDeltaWidthBits);

    if (encodingType === EncodingType.kFixedSizeUnsignedDeltasNoEarlyWrapNoOpt) {
      return;
    }

    this.writer.writeBitsNumber(this.params.signedDeltas ? 1 : 0, kBitsInHeaderForSignedDeltas);
    this.writer.writeBitsNumber(this.params.valuesOptional ? 1 : 0, kBitsInHeaderForValuesOptional);
    this.writer.writeBitsNumber(this.params.valueWidthBits - 1, kBitsInHeaderForValueWidthBits);
  }

  private encodeDelta(previous: bigint, current: bigint): void {
    if (this.params.signedDeltas) {
      this.encodeSignedDelta(previous, current);
    } else {
      this.encodeUnsignedDelta(previous, current);
    }
  }

  private encodeUnsignedDelta(previous: bigint, current: bigint): void {
    const delta = unsignedDelta(previous, current, this.params.valueMask);
    this.writer.writeBits(delta, this.params.deltaWidthBits);
  }

  private encodeSignedDelta(previous: bigint, current: bigint): void {
    const forwardDelta = unsignedDelta(previous, current, this.params.valueMask);
    const backwardDelta = unsignedDelta(current, previous, this.params.valueMask);

    let delta: bigint;
    if (forwardDelta <= backwardDelta) {
      delta = forwardDelta;
    } else {
      // Compute the unsigned representation of a negative delta.
      // This is the two's complement representation of this negative value,
      // when deltas are of width params_.delta_mask().
      delta = BigInt.asUintN(64, this.params.deltaMask - backwardDelta + 1n);
    }

    this.writer.writeBits(delta, this.params.deltaWidthBits);
  }
}

class FixedLengthDeltaDecoder {
  // Checks whether FixedLengthDeltaDecoder is a suitable decoder for this
  // bitstream. Note that this does NOT imply that stream is valid, and will
  // be decoded successfully. It DOES imply that all other decoder classes
  // will fail to decode this input, though.
  static isSuitableDecoderFor(input: Uint8Array): boolean {
    const reader = new BitstreamReader(input);
    const encodingTypeBits = reader.readBitsNumber(kBitsInHeaderForEncodingType);
    if (!reader.ok()) {
      return false;
    }
    return (
      encodingTypeBits === EncodingType.kFixedSizeUnsignedDeltasNoEarlyWrapNoOpt ||
      encodingTypeBits === EncodingType.kFixedSizeSignedDeltasEarlyWrapAndOptSupported
    );
  }

  static decodeDeltas(input: Uint8Array, base: OptionalU64, numOfDeltas: number): OptionalU64[] {
    const decoder = FixedLengthDeltaDecoder.create(input, base, numOfDeltas);
    if (decoder === null) {
      return [];
    }
    return decoder.decode();
  }

  private static create(input: Uint8Array, base: OptionalU64, numOfDeltas: number): FixedLengthDeltaDecoder | null {
    const reader = new BitstreamReader(input);
    // Encoding type
    const encoding = reader.readBitsNumber(kBitsInHeaderForEncodingType);
    if (!reader.ok()) {
      return null;
    }

    if (
      encoding !== EncodingType.kFixedSizeUnsignedDeltasNoEarlyWrapNoOpt &&
      encoding !== EncodingType.kFixedSizeSignedDeltasEarlyWrapAndOptSupported
    ) {
      return null;
    }

    const deltaWidthBits = reader.readBitsNumber(kBitsInHeaderForDeltaWidthBits) + 1;

    // signed_deltas, values_optional, value_width_bits
    let signedDeltas: boolean;
    let valuesOptional: boolean;
    let valueWidthBits: number;
    if (encoding === EncodingType.kFixedSizeUnsignedDeltasNoEarlyWrapNoOpt) {
      signedDeltas = kDefaultSignedDeltas;
      valuesOptional = kDefaultValuesOptional;
      valueWidthBits = kDefaultValueWidthBits;
    } else {
      signedDeltas = reader.readBool();
      valuesOptional = reader.readBool();
      valueWidthBits = reader.readBitsNumber(kBitsInHeaderForValueWidthBits) + 1;
    }

    if (!reader.ok()) {
      return null;
    }

    // Note: Because of the way the parameters are read, it is not possible
    // for illegal values to be read. We check nevertheless, in case the code
    // changes in the future in a way that breaks this promise.
    if (!FixedLengthEncodingParameters.validParameters(deltaWidthBits, signedDeltas, valueWidthBits)) {
      return null;
    }

    const params = new FixedLengthEncodingParameters(deltaWidthBits, signedDeltas, valuesOptional, valueWidthBits);
    return new FixedLengthDeltaDecoder(reader, params, base, numOfDeltas);
  }

  private readonly reader: BitstreamReader;
  private readonly params: FixedLengthEncodingParameters;
  private readonly base: OptionalU64;
  private readonly numOfDeltas: number;

  private constructor(
    reader: BitstreamReader,
    params: FixedLengthEncodingParameters,
    base: OptionalU64,
    numOfDeltas: number,
  ) {
    this.reader = reader;
    this.params = params;
    this.base = base;
    this.numOfDeltas = numOfDeltas;
  }

  private decode(): OptionalU64[] {
    const existingValues: boolean[] = new Array(this.numOfDeltas);
    if (this.params.valuesOptional) {
      for (let i = 0; i < this.numOfDeltas; ++i) {
        existingValues[i] = this.reader.readBool();
      }
    } else {
      existingValues.fill(true);
    }

    let previous = this.base;
    let values: OptionalU64[] = new Array(this.numOfDeltas).fill(undefined);

    for (let i = 0; i < this.numOfDeltas; ++i) {
      if (!existingValues[i]) {
        continue;
      }

      if (previous === undefined) {
        // If the base is non-existent, the first existent value is encoded as
        // a varint, rather than as a delta.
        values[i] = decodeVarIntFromReader(this.reader);
      } else {
        const delta = this.reader.readBits(this.params.deltaWidthBits);
        values[i] = this.applyDelta(previous, delta);
      }

      previous = values[i];
    }

    if (!this.reader.ok()) {
      values = [];
    }

    return values;
  }

  private applyDelta(base: bigint, delta: bigint): bigint {
    return this.params.signedDeltas ? this.applySignedDelta(base, delta) : this.applyUnsignedDelta(base, delta);
  }

  private applyUnsignedDelta(base: bigint, delta: bigint): bigint {
    // Note: May still be used if signed deltas used.
    return (base + delta) & this.params.valueMask;
  }

  private applySignedDelta(base: bigint, delta: bigint): bigint {
    const topBit = 1n << BigInt(this.params.deltaWidthBits - 1);

    const positiveDelta = (delta & topBit) === 0n;
    if (positiveDelta) {
      return this.applyUnsignedDelta(base, delta);
    }

    const deltaAbs = (~delta & this.params.deltaMask) + 1n;
    return (base - deltaAbs) & this.params.valueMask;
  }
}

// Encode `values` as a sequence of deltas following on `base` and return it.
// If all of the values were equal to the base, an empty array is returned;
// this is a valid encoding of that edge case.
// `base` is not guaranteed to be written into the output, and must therefore
// be provided separately to the decoder.
// This function never fails.
export function encodeDeltas(base: OptionalU64, values: readonly OptionalU64[]): Uint8Array {
  return FixedLengthDeltaEncoder.encodeDeltas(base, values);
}

// EncodeDeltas() and DecodeDeltas() are inverse operations;
// invoking DecodeDeltas() over the output of EncodeDeltas(), will return
// the input originally given to EncodeDeltas().
// `numOfDeltas` must be greater than zero. If input is not a valid encoding
// of `numOfDeltas` elements based on `base`, the function returns an empty
// array, which signals an error.
export function decodeDeltas(input: Uint8Array, base: OptionalU64, numOfDeltas: number): OptionalU64[] {
  if (!(numOfDeltas > 0)) throw new Error("decodeDeltas: numOfDeltas must be > 0");

  // The empty string is a special case indicating that all values were equal
  // to the base.
  if (input.length === 0) {
    return new Array<OptionalU64>(numOfDeltas).fill(base);
  }

  if (FixedLengthDeltaDecoder.isSuitableDecoderFor(input)) {
    return FixedLengthDeltaDecoder.decodeDeltas(input, base, numOfDeltas);
  }

  return [];
}

// Test-only: force the encoder to use signed (true) or unsigned (false) deltas.
export function setFixedLengthEncoderDeltaSignednessForTesting(signedness: boolean): void {
  gForceUnsignedForTesting = !signedness;
  gForceSignedForTesting = signedness;
}

export function unsetFixedLengthEncoderDeltaSignednessForTesting(): void {
  gForceUnsignedForTesting = false;
  gForceSignedForTesting = false;
}
