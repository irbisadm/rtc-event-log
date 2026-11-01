// Force-included into every translation unit: the system gtest is built
// without abseil, so it cannot print types that only define AbslStringify.
#pragma once
#ifdef __cplusplus
#include <ostream>
#include "api/rtp_header_extension_id.h"
namespace webrtc {
inline std::ostream& operator<<(std::ostream& os, const RtpHeaderExtensionId& id) {
  return os << id.value();
}
}  // namespace webrtc
#endif
