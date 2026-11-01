# rtc-event-log porting plan (M154)

Upstream: `branch-heads/8037` @ `7cb44cfa`; `rel/` = `logging/rtc_event_log/`.

| # | Stage | Upstream | State |
|---|---|---|---|
| 0 | Scaffold, protobuf layer of the new format (`decodeEventStream`) | `rel/rtc_event_log2.proto` | done |
| 1 | Encoding primitives: varint, blob encoding, delta encoding (encode + decode), signedness helpers, bit reader/writer; upstream unittests plus byte-exact vectors from the C++ encoders (`tools/cpp-vectors`) | `rel/encoder/{var_int,blob_encoding,delta_encoding,bit_writer,rtc_event_log_encoder_common}`, `rtc_base/bitstream_reader` | done |
| 2 | RTP/RTCP packet events (headers, extensions, raw RTCP), batch expansion of base + delta fields | `rel/rtc_event_log_parser.cc` (`StoreRtpPackets`, `StoreRtcpPackets`) | |
| 3 | BWE events: delay/loss-based updates, probe clusters/results, ALR, route change, remote estimates, Scream | `rel/rtc_event_log_parser.cc`, `rel/events/*` | |
| 4 | Remaining events: begin/end log, stream configs, ICE, DTLS, audio playout, frame decoded, generic packets, ANA, NetEq | `rel/rtc_event_log_parser.cc`, `rel/events/*` | |
| 5 | RTCP payload parsing: transport feedback, SR/RR report blocks, REMB, NACK, ... | `modules/rtp_rtcp/source/rtcp_packet/*` | |
| 6 | Golden verification against the C++ parser on logs written by the C++ encoder | `rel/rtc_event_log_parser.cc`, `rel/rtc_event_log_unittest_helper.cc` | |
| 7 | Legacy format | `rel/rtc_event_log.proto` | |
| 8 | (goog-cc-as) Event log → goog-cc trace converter | `rtc_tools/rtc_event_log_visualizer/log_simulation.cc` | |
