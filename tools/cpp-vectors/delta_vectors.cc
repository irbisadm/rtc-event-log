// Writes delta/blob encoding test vectors produced by the upstream C++
// encoders (cpp/ at the pinned revision) as JSON to stdout. See build.sh.
#include <cstdint>
#include <cstdio>
#include <optional>
#include <random>
#include <string>
#include <vector>

#include "logging/rtc_event_log/encoder/blob_encoding.h"
#include "logging/rtc_event_log/encoder/delta_encoding.h"

namespace webrtc {
void SetFixedLengthEncoderDeltaSignednessForTesting(bool signedness);
void UnsetFixedLengthEncoderDeltaSignednessForTesting();
}  // namespace webrtc

namespace {

std::string Hex(const std::string& s) {
  static const char* kDigits = "0123456789abcdef";
  std::string out;
  for (unsigned char c : s) {
    out += kDigits[c >> 4];
    out += kDigits[c & 0xf];
  }
  return out;
}

std::string Opt(std::optional<uint64_t> v) {
  return v ? "\"" + std::to_string(*v) + "\"" : "null";
}

}  // namespace

int main() {
  std::mt19937_64 rng(154);
  auto random_width = [&](int width) {
    uint64_t v = rng();
    return width == 64 ? v : v & ((uint64_t{1} << width) - 1);
  };
  const char* overrides[] = {"none", "unsigned", "signed"};
  std::printf("{\"delta\":[\n");
  bool first = true;
  for (int override_index = 0; override_index < 3; ++override_index) {
    for (int width : {1, 2, 7, 8, 13, 31, 32, 33, 52, 63, 64}) {
      for (size_t n : {1u, 2u, 5u, 40u}) {
        for (int pattern = 0; pattern < 4; ++pattern) {
          // 0: increasing small deltas, 1: random values of `width` bits,
          // 2: like 1 with missing values, 3: like 0 with a missing base.
          std::optional<uint64_t> base;
          if (pattern != 3) base = random_width(width);
          std::vector<std::optional<uint64_t>> values(n);
          uint64_t prev = base.value_or(random_width(width));
          for (size_t i = 0; i < n; ++i) {
            if (pattern == 0 || pattern == 3) {
              prev += random_width(width > 8 ? width / 2 : width);
              values[i] = prev;
            } else if (pattern == 1 || (rng() & 1)) {
              values[i] = random_width(width);
            }
          }
          if (override_index == 0) {
            webrtc::UnsetFixedLengthEncoderDeltaSignednessForTesting();
          } else {
            webrtc::SetFixedLengthEncoderDeltaSignednessForTesting(
                override_index == 2);
          }
          const std::string encoded = webrtc::EncodeDeltas(base, values);
          std::printf("%s{\"override\":\"%s\",\"base\":%s,\"values\":[",
                      first ? "" : ",\n", overrides[override_index],
                      Opt(base).c_str());
          for (size_t i = 0; i < n; ++i) {
            std::printf("%s%s", i ? "," : "", Opt(values[i]).c_str());
          }
          std::printf("],\"encoded\":\"%s\"}", Hex(encoded).c_str());
          first = false;
        }
      }
    }
  }
  webrtc::UnsetFixedLengthEncoderDeltaSignednessForTesting();
  std::printf("\n],\"blobs\":[\n");
  for (int c = 0; c < 6; ++c) {
    std::vector<std::string> blobs(1 + c * 3);
    for (auto& blob : blobs) {
      blob.resize(rng() % (c == 5 ? 300 : 20));
      for (auto& ch : blob) ch = static_cast<char>(rng());
    }
    std::printf("%s{\"blobs\":[", c ? ",\n" : "");
    for (size_t i = 0; i < blobs.size(); ++i) {
      std::printf("%s\"%s\"", i ? "," : "", Hex(blobs[i]).c_str());
    }
    std::printf("],\"encoded\":\"%s\"}", Hex(webrtc::EncodeBlobs(blobs)).c_str());
  }
  std::printf("\n]}\n");
  return 0;
}
