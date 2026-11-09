#!/bin/sh
# Regenerates src/gen from proto/ (copied from the libwebrtc checkout at the
# pinned revision). Needs protoc; the generated code is committed.
set -e
cd "$(dirname "$0")/.."
protoc --plugin=protoc-gen-es=node_modules/.bin/protoc-gen-es \
  --es_out=src/gen --es_opt=target=ts,import_extension=js \
  --proto_path=proto proto/rtc_event_log2.proto proto/rtc_event_log.proto
