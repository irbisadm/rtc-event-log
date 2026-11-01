// Port of modules/rtp_rtcp/source/rtcp_packet/rrtr.h @ M154.

import {NtpTime} from "../../../../system-wrappers/include/ntp-time.js";
import {ByteReader, ByteWriter} from "../byte-io.js";

export class Rrtr {
  static readonly kBlockType = 4;
  static readonly kBlockLength = 2;
  static readonly kLength = 4 * (Rrtr.kBlockLength + 1); // 12

  private ntpValue = new NtpTime();

  // Parse assumes header is already parsed and validated.
  parse(buffer: Uint8Array): void {
    // Skip block header, it is already parsed and validated.
    const seconds = ByteReader.u32(buffer, 4);
    const fraction = ByteReader.u32(buffer, 8);
    this.ntpValue.set(seconds, fraction);
  }

  // Fills buffer with the Rrtr.
  // Consumes Rrtr::kLength bytes.
  create(buffer: Uint8Array): void {
    const kReserved = 0;
    buffer[0] = Rrtr.kBlockType;
    buffer[1] = kReserved;
    ByteWriter.u16(buffer, 2, Rrtr.kBlockLength);
    ByteWriter.u32(buffer, 4, this.ntpValue.seconds());
    ByteWriter.u32(buffer, 8, this.ntpValue.fractions());
  }

  setNtp(ntp: NtpTime): void {
    this.ntpValue = ntp.clone();
  }
  ntp(): NtpTime {
    return this.ntpValue;
  }

  equals(other: Rrtr): boolean {
    return this.ntpValue.equals(other.ntpValue);
  }

  clone(): Rrtr {
    const copy = new Rrtr();
    copy.setNtp(this.ntpValue);
    return copy;
  }
}
