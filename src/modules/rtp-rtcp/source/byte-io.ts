// Port of modules/rtp_rtcp/source/byte_io.h @ M154 (the big-endian readers
// and writers the RTCP packets use). `offset` indexes into `buffer`.

export const ByteReader = {
  u8(buffer: Uint8Array, offset: number): number {
    return buffer[offset];
  },
  // ByteReader<uint16_t>::ReadBigEndian
  u16(buffer: Uint8Array, offset: number): number {
    return (buffer[offset] << 8) | buffer[offset + 1];
  },
  // ByteReader<uint32_t, 3>::ReadBigEndian
  u24(buffer: Uint8Array, offset: number): number {
    return (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
  },
  // ByteReader<int32_t, 3>::ReadBigEndian (sign-extended)
  i24(buffer: Uint8Array, offset: number): number {
    return (((buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2]) << 8) >> 8;
  },
  // ByteReader<uint32_t>::ReadBigEndian
  u32(buffer: Uint8Array, offset: number): number {
    return ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;
  },
  // ByteReader<int16_t>::ReadBigEndian
  i16(buffer: Uint8Array, offset: number): number {
    return (((buffer[offset] << 8) | buffer[offset + 1]) << 16) >> 16;
  },
} as const;

export const ByteWriter = {
  u8(buffer: Uint8Array, offset: number, value: number): void {
    buffer[offset] = value & 0xff;
  },
  u16(buffer: Uint8Array, offset: number, value: number): void {
    buffer[offset] = (value >>> 8) & 0xff;
    buffer[offset + 1] = value & 0xff;
  },
  // ByteWriter<uint32_t, 3> / ByteWriter<int32_t, 3>: the low 24 bits.
  u24(buffer: Uint8Array, offset: number, value: number): void {
    buffer[offset] = (value >>> 16) & 0xff;
    buffer[offset + 1] = (value >>> 8) & 0xff;
    buffer[offset + 2] = value & 0xff;
  },
  u32(buffer: Uint8Array, offset: number, value: number): void {
    buffer[offset] = (value >>> 24) & 0xff;
    buffer[offset + 1] = (value >>> 16) & 0xff;
    buffer[offset + 2] = (value >>> 8) & 0xff;
    buffer[offset + 3] = value & 0xff;
  },
} as const;
