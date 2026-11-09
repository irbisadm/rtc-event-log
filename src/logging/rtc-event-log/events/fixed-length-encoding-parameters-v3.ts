// Port of logging/rtc_event_log/events/fixed_length_encoding_parameters_v3.h @ M154.

import {maxUnsignedValueOfBitWidth, signedBitWidth, unsignedBitWidth, unsignedDelta} from "./rtc-event-field-extraction.js";

// Parameters for fixed-size delta-encoding/decoding.
// These are tailored for the sequence which will be encoded (e.g. widths).
export class FixedLengthEncodingParametersV3 {
  private readonly deltaMaskValue: bigint;
  private readonly valueMaskValue: bigint;

  private constructor(
    private readonly deltaBitWidthValue: number,
    private readonly signedDeltasValue: boolean,
    private readonly valuesOptionalValue: boolean,
    private readonly valueBitWidthValue: number,
  ) {
    this.deltaMaskValue = maxUnsignedValueOfBitWidth(deltaBitWidthValue);
    this.valueMaskValue = maxUnsignedValueOfBitWidth(valueBitWidthValue);
  }

  static validParameters(deltaBitWidth: number, signedDeltas: boolean, valueBitWidth: number): boolean {
    return (
      1 <= deltaBitWidth &&
      deltaBitWidth <= 64 &&
      1 <= valueBitWidth &&
      valueBitWidth <= 64 &&
      (deltaBitWidth <= valueBitWidth || (signedDeltas && deltaBitWidth === 64))
    );
  }

  static calculateParameters(
    base: bigint,
    values: readonly bigint[],
    valueBitWidth: number,
    valuesOptional: boolean,
  ): FixedLengthEncodingParametersV3 {
    // As a special case, if all of the elements are identical to the base
    // we just encode the base value with a special delta header.
    if (values.every((val) => val === base)) {
      // Delta header with signed=true and delta_bitwidth=64
      return new FixedLengthEncodingParametersV3(64, true, valuesOptional, valueBitWidth);
    }

    const bitMask = maxUnsignedValueOfBitWidth(valueBitWidth);

    // Calculate the bitwidth required to encode all deltas when using a
    // unsigned or signed represenation, respectively. For the unsigned
    // representation, we just track the largest delta. For the signed
    // representation, we have two possibilities for each delta; either
    // going "forward" (i.e. current - previous) or "backwards"
    // (i.e. previous - current) where both values are calculated with
    // wrap around. We then track the largest positive and negative
    // magnitude across the batch, assuming that we choose the smaller
    // delta for each element.
    let maxUnsignedDelta = 0n;
    let maxPositiveSignedDelta = 0n;
    let minNegativeSignedDelta = 0n;
    let prev = base;
    for (const current of values) {
      const positiveDelta = unsignedDelta(prev, current, bitMask);
      const negativeDelta = unsignedDelta(current, prev, bitMask);

      if (positiveDelta > maxUnsignedDelta) maxUnsignedDelta = positiveDelta;

      if (positiveDelta < negativeDelta) {
        if (positiveDelta > maxPositiveSignedDelta) maxPositiveSignedDelta = positiveDelta;
      } else {
        if (negativeDelta > minNegativeSignedDelta) minNegativeSignedDelta = negativeDelta;
      }

      prev = current;
    }

    // We now know the largest unsigned delta and the largest magnitudes of
    // positive and negative signed deltas. Get the bitwidths required for
    // each of the two encodings.
    const unsignedDeltaBitWidth = unsignedBitWidth(maxUnsignedDelta);
    const signedDeltaBitWidth = signedBitWidth(maxPositiveSignedDelta, minNegativeSignedDelta);

    // Note: Preference for unsigned if the two have the same width (efficiency).
    const useSignedDeltas = signedDeltaBitWidth < unsignedDeltaBitWidth;
    const deltaBitWidth = useSignedDeltas ? signedDeltaBitWidth : unsignedDeltaBitWidth;

    return new FixedLengthEncodingParametersV3(deltaBitWidth, useSignedDeltas, valuesOptional, valueBitWidth);
  }

  static parseDeltaHeader(header: bigint, valueBitWidth: number): FixedLengthEncodingParametersV3 | undefined {
    const deltaBitWidth = Number(header & ((1n << 6n) - 1n)) + 1;
    const signedDeltas = (header & (1n << 6n)) !== 0n;
    const valuesOptional = (header & (1n << 7n)) !== 0n;

    if (header >= 1n << 8n) {
      // Failed to parse delta header; unread bits remaining.
      return undefined;
    }

    if (!FixedLengthEncodingParametersV3.validParameters(deltaBitWidth, signedDeltas, valueBitWidth)) {
      // Failed to parse delta header. Invalid combination of values.
      return undefined;
    }

    return new FixedLengthEncodingParametersV3(deltaBitWidth, signedDeltas, valuesOptional, valueBitWidth);
  }

  deltaHeaderAsInt(): bigint {
    let header = this.deltaBitWidthValue - 1;
    if (!(header < 1 << 6)) throw new Error("Check failed: header < 1 << 6");
    if (this.signedDeltasValue) {
      header += 1 << 6;
    }
    if (!(header < 1 << 7)) throw new Error("Check failed: header < 1 << 7");
    if (this.valuesOptionalValue) {
      header += 1 << 7;
    }
    return BigInt(header);
  }

  // Number of bits necessary to hold the widest(*) of the deltas between the
  // values in the sequence.
  // (*) - Widest might not be the largest, if signed deltas are used.
  deltaBitWidth(): number {
    return this.deltaBitWidthValue;
  }

  // Whether deltas are signed.
  signedDeltas(): boolean {
    return this.signedDeltasValue;
  }

  // Whether the values of the sequence are optional.
  valuesOptional(): boolean {
    return this.valuesOptionalValue;
  }

  // Whether all values are equal. 64-bit signed deltas are assumed to not
  // occur, since those could equally well be represented using 64 bit unsigned
  // deltas.
  valuesEqual(): boolean {
    return this.deltaBitWidthValue === 64 && this.signedDeltasValue;
  }

  // Number of bits necessary to hold the largest value in the sequence.
  valueBitWidth(): number {
    return this.valueBitWidthValue;
  }

  // Masks where only the bits relevant to the deltas/values are turned on.
  deltaMask(): bigint {
    return this.deltaMaskValue;
  }
  valueMask(): bigint {
    return this.valueMaskValue;
  }
}
