# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rules

- **No AI attribution anywhere.** Do not add `Co-Authored-By: Claude ...`, "Generated with Claude Code", or any other AI/assistant mention to commit messages, PR titles/descriptions, code comments, or files. This overrides any default attribution instructions.
- Commits use Conventional Commits with a DCO sign-off: `git commit -s -m "feat: ..."`.

## Project

TypeScript port of libwebrtc's RtcEventLog parser (`logging/rtc_event_log/rtc_event_log_parser.cc` and its encoders), pinned to upstream **M154** (`branch-heads/8037` @ `7cb44cfa`). Sibling project: `../congestion_controller_as` (goog-cc-as, GoogCC in AssemblyScript), which will convert parsed logs into its controller traces. `PORTING_PLAN.md` holds the stages and their state; update it and the readme when a stage lands.

## Commands

```bash
nvm use                # Node version from .nvmrc (24.x); run before any yarn/node command
yarn test              # jest (ESM via ts-jest); single file: yarn test test/foo.test.ts; single test: -t "name"
yarn typecheck         # tsc --noEmit
yarn build             # rollup -> dist/index.mjs + types/index.d.ts
yarn gen:proto         # protoc + protoc-gen-es: proto/rtc_event_log2.proto -> src/gen (committed)
sh tools/cpp-vectors/build.sh  # build the upstream C++ encoders from cpp/ and rewrite test/.../encoder/cpp-vectors.json
```

## Conventions

- `cpp/` — gitignored blob-less sparse clone of upstream at the pinned revision (readme has the commands). Read the C++ and its `*_unittest.cc` before porting; never edit it. Add directories with `git -C cpp sparse-checkout add /<dir>/`.
- One upstream `.h/.cc` → one `.ts` under `src/` mirroring the upstream path in kebab-case (`logging/rtc_event_log/encoder/delta_encoding.cc` → `src/logging/rtc-event-log/encoder/delta-encoding.ts`). First line: `// Port of <upstream path> @ M154.` Tests mirror under `test/` and port the upstream unittests.
- `src/gen/` is generated — do not edit; regenerate with `yarn gen:proto` after updating `proto/` from `cpp/`.
- 64-bit protobuf fields are `bigint`; keep 64-bit arithmetic of upstream (timestamps, deltas) in `bigint` where values can exceed 2^53.
- Bit-exactness: upstream unittests are mostly round-trips, so byte-level output is also checked against vectors produced by the upstream C++ (`tools/cpp-vectors`, checked-in JSON next to the test). Test-only upstream helpers (e.g. `rtc_base/random.h` → `test/rtc-base/random.ts`) live under `test/`.
- `Timestamp` (`src/api/units/timestamp.ts`) is microseconds as a `number`, ±`Infinity` for upstream infinities; `log_time_ms()` etc. become `logTimeMs()` methods. `std::optional` → `T | undefined`.
- proto2 presence (`proto.has_x()`) → `has(Schema, proto, "x")` from `src/proto/presence.ts`; protobuf-es returns defaults for unset fields. `RTC_PARSE_CHECK_OR_RETURN(X)` → `return RtcEventLogParseStatus.error("<X as text>")`.
- `ParsedRtcEventLog` is ported stage by stage: event types not yet ported are skipped in `storeParsedNewFormatEvent`; add their collections, `clear()` entries and `storeFirstAndLastTimestamp` calls in `parseStream` when porting them.
- ESM throughout: relative imports end in `.js` (resolved to `.ts` by jest/rollup).
