// Port of logging/rtc_event_log/encoder/delta_encoding_unittest.cc @ M154.

import {
  decodeDeltas,
  encodeDeltas,
  type OptionalU64,
  setFixedLengthEncoderDeltaSignednessForTesting,
  unsetFixedLengthEncoderDeltaSignednessForTesting,
} from "../../../../src/logging/rtc-event-log/encoder/delta-encoding.js";
import {Random} from "../../../rtc-base/random.js";

const kU64Max = (1n << 64n) - 1n;
const kU32Max = 0xffffffff;

const u64 = (x: bigint): bigint => BigInt.asUintN(64, x);

enum DeltaSignedness {
  kNoOverride = 0,
  kForceUnsigned = 1,
  kForceSigned = 2,
}
const kAllSignedness = [DeltaSignedness.kNoOverride, DeltaSignedness.kForceUnsigned, DeltaSignedness.kForceSigned];

function maybeSetSignedness(signedness: DeltaSignedness): void {
  switch (signedness) {
    case DeltaSignedness.kNoOverride:
      unsetFixedLengthEncoderDeltaSignednessForTesting();
      return;
    case DeltaSignedness.kForceUnsigned:
      setFixedLengthEncoderDeltaSignednessForTesting(false);
      return;
    case DeltaSignedness.kForceSigned:
      setFixedLengthEncoderDeltaSignednessForTesting(true);
      return;
  }
}

function randomWithMaxBitWidth(prng: Random, maxWidth: number): bigint {
  const low = BigInt(prng.rand(kU32Max));
  const high = maxWidth > 32 ? BigInt(prng.rand(kU32Max)) : 0n;
  const randomBeforeMask = (high << 32n) | low;
  if (maxWidth < 64) {
    return randomBeforeMask & ((1n << BigInt(maxWidth)) - 1n);
  } else {
    return randomBeforeMask;
  }
}

// Index of the first difference, or -1. (A deep toEqual over 10000-element
// arrays, repeated a few thousand times, is needlessly slow.)
function firstMismatch(a: readonly OptionalU64[], b: readonly OptionalU64[]): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

// Encodes `values` based on `base`, then decodes the result and makes sure
// that it is equal to the original input. Returns the encoding.
function testEncodingAndDecoding(base: OptionalU64, values: readonly OptionalU64[]): Uint8Array {
  const encoded = encodeDeltas(base, values);
  const decoded = decodeDeltas(encoded, base, values.length);
  const mismatch = firstMismatch(decoded, values);
  if (mismatch !== -1) {
    // Produces a readable failure message.
    expect({index: mismatch, decoded: decoded[mismatch], length: decoded.length}).toEqual({
      index: mismatch,
      decoded: values[mismatch],
      length: values.length,
    });
  }
  return encoded;
}

function createSequenceByFirstValue(first: bigint, sequenceLength: number): OptionalU64[] {
  const sequence: OptionalU64[] = new Array(sequenceLength);
  for (let i = 0; i < sequenceLength; ++i) {
    sequence[i] = u64(first + BigInt(i));
  }
  return sequence;
}

function createSequenceByLastValue(last: bigint, numValues: number): OptionalU64[] {
  const first = u64(last - BigInt(numValues) + 1n);
  return createSequenceByFirstValue(first, numValues);
}

// If `sequenceLength` is greater than the number of deltas, the sequence of
// deltas will wrap around.
function createSequenceByOptionalDeltas(
  first: bigint,
  deltas: readonly OptionalU64[],
  sequenceLength: number,
): OptionalU64[] {
  const sequence: OptionalU64[] = new Array(sequenceLength).fill(undefined);
  let previous = first;
  for (let i = 0, nextDeltaIndex = 0; i < sequence.length; ++i) {
    const delta = deltas[nextDeltaIndex];
    if (delta !== undefined) {
      previous = u64(previous + delta);
      sequence[i] = previous;
    }
    nextDeltaIndex = (nextDeltaIndex + 1) % deltas.length;
  }
  return sequence;
}

function encodingLengthUpperBound(
  deltaMaxBitWidth: number,
  numOfDeltas: number,
  signednessOverride: DeltaSignedness,
): number {
  let smallestHeaderSizeBytes: number;
  switch (signednessOverride) {
    case DeltaSignedness.kNoOverride:
    case DeltaSignedness.kForceUnsigned:
      smallestHeaderSizeBytes = 1;
      break;
    case DeltaSignedness.kForceSigned:
      smallestHeaderSizeBytes = 2;
      break;
  }
  return deltaMaxBitWidth * numOfDeltas + smallestHeaderSizeBytes;
}

// If `sequenceLength` is greater than the number of deltas, the sequence of
// deltas will wrap around.
function createSequenceByDeltas(first: bigint, deltas: readonly bigint[], sequenceLength: number): OptionalU64[] {
  return createSequenceByOptionalDeltas(first, deltas, sequenceLength);
}

// std::optional ordering: nullopt is less than any value.
function optionalLess(a: OptionalU64, b: OptionalU64): boolean {
  if (b === undefined) return false;
  if (a === undefined) return true;
  return a < b;
}

function combine<T extends unknown[]>(...lists: {[K in keyof T]: readonly T[K][]}): T[] {
  let result: unknown[][] = [[]];
  for (const list of lists) {
    result = result.flatMap((prefix) => list.map((item) => [...prefix, item]));
  }
  return result as T[];
}

afterAll(() => {
  unsetFixedLengthEncoderDeltaSignednessForTesting();
});

// SignednessOverrideAndNumberOfValuesInSequence/DeltaEncodingTest
describe.each(combine<[DeltaSignedness, number, boolean, number]>(kAllSignedness, [1, 2, 100, 10000], [false, true], [10, 20, 30]))(
  "DeltaEncodingTest(signedness=%i, values=%i, optional=%s, seed=%i)",
  (signedness, numOfValues, optionalValues, partialRandomSeed) => {
    const seed = () => 2 * signedness + 3 * numOfValues + 5 * (optionalValues ? 1 : 0) + 7 * partialRandomSeed;

    beforeEach(() => {
      maybeSetSignedness(signedness);
    });

    test("AllValuesEqualToExistentBaseValue", () => {
      const base: OptionalU64 = 3432n;
      const values: OptionalU64[] = new Array(numOfValues).fill(base);
      const encoded = testEncodingAndDecoding(base, values);
      expect(encoded.length).toBe(0);
    });

    test("AllValuesEqualToNonExistentBaseValue", () => {
      if (!optionalValues) {
        return; // Test irrelevant for this case.
      }
      const base: OptionalU64 = undefined;
      const values: OptionalU64[] = new Array(numOfValues).fill(base);
      const encoded = testEncodingAndDecoding(base, values);
      expect(encoded.length).toBe(0);
    });

    test("BaseNonExistentButSomeOtherValuesExist", () => {
      if (!optionalValues) {
        return; // Test irrelevant for this case.
      }
      const base: OptionalU64 = undefined;
      const values: OptionalU64[] = new Array(numOfValues).fill(undefined);

      const prng = new Random(seed());

      const maxBitWidth = 1 + prng.rand(63); // [1, 64]

      for (let i = 0; i < values.length; ) {
        // Leave a random number of values as non-existent.
        const nonExistentCount = prng.rand(values.length - i - 1);
        i += nonExistentCount;

        // Assign random values to a random number of values. (At least one, to
        // prevent this iteration of the outer loop from being a no-op.)
        const existentCount = Math.max(prng.rand(values.length - i - 1), 1);
        for (let j = 0; j < existentCount; ++j) {
          values[i + j] = randomWithMaxBitWidth(prng, maxBitWidth);
        }
        i += existentCount;
      }

      testEncodingAndDecoding(base, values);
    });

    // Tests that are relevant for both optional and non-optional values follow.

    test("MinDeltaNoWrapAround", () => {
      const base = 3432n;

      const values = createSequenceByFirstValue(base + 1n, numOfValues);
      expect(optionalLess(base, values[values.length - 1])).toBe(true); // Sanity; must not wrap around

      if (optionalValues) {
        values[0] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });

    test("BigDeltaNoWrapAround", () => {
      const kBigDelta = 132828n;
      const base = 3432n;

      const values = createSequenceByFirstValue(base + kBigDelta, numOfValues);
      expect(optionalLess(base, values[values.length - 1])).toBe(true); // Sanity; must not wrap around

      if (optionalValues) {
        values[0] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });

    test("MaxDeltaNoWrapAround", () => {
      const base = 3432n;

      const values = createSequenceByLastValue(kU64Max, numOfValues);
      expect(optionalLess(base, values[values.length - 1])).toBe(true); // Sanity; must not wrap around

      if (optionalValues) {
        values[0] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });

    test("SmallDeltaWithWrapAroundComparedToBase", () => {
      if (optionalValues && numOfValues === 1) {
        return; // Inapplicable
      }

      const base = kU64Max;

      const values = createSequenceByDeltas(base, [1n, 10n, 3n], numOfValues);
      expect(optionalLess(values[0], base)).toBe(true); // Sanity; must wrap around

      if (optionalValues) {
        values[1] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });

    test("SmallDeltaWithWrapAroundInValueSequence", () => {
      if (numOfValues === 1 || (optionalValues && numOfValues < 3)) {
        return; // Inapplicable.
      }

      const base = kU64Max - 2n;

      const values = createSequenceByDeltas(base, [1n, 10n, 3n], numOfValues);
      expect(optionalLess(values[values.length - 1], values[0])).toBe(true); // Sanity; must wrap around

      if (optionalValues) {
        values[1] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });

    test("BigDeltaWithWrapAroundComparedToBase", () => {
      if (optionalValues && numOfValues === 1) {
        return; // Inapplicable
      }

      const kBigDelta = 132828n;
      const base = kU64Max - kBigDelta + 3n;

      const values = createSequenceByFirstValue(u64(base + kBigDelta), numOfValues);
      expect(optionalLess(values[0], base)).toBe(true); // Sanity; must wrap around

      if (optionalValues) {
        values[1] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });

    test("BigDeltaWithWrapAroundInValueSequence", () => {
      if (numOfValues === 1 || (optionalValues && numOfValues < 3)) {
        return; // Inapplicable.
      }

      const kBigDelta = 132828n;
      const base = kU64Max - kBigDelta + 3n;

      const values = createSequenceByFirstValue(kU64Max, numOfValues);
      expect(optionalLess(values[values.length - 1], values[0])).toBe(true); // Sanity; must wrap around

      if (optionalValues) {
        values[1] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });

    // Tests that are relevant for both optional and non-optional values follow.

    test("MaxDeltaWithWrapAroundComparedToBase", () => {
      if (optionalValues && numOfValues === 1) {
        return; // Inapplicable
      }

      const base = 3432n;
      const values = createSequenceByFirstValue(base - 1n, numOfValues);
      if (optionalValues) {
        values[1] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });

    test("MaxDeltaWithWrapAroundInValueSequence", () => {
      if (numOfValues === 1 || (optionalValues && numOfValues < 3)) {
        return; // Inapplicable.
      }

      const base = 3432n;

      const values = createSequenceByDeltas(base, [0n, kU64Max, 3n], numOfValues);
      // Sanity; must wrap around
      if (optionalValues) {
        values[1] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });

    test("ZeroDelta", () => {
      const base = 3432n;

      // Arbitrary sequence of deltas with intentional zero deltas, as well as
      // consecutive zeros.
      const deltas = [0n, 312n, 11n, 1n, 1n, 0n, 0n, 12n, 400321n, 3n, 3n, 12n, 5n, 0n, 6n];
      const values = createSequenceByDeltas(base, deltas, numOfValues);

      if (optionalValues) {
        values[0] = undefined;
      }

      testEncodingAndDecoding(base, values);
    });
  },
);

const kDeltaMaxBitWidths = [1, 4, 8, 15, 16, 17, 31, 32, 33, 63, 64];

// SignednessOverrideAndDeltaMaxBitWidthAndNumberOfValuesInSequence/DeltaEncodingCompressionQualityTest
describe.each(combine<[DeltaSignedness, number, number, number]>(kAllSignedness, kDeltaMaxBitWidths, [1, 2, 100, 10000], [11, 12, 13]))(
  "DeltaEncodingCompressionQualityTest(signedness=%i, width=%i, values=%i, seed=%i)",
  (signedness, deltaMaxBitWidth, numOfValues, partialRandomSeed) => {
    const seed = () =>
      2 * signedness + 3 * deltaMaxBitWidth + 5 * deltaMaxBitWidth + 7 * numOfValues + 11 * partialRandomSeed;

    beforeEach(() => {
      maybeSetSignedness(signedness);
    });

    // If no wrap-around occurs in the stream, the width of the values does not
    // matter to compression performance; only the deltas matter.
    test("BaseDoesNotAffectEfficiency", () => {
      // 1. Bases which will not produce a wrap-around.
      // 2. The last base - 0xffffffffffffffff - does cause a wrap-around, but
      //    that still works, because the width is 64 anyway, and does not
      //    need to be conveyed explicitly in the encoding header.
      const bases = [0n, 0x55n, 0xffffffffn, kU64Max];

      let deltas: bigint[] = new Array(numOfValues).fill(0n);

      // Allows us to make sure that the deltas do not produce a wrap-around.
      const lastElement = bases.map((b) => u64(b + 1n));

      // Avoid empty `deltas` due to first element causing wrap-around.
      deltas[0] = 1n;

      const prng = new Random(seed());

      for (let i = 1; i < deltas.length; ++i) {
        const delta = randomWithMaxBitWidth(prng, deltaMaxBitWidth);

        let wrapAround = false;
        for (let j = 0; j < lastElement.length; ++j) {
          lastElement[j] = u64(lastElement[j] + delta);
          if (lastElement[j] < bases[j]) {
            wrapAround = true;
            break;
          }
        }

        if (wrapAround) {
          deltas = deltas.slice(0, i);
          break;
        }

        deltas[i] = delta;
      }

      const encodings: Uint8Array[] = [];
      for (const base of bases) {
        const values = createSequenceByDeltas(base, deltas, numOfValues);
        // Note: Only the deltas matter, not the bases.
        const encoded = testEncodingAndDecoding(base, values);
        expect(encoded.length).toBeLessThanOrEqual(encodingLengthUpperBound(deltaMaxBitWidth, numOfValues, signedness));
        encodings.push(encoded);
      }

      for (const encoded of encodings) {
        expect(Buffer.from(encoded).equals(Buffer.from(encodings[0]))).toBe(true);
      }
    });
  },
);

// SignednessOverrideAndDeltaMaxBitWidthAndNumberOfValuesInSequence/DeltaEncodingFuzzerLikeTest
describe.each(
  combine<[DeltaSignedness, number, number, boolean, number]>(kAllSignedness, kDeltaMaxBitWidths, [1, 2, 100, 10000], [false, true], [21, 22, 23]),
)(
  "DeltaEncodingFuzzerLikeTest(signedness=%i, width=%i, values=%i, optional=%s, seed=%i)",
  (signedness, deltaMaxBitWidth, numOfValues, optionalValues, partialRandomSeed) => {
    const seed = () =>
      2 * signedness +
      3 * deltaMaxBitWidth +
      5 * deltaMaxBitWidth +
      7 * numOfValues +
      11 * (optionalValues ? 1 : 0) +
      13 * partialRandomSeed;

    beforeEach(() => {
      maybeSetSignedness(signedness);
    });

    test("Test", () => {
      const base = 3432n;

      const prng = new Random(seed());
      const deltas: OptionalU64[] = new Array(numOfValues).fill(undefined);
      for (let i = 0; i < deltas.length; ++i) {
        if (!optionalValues || prng.randBool()) {
          deltas[i] = randomWithMaxBitWidth(prng, deltaMaxBitWidth);
        }
      }
      const values = createSequenceByOptionalDeltas(base, deltas, numOfValues);

      testEncodingAndDecoding(base, values);
    });
  },
);

describe("DeltaEncodingSpecificEdgeCasesTest", () => {
  beforeEach(() => {
    unsetFixedLengthEncoderDeltaSignednessForTesting();
  });

  test("SignedDeltaWithOnlyTopBitOn", () => {
    maybeSetSignedness(DeltaSignedness.kForceSigned);

    const base = 3432n;

    const delta = 1n << 63n;
    const values: OptionalU64[] = [u64(base + delta)];

    testEncodingAndDecoding(base, values);
  });

  test("MaximumUnsignedDelta", () => {
    maybeSetSignedness(DeltaSignedness.kForceUnsigned);

    const base = (1n << 63n) + 0x123n;

    const values: OptionalU64[] = [base - 1n];

    testEncodingAndDecoding(base, values);
  });

  // Check that, if all deltas are set to -1, things still work.
  test.each(combine<[DeltaSignedness, number, boolean]>(kAllSignedness, kDeltaMaxBitWidths, [false, true]))(
    "ReverseSequence(signedness=%i, width=%i, wrapAround=%s)",
    (signedness, width, wrapAround) => {
      maybeSetSignedness(signedness);

      const valueMask = width === 64 ? kU64Max : (1n << BigInt(width)) - 1n;

      const base = wrapAround ? 1n : 0xf82d3n & valueMask;
      const values: OptionalU64[] = [u64(base - 1n) & valueMask, u64(base - 2n) & valueMask, u64(base - 3n) & valueMask];

      testEncodingAndDecoding(base, values);
    },
  );
});
