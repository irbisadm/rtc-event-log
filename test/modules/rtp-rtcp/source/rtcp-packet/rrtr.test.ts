// Port of modules/rtp_rtcp/source/rtcp_packet/rrtr_unittest.cc @ M154.

import {Rrtr} from "../../../../../src/modules/rtp-rtcp/source/rtcp-packet/rrtr.js";
import {NtpTime} from "../../../../../src/system-wrappers/include/ntp-time.js";

const kNtpSec = 0x12345678;
const kNtpFrac = 0x23456789;
const kBlock = Uint8Array.from([0x04, 0x00, 0x00, 0x02, 0x12, 0x34, 0x56, 0x78, 0x23, 0x45, 0x67, 0x89]);

describe("RtcpPacketRrtrTest", () => {
  test("BlockSize", () => {
    // static_assert: Size of manually created Rrtr block should match class constant.
    expect(kBlock.length).toBe(Rrtr.kLength);
  });

  test("Create", () => {
    const buffer = new Uint8Array(Rrtr.kLength);
    const rrtr = new Rrtr();
    rrtr.setNtp(new NtpTime(kNtpSec, kNtpFrac));

    rrtr.create(buffer);
    expect(buffer).toEqual(kBlock);
  });

  test("Parse", () => {
    const readRrtr = new Rrtr();
    readRrtr.parse(kBlock);

    // Run checks on const object to ensure all accessors have const modifier.
    const parsed = readRrtr;

    expect(parsed.ntp().seconds()).toBe(kNtpSec);
    expect(parsed.ntp().fractions()).toBe(kNtpFrac);
  });
});
