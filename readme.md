# rtc-event-log

A parser for WebRTC **RtcEventLog** files (the logs Chrome writes from `chrome://webrtc-internals` and native libwebrtc clients produce via `RtcEventLog`) for JavaScript and TypeScript, ported from libwebrtc's `logging/rtc_event_log`.

Status: **work in progress** — the protobuf layer of the new log format decodes and the field encodings (varint, blob and delta encoding) are ported byte-exact; `ParsedRtcEventLog` parses every event type of the new format, including the RTCP blocks (SR/RR, XR, REMB, NACK, PLI, FIR, BYE, loss notification, transport-wide and RFC 8888 congestion control feedback), and `getPacketInfos()` matches RTP packets with their feedback (see [PORTING_PLAN.md](PORTING_PLAN.md)).

## Upstream revision

Ported from libwebrtc **M154** — `branch-heads/8037` @ [`7cb44cfa`](https://webrtc.googlesource.com/src/+/7cb44cfa6c40960ca8d2c1b3f04e2f9e81d35c61). `proto/rtc_event_log2.proto` is copied verbatim from that revision; every ported file names its upstream source and revision in its first line.

## Usage

```ts
import {readFileSync} from "node:fs";
import {ParsedRtcEventLog} from "@irbisadm/rtc-event-log";

const log = new ParsedRtcEventLog();
const status = log.parseString(readFileSync("event_log.rtc"));
if (!status.ok()) throw new Error(status.message());
for (const stream of log.outgoingRtpPacketsBySsrc()) {
  console.log(stream.ssrc, stream.outgoingPackets.length);
}
```

The API mirrors upstream `ParsedRtcEventLog` in camelCase. Times are `Timestamp`s: microseconds as a `number` (±`Infinity` for upstream's infinities); `TimeDelta` is microseconds, `DataRate` bits per second and `DataSize` bytes. `decodeEventStream()` exposes the raw protobuf layer.

## Development

```sh
nvm use            # Node from .nvmrc
yarn install
yarn test          # jest
yarn typecheck
yarn build         # dist/index.mjs + types/index.d.ts
yarn gen:proto     # regenerate src/gen from proto/ (needs protoc)
sh tools/cpp-vectors/build.sh   # refresh encoder test vectors from the C++ in cpp/ (needs c++ and abseil)
sh tools/cpp-golden/build.sh    # rebuild the golden logs with the upstream encoder + parser (needs clang++, cmake, ninja, abseil, protobuf, gtest)
```

`test/logging/rtc-event-log/golden/` holds logs written by the upstream C++ encoder together with a JSON dump of what the upstream C++ parser reads from them; the test suite checks that the port reads exactly the same.

`cpp/` (gitignored) is a blob-less sparse clone of libwebrtc at the pinned revision, used as the porting reference:

```sh
git clone --filter=blob:none --no-checkout https://webrtc.googlesource.com/src cpp
git -C cpp fetch origin refs/branch-heads/8037:refs/remotes/origin/branch-heads/8037
git -C cpp sparse-checkout set --no-cone /logging/rtc_event_log/ /modules/rtp_rtcp/ /api/ /rtc_base/ /system_wrappers/ /call/version.cc /experiments/
git -C cpp checkout origin/branch-heads/8037
```

## Related

[goog-cc-as](https://github.com/irbisadm/goog-cc-as) — libwebrtc's GoogCC congestion controller in AssemblyScript; it will use this parser to replay real event logs through its controller.

## License

BSD 3-Clause, same as libwebrtc — see [LICENSE](LICENSE). The original code is © The WebRTC project authors; libwebrtc's [additional patent grant](https://webrtc.googlesource.com/src/+/refs/heads/main/PATENTS) applies to the upstream implementation.
