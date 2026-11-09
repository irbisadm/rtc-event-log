// Port of logging/rtc_event_log/events/rtc_event_field_extraction_unittest.cc @ M154.

import {
  encodeAsUnsigned,
  IntegerTypes,
  maxUnsignedValueOfBitWidth,
  signedBitWidth,
  unsignedBitWidth,
} from "../../../../src/logging/rtc-event-log/events/rtc-event-field-extraction.js";
import {Random} from "../../../rtc-base/random.js";

describe("UnsignedBitWidthTest", () => {
  test("SmallValues", () => {
    expect(unsignedBitWidth(0n)).toBe(1);
    expect(unsignedBitWidth(1n)).toBe(1);
    expect(unsignedBitWidth(2n)).toBe(2);
    expect(unsignedBitWidth(3n)).toBe(2);
    expect(unsignedBitWidth(4n)).toBe(3);
    expect(unsignedBitWidth(5n)).toBe(3);
    expect(unsignedBitWidth(6n)).toBe(3);
    expect(unsignedBitWidth(7n)).toBe(3);
  });

  test("PowersOfTwo", () => {
    expect(unsignedBitWidth(0n)).toBe(1);
    for (let i = 0; i < 64; i++) {
      expect(unsignedBitWidth(1n << BigInt(i))).toBe(i + 1);
    }
  });

  test("PowersOfTwoMinusOne", () => {
    for (let i = 1; i < 64; i++) {
      expect(unsignedBitWidth((1n << BigInt(i)) - 1n)).toBe(i);
    }
    expect(unsignedBitWidth((1n << 64n) - 1n)).toBe(64);
  });

  test("RandomInputs", () => {
    const rand = new Random(12345);
    for (let i = 0; i < 64; i++) {
      let x = 1n << BigInt(i);
      const high = BigInt(rand.randU32());
      const low = BigInt(rand.randU32());
      x += BigInt.asUintN(64, (high << 32n) + low) % x;
      expect(unsignedBitWidth(x)).toBe(i + 1);
    }
  });
});

test("SignedBitWidthTest.SignedBitWidth", () => {
  expect(signedBitWidth(0n, 1n)).toBe(1);
  expect(signedBitWidth(1n, 0n)).toBe(2);
  expect(signedBitWidth(1n, 2n)).toBe(2);
  expect(signedBitWidth(1n, 128n)).toBe(8);
  expect(signedBitWidth(127n, 1n)).toBe(8);
  expect(signedBitWidth(127n, 128n)).toBe(8);
  expect(signedBitWidth(1n, 129n)).toBe(9);
  expect(signedBitWidth(128n, 1n)).toBe(9);
});

test("MaxUnsignedValueOfBitWidthTest.MaxUnsignedValueOfBitWidth", () => {
  expect(maxUnsignedValueOfBitWidth(1)).toBe(0x01n);
  expect(maxUnsignedValueOfBitWidth(6)).toBe(0x3fn);
  expect(maxUnsignedValueOfBitWidth(8)).toBe(0xffn);
  expect(maxUnsignedValueOfBitWidth(32)).toBe(0xffffffffn);
});

describe("EncodeAsUnsignedTest", () => {
  test("NegativeValues", () => {
    // Negative values are converted as if cast to unsigned type of
    // the same bitsize using 2-complement representation.
    expect(encodeAsUnsigned(-1n, IntegerTypes.int16)).toBe(0xffffn);
    expect(encodeAsUnsigned(-1n, IntegerTypes.int64)).toBe(0xffffffffffffffffn);
  });

  test("PositiveValues", () => {
    // Postive values are unchanged.
    expect(encodeAsUnsigned(42n, IntegerTypes.int16)).toBe(42n);
    expect(encodeAsUnsigned(42n, IntegerTypes.int64)).toBe(42n);
  });
});
