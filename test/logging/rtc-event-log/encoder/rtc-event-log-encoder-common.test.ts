// Port of logging/rtc_event_log/encoder/rtc_event_log_encoder_common_unittest.cc @ M154.

import {
  type SignedWidth,
  toSigned,
  toUnsigned,
} from "../../../../src/logging/rtc-event-log/encoder/rtc-event-log-encoder-common.js";

const kU64Max = (1n << 64n) - 1n;
const widths: SignedWidth[] = [8, 16, 32, 64];

describe.each(widths)("SignednessConversionTest/int%i_t", (bits) => {
  const min = -(1n << BigInt(bits - 1));
  const max = (1n << BigInt(bits - 1)) - 1n;

  test("CorrectlyConvertsLegalValues", () => {
    const legalValues = [min, min + 1n, -1n, 0n, 1n, max - 1n, max];
    for (const val of legalValues) {
      const unsignedVal = toUnsigned(val, bits);
      expect(toSigned(unsignedVal, bits)).toBe(val);
    }
  });

  test("FailsOnConvertingIllegalValues", () => {
    if (bits === 64) {
      return; // Test irrelevant; illegal values do not exist.
    }
    const maxLegalValue = toUnsigned(-1n, bits);
    const illegalValues = [maxLegalValue + 1n, maxLegalValue + 2n, kU64Max - 1n, kU64Max];
    for (const unsignedVal of illegalValues) {
      expect(toSigned(unsignedVal, bits)).toBeUndefined();
    }
  });
});
