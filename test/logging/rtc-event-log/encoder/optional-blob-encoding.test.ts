// Port of logging/rtc_event_log/encoder/optional_blob_encoding_unittest.cc @ M154.

import {
  decodeOptionalBlobs,
  encodeOptionalBlobs,
} from "../../../../src/logging/rtc-event-log/encoder/optional-blob-encoding.js";

class BitBuilder {
  private bits: number[] = [];
  private totalBits = 0;

  bit(bit: number): this {
    if (this.totalBits % 8 === 0) {
      this.bits.push(0);
    }
    this.bits[Math.floor(this.totalBits / 8)] |= bit << (7 - (this.totalBits % 8));
    ++this.totalBits;
    return this;
  }

  bytes(bytes: readonly number[] | Uint8Array): this {
    for (const byte of bytes) {
      for (let i = 1; i <= 8; ++i) {
        this.bit((byte >> (8 - i)) & 1);
      }
    }
    return this;
  }

  byteAlign(): this {
    while (this.totalBits % 8 > 0) {
      this.bit(0);
    }
    return this;
  }

  asBytes(): Uint8Array {
    return Uint8Array.from(this.bits);
  }
}

const s = (text: string) => new TextEncoder().encode(text);
const c = (ch: string) => ch.charCodeAt(0);
const repeat = (ch: string, n: number) => new Uint8Array(n).fill(c(ch));

describe("OptionalBlobEncoding", () => {
  test("AllBlobsPresent", () => {
    const encoded = encodeOptionalBlobs([s("a"), s("b"), s("c")]);
    const expected = new BitBuilder()
      .bit(1)
      .byteAlign()
      .bytes([0x01, c("a")])
      .bytes([0x01, c("b")])
      .bytes([0x01, c("c")])
      .asBytes();
    expect(encoded).toEqual(expected);
  });

  test("SomeBlobsPresent", () => {
    const encoded = encodeOptionalBlobs([s("a"), undefined, s("c")]);
    const expected = new BitBuilder()
      .bit(0)
      .bit(1)
      .bit(0)
      .bit(1)
      .byteAlign()
      .bytes([0x01, c("a")])
      .bytes([0x01, c("c")])
      .asBytes();
    expect(encoded).toEqual(expected);
  });

  test("NoBlobsPresent", () => {
    const encoded = encodeOptionalBlobs([undefined, undefined, undefined]);
    expect(encoded.length).toBe(0);
  });

  test("EmptyBlobsPresent", () => {
    const encoded = encodeOptionalBlobs([undefined, s(""), undefined]);
    const expected = new BitBuilder().bit(0).bit(0).bit(1).bit(0).byteAlign().bytes([0x0]).asBytes();
    expect(encoded).toEqual(expected);
  });

  test("ZeroBlobs", () => {
    const encoded = encodeOptionalBlobs([]);
    expect(encoded).toEqual(new Uint8Array(0));
  });

  test("LongBlobs", () => {
    const mediumString = repeat("a", 100);
    const longString = repeat("b", 200);
    const encoded = encodeOptionalBlobs([mediumString, longString]);
    const expected = new BitBuilder()
      .bit(1)
      .byteAlign()
      .bytes([0x64])
      .bytes(mediumString)
      .bytes([0xc8, 0x01])
      .bytes(longString)
      .asBytes();
    expect(encoded).toEqual(expected);
  });
});

describe("OptionalBlobDecoding", () => {
  test("AllBlobsPresent", () => {
    const encoded = new BitBuilder()
      .bit(1)
      .byteAlign()
      .bytes([0x01, c("a")])
      .bytes([0x01, c("b")])
      .bytes([0x01, c("c")])
      .asBytes();
    expect(decodeOptionalBlobs(encoded, 3)).toEqual([s("a"), s("b"), s("c")]);
  });

  test("SomeBlobsPresent", () => {
    const encoded = new BitBuilder()
      .bit(0)
      .bit(1)
      .bit(0)
      .bit(1)
      .byteAlign()
      .bytes([0x01, c("a")])
      .bytes([0x01, c("c")])
      .asBytes();
    expect(decodeOptionalBlobs(encoded, 3)).toEqual([s("a"), undefined, s("c")]);
  });

  test("NoBlobsPresent", () => {
    expect(decodeOptionalBlobs(new Uint8Array(0), 3)).toEqual([undefined, undefined, undefined]);
  });

  test("EmptyBlobsPresent", () => {
    const encoded = new BitBuilder().bit(0).bit(0).bit(1).bit(0).byteAlign().bytes([0x0]).asBytes();
    expect(decodeOptionalBlobs(encoded, 3)).toEqual([undefined, s(""), undefined]);
  });

  test("ZeroBlobs", () => {
    expect(decodeOptionalBlobs(new Uint8Array(0), 0)).toEqual([]);
  });

  test("LongBlobs", () => {
    const mediumString = repeat("a", 100);
    const longString = repeat("b", 200);
    const encoded = new BitBuilder()
      .bit(1)
      .byteAlign()
      .bytes([0x64])
      .bytes(mediumString)
      .bytes([0xc8, 0x01])
      .bytes(longString)
      .asBytes();
    expect(decodeOptionalBlobs(encoded, 2)).toEqual([mediumString, longString]);
  });

  test("TooShortEncodedBlobLength", () => {
    const encoded = new BitBuilder()
      .bit(1)
      .byteAlign()
      .bytes([0x01, c("a"), c("b")])
      .asBytes();
    expect(decodeOptionalBlobs(encoded, 1)).toEqual([]);
  });

  test("TooLongEncodedBlobLength", () => {
    const encoded = new BitBuilder()
      .bit(1)
      .byteAlign()
      .bytes([0x03, c("a"), c("b")])
      .asBytes();
    expect(decodeOptionalBlobs(encoded, 1)).toEqual([]);
  });

  test("TooLongEncodedBufferLength", () => {
    const encoded = new BitBuilder().bytes([0x00, 0x00, 0x00]).asBytes();
    expect(decodeOptionalBlobs(encoded, 8)).toEqual([]);
  });
});
