// Stand-ins for upstream pieces the generator does not need.

#include "rtc_base/event_tracer.h"

namespace webrtc {

// rtc_base/event_tracer.cc pulls in threads; tracing is never enabled here.
const unsigned char* EventTracer::GetCategoryEnabled(const char* /*name*/) {
  static const unsigned char kDisabled = 0;
  return &kDisabled;
}

void EventTracer::AddTraceEvent(char /*phase*/,
                                const unsigned char* /*category_enabled*/,
                                const char* /*name*/,
                                unsigned long long /*id*/,
                                int /*num_args*/,
                                const char** /*arg_names*/,
                                const unsigned char* /*arg_types*/,
                                const unsigned long long* /*arg_values*/,
                                unsigned char /*flags*/) {}

}  // namespace webrtc
