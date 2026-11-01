# Upstream RtcEventLog encoder + parser + test EventGenerator (from ../../cpp)
# linked into the golden log generator. Needs system abseil, protobuf and gtest.
cmake_minimum_required(VERSION 3.20)
project(rtc_event_log_golden CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(absl REQUIRED)
find_package(Protobuf REQUIRED)
find_package(GTest REQUIRED)

set(WEBRTC "${CMAKE_CURRENT_SOURCE_DIR}/../../cpp")
include(sources.cmake)
list(TRANSFORM WEBRTC_SOURCES PREPEND "${WEBRTC}/")

# rtc_event_log{,2}.pb.{h,cc}, generated where the sources include them from.
set(GEN "${CMAKE_CURRENT_BINARY_DIR}/gen")
set(PROTO_OUT "${GEN}/logging/rtc_event_log")
add_custom_command(
  OUTPUT "${PROTO_OUT}/rtc_event_log.pb.cc" "${PROTO_OUT}/rtc_event_log2.pb.cc"
  COMMAND ${CMAKE_COMMAND} -E make_directory "${GEN}"
  COMMAND protobuf::protoc --cpp_out=${GEN} -I${WEBRTC}
          ${WEBRTC}/logging/rtc_event_log/rtc_event_log.proto
          ${WEBRTC}/logging/rtc_event_log/rtc_event_log2.proto
  DEPENDS "${WEBRTC}/logging/rtc_event_log/rtc_event_log.proto"
          "${WEBRTC}/logging/rtc_event_log/rtc_event_log2.proto")

# rtc_base/protobuf_utils.h includes protobuf from Chromium's third_party/.
foreach(h message_lite repeated_field)
  file(WRITE "${GEN}/third_party/protobuf/src/google/protobuf/${h}.h"
       "#include <google/protobuf/${h}.h>\n")
endforeach()
# test/g{test,mock}.h include gtest from Chromium's testing/.
file(WRITE "${GEN}/testing/gmock/include/gmock/gmock.h" "#include <gmock/gmock.h>\n")
file(WRITE "${GEN}/testing/gtest/include/gtest/gtest.h" "#include <gtest/gtest.h>\n")
file(WRITE "${GEN}/testing/gtest/include/gtest/gtest-spi.h" "#include <gtest/gtest-spi.h>\n")

# experiments/registered_field_trials.h is generated, as in experiments/BUILD.gn.
find_package(Python3 REQUIRED COMPONENTS Interpreter)
add_custom_command(
  OUTPUT "${GEN}/experiments/registered_field_trials.h"
  COMMAND ${CMAKE_COMMAND} -E make_directory "${GEN}/experiments"
  COMMAND Python3::Interpreter -I "${WEBRTC}/experiments/field_trials.py" header
          --output "${GEN}/experiments/registered_field_trials.h"
  DEPENDS "${WEBRTC}/experiments/field_trials.py")

add_executable(golden golden.cc stubs.cc ${WEBRTC_SOURCES}
  "${PROTO_OUT}/rtc_event_log.pb.cc" "${PROTO_OUT}/rtc_event_log2.pb.cc"
  "${GEN}/experiments/registered_field_trials.h")
target_include_directories(golden PRIVATE "${WEBRTC}" "${GEN}")
target_compile_definitions(golden PRIVATE WEBRTC_POSIX WEBRTC_LINUX RTC_DISABLE_LOGGING
  WEBRTC_ENABLE_PROTOBUF=1 NDEBUG)
target_compile_options(golden PRIVATE -w -include "${CMAKE_CURRENT_SOURCE_DIR}/prelude.h")
target_link_libraries(golden PRIVATE protobuf::libprotobuf GTest::gtest GTest::gmock
  absl::strings absl::str_format absl::flat_hash_map absl::flat_hash_set
  absl::optional absl::algorithm_container absl::any_invocable absl::nullability
  absl::check absl::log absl::inlined_vector absl::base absl::memory absl::cleanup
  absl::crc32c absl::string_view)
