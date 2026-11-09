// Port of logging/rtc_event_log/encoder/blob_encoding_unittest.cc @ M154.

import {decodeBlobs, encodeBlobs} from "../../../../src/logging/rtc-event-log/encoder/blob-encoding.js";
import {kMaxVarIntLengthBytes} from "../../../../src/logging/rtc-event-log/encoder/var-int.js";

const utf8 = new TextEncoder();

function bytes(s: string): Uint8Array {
  return utf8.encode(s);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function testEncodingAndDecoding(blobs: Uint8Array[]): void {
  expect(blobs.length).toBeGreaterThan(0);
  const encoded = encodeBlobs(blobs);
  expect(encoded.length).toBeGreaterThan(0);
  const decoded = decodeBlobs(encoded, blobs.length);
  expect(decoded.length).toBe(blobs.length);
  for (let i = 0; i < decoded.length; ++i) {
    // Buffer.equals is much faster than a deep toEqual on large arrays.
    expect(Buffer.from(decoded[i]).equals(Buffer.from(blobs[i]))).toBe(true);
  }
}

function testGracefulErrorHandling(encodedBlobs: Uint8Array, numOfBlobs: number): void {
  expect(decodeBlobs(encodedBlobs, numOfBlobs)).toEqual([]);
}

describe("BlobEncoding", () => {
  test("EmptyBlob", () => {
    testEncodingAndDecoding([bytes("")]);
  });

  test("SingleCharacterBlob", () => {
    testEncodingAndDecoding([bytes("a")]);
  });

  test("LongBlob", () => {
    let blob = "";
    for (let i = 0; i < 100000; ++i) {
      blob += `${i + 1} Mississippi\n`;
    }
    testEncodingAndDecoding([bytes(blob)]);
  });

  test("BlobsOfVariousLengths", () => {
    const kJump = 0xf032d; // Arbitrary.
    const kMax = 0xffffff; // Arbitrary.
    for (let i = 0, length = kJump; i < kMax; i += kJump, length += kJump) {
      testEncodingAndDecoding([new Uint8Array(length).fill("x".charCodeAt(0))]);
    }
  });

  test("MultipleBlobs", () => {
    const blobs: Uint8Array[] = [];
    for (let i = 0; i < 100000; ++i) {
      blobs.push(bytes(`${i + 1} Mississippi\n`));
    }
    testEncodingAndDecoding(blobs);
  });

  test("DecodeBlobsHandlesErrorsGracefullyEmptyInput", () => {
    testGracefulErrorHandling(bytes(""), 1);
  });

  test("DecodeBlobsHandlesErrorsGracefullyZeroBlobs", () => {
    const encoded = encodeBlobs([bytes("a")]);
    expect(encoded.length).toBeGreaterThan(0);
    testGracefulErrorHandling(encoded, 0);
  });

  test("DecodeBlobsHandlesErrorsGracefullyBlobLengthTooSmall", () => {
    const encoded = encodeBlobs([bytes("ab")]);
    expect(encoded.length).toBeGreaterThan(0);
    expect(encoded[0]).toBe(0x02);
    encoded[0] = 0x01;
    testGracefulErrorHandling(encoded, 1);
  });

  test("DecodeBlobsHandlesErrorsGracefullyBlobLengthTooLarge", () => {
    const encoded = encodeBlobs([bytes("a")]);
    expect(encoded.length).toBeGreaterThan(0);
    expect(encoded[0]).toBe(0x01);
    encoded[0] = 0x02;
    testGracefulErrorHandling(encoded, 1);
  });

  test("DecodeBlobsHandlesErrorsGracefullyNumberOfBlobsIncorrectlyHigh", () => {
    const blobs = [bytes("a"), bytes("b")];
    const encoded = encodeBlobs(blobs);
    // Test focus - two empty strings encoded, but DecodeBlobs() told way more
    // blobs are in the strings than could be expected.
    testGracefulErrorHandling(encoded, 1000);

    // Test sanity - show that DecodeBlobs() would have worked if it got the
    // correct input.
    testEncodingAndDecoding(blobs);
  });

  test("DecodeBlobsHandlesErrorsGracefullyDefectiveVarInt", () => {
    const defectiveVarint: number[] = [];
    for (let i = 0; i < kMaxVarIntLengthBytes; ++i) {
      defectiveVarint.push(0x80 | i);
    }
    defectiveVarint.push(0x01);
    const defectiveEncoded = concat(Uint8Array.from(defectiveVarint), bytes("whatever"));
    testGracefulErrorHandling(defectiveEncoded, 1);
  });

  test("DecodeBlobsHandlesErrorsGracefullyLengthSumWrapAround", () => {
    const maxSizeVarint: number[] = [];
    for (let i = 0; i < kMaxVarIntLengthBytes - 1; ++i) {
      maxSizeVarint.push(0xff);
    }
    maxSizeVarint.push(0x7f);
    const varint = Uint8Array.from(maxSizeVarint);
    const defectiveEncoded = concat(varint, varint, bytes("whatever"));
    testGracefulErrorHandling(defectiveEncoded, 2);
  });
});
