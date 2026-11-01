# rtc-event-log porting plan (M154)

Upstream: `branch-heads/8037` @ `7cb44cfa`; `rel/` = `logging/rtc_event_log/`.

| # | Stage | Upstream | State |
|---|---|---|---|
| 0 | Scaffold, protobuf layer of the new format (`decodeEventStream`) | `rel/rtc_event_log2.proto` | done |
| 1 | Encoding primitives: varint, blob encoding, delta encoding (encode + decode), signedness helpers, bit reader/writer; upstream unittests plus byte-exact vectors from the C++ encoders (`tools/cpp-vectors`) | `rel/encoder/{var_int,blob_encoding,delta_encoding,bit_writer,rtc_event_log_encoder_common}`, `rtc_base/bitstream_reader` | done |
| 2 | Parser skeleton (stream framing, `ParseStream` post-processing, log segment), RTP/RTCP packet events (headers, extensions, dependency descriptors, raw RTCP with duplicate removal), begin/end log events | `rel/rtc_event_log_parser.cc` (`ParseStreamInternal`, `StoreRtpPackets`, `StoreRtcpPackets`), `rel/dependency_descriptor_encoder_decoder`, `rel/encoder/optional_blob_encoding`, `rel/events/logged_rtp_rtcp.h`, `api/rtp_headers.h` | done |
| 3 | BWE events: delay/loss-based updates, probe clusters/results, ALR, route change, remote estimates, Scream | `rel/rtc_event_log_parser.cc`, `rel/events/*` | done |
| 4 | Remaining events: stream configs, ICE, DTLS, audio playout, frame decoded, generic packets (ignored, as upstream), ANA, NetEq; `GetMediaType`, `GetIceCandidates`, `GetRouteChanges` | `rel/rtc_event_log_parser.cc`, `rel/events/*` | done |
| 5 | RTCP payload parsing: transport feedback, SR/RR report blocks, REMB, NACK, ...; `RtcEventProcessor` with `GetPacketInfos` and `GetIceEvents` | `modules/rtp_rtcp/source/rtcp_packet/*`, `rel/rtc_event_processor*` | done (5a common header, SR/RR, XR, BYE; 5b NACK, PLI, FIR, REMB, loss notification; 5c transport/congestion feedback; 5d parser integration) |
| 6 | Golden verification against the C++ parser on logs written by the C++ encoder | `rel/rtc_event_log_parser.cc`, `rel/rtc_event_log_unittest_helper.cc` | done: `tools/cpp-golden` builds the upstream encoder, parser and EventGenerator; 8 random logs (plus scripted TWCC/CCFB feedback) parse identically, including `GetPacketInfos` |
| 7 | Legacy format (and the v3 format, currently rejected) | `rel/rtc_event_log.proto`, `ParseStreamInternalV3` | deferred (done after 8 by choice: Chrome writes the new format) |
| 8 | (goog-cc-as) Event log → goog-cc trace converter | `rtc_tools/rtc_event_log_visualizer/log_simulation.cc` | done in goog-cc-as (`tools/event-log`): this repo's golden logs replay identically through the port and upstream C++ GoogCC |
