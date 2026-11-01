#!/bin/sh
# Builds delta_vectors.cc against the upstream encoders in cpp/ (needs a C++20
# compiler and system abseil) and refreshes the checked-in test vectors.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
out=${TMPDIR:-/tmp}/rtc-event-log-cpp-vectors
cpp=$root/cpp
c++ -std=c++20 -O1 -w -DNDEBUG -DRTC_DISABLE_LOGGING -DWEBRTC_POSIX -DWEBRTC_LINUX -I"$cpp" \
  "$root/tools/cpp-vectors/delta_vectors.cc" \
  "$cpp/logging/rtc_event_log/encoder/var_int.cc" \
  "$cpp/logging/rtc_event_log/encoder/blob_encoding.cc" \
  "$cpp/logging/rtc_event_log/encoder/delta_encoding.cc" \
  "$cpp/logging/rtc_event_log/encoder/bit_writer.cc" \
  "$cpp/rtc_base/bitstream_reader.cc" \
  "$cpp/rtc_base/bit_buffer.cc" \
  "$cpp/rtc_base/checks.cc" \
  $(pkg-config --libs absl_strings absl_log absl_check 2>/dev/null || echo -labsl_strings) \
  -o "$out"
"$out" > "$root/test/logging/rtc-event-log/encoder/cpp-vectors.json"
echo "wrote test/logging/rtc-event-log/encoder/cpp-vectors.json"
