#!/bin/sh
# Builds the golden generator against cpp/ and refreshes the golden logs:
# test/logging/rtc-event-log/golden/{seed,legacy,legacy-default-map,v3}-<N>.{rtc,json}.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
build=${TMPDIR:-/tmp}/rtc-event-log-cpp-golden
CXX=${CXX:-clang++} cmake -S "$root/tools/cpp-golden" -B "$build" -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$build"
out="$root/test/logging/rtc-event-log/golden"
mkdir -p "$out"
for seed in 1 2 3 4 5 6 7 8; do
  "$build/golden" "$seed" "$out/seed-$seed.rtc" "$out/seed-$seed.json"
done
# Legacy format, parsed without and with the default header extension map.
for seed in 1 2 3 4; do
  "$build/golden" legacy "$seed" 0 "$out/legacy-$seed.rtc" "$out/legacy-$seed.json"
  "$build/golden" legacy "$seed" 1 "$out/legacy-default-map-$seed.rtc" "$out/legacy-default-map-$seed.json"
done
# v3 format.
for seed in 1 2 3 4; do
  "$build/golden" v3 "$seed" "$out/v3-$seed.rtc" "$out/v3-$seed.json"
done
echo "wrote $out"
