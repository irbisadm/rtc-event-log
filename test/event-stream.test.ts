import {create, toBinary} from "@bufbuild/protobuf";
import {decodeEventStream} from "../src/index.js";
import {BeginLogEventSchema, EventStreamSchema} from "../src/gen/rtc_event_log2_pb.js";

describe("decodeEventStream", () => {
  it("round-trips the protobuf layer", () => {
    const stream = create(EventStreamSchema, {
      beginLogEvents: [create(BeginLogEventSchema, {timestampMs: 1234n, version: 2, utcTimeMs: 1700000000000n})],
    });
    const decoded = decodeEventStream(toBinary(EventStreamSchema, stream));
    expect(decoded.beginLogEvents).toHaveLength(1);
    expect(decoded.beginLogEvents[0].timestampMs).toBe(1234n);
    expect(decoded.beginLogEvents[0].version).toBe(2);
  });

  it("decodes an empty log", () => {
    expect(decodeEventStream(new Uint8Array()).incomingRtpPackets).toHaveLength(0);
  });
});
