// Writes a random event log with the upstream encoder (events from the
// upstream test EventGenerator), parses it with the upstream
// ParsedRtcEventLog and dumps what the parser sees as JSON.
//
//   golden <seed> <out.rtc> <out.json>
//
// test/logging/rtc-event-log/golden.test.ts parses out.rtc with the port and
// compares its dump (golden-dump.ts, same format) with out.json.

#include <cinttypes>
#include <cmath>
#include <cstdio>
#include <deque>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "api/field_trials.h"
#include "logging/rtc_event_log/rtc_event_log.pb.h"
#include "api/transport/network_types.h"
#include "logging/rtc_event_log/events/rtc_event_rtcp_packet_incoming.h"
#include "logging/rtc_event_log/events/rtc_event_rtp_packet_outgoing.h"
#include "modules/rtp_rtcp/source/rtcp_packet/congestion_control_feedback.h"
#include "modules/rtp_rtcp/source/rtcp_packet/transport_feedback.h"
#include "modules/rtp_rtcp/source/rtp_header_extensions.h"
#include "modules/rtp_rtcp/source/rtp_packet_to_send.h"
#include "logging/rtc_event_log/encoder/rtc_event_log_encoder_new_format.h"
#include "logging/rtc_event_log/rtc_event_log_parser.h"
#include "logging/rtc_event_log/rtc_event_log_unittest_helper.h"
#include "rtc_base/random.h"
#include "system_wrappers/include/clock.h"

namespace webrtc {
namespace {

class Json {
 public:
  std::string str;
  void Raw(const std::string& s) { Sep(); str += s; }
  void Key(const char* k) { Sep(); str += "\""; str += k; str += "\":"; first_ = true; }
  void Int(int64_t v) { Raw(std::to_string(v)); }
  void UInt(uint64_t v) { Raw(std::to_string(v)); }
  void Bool(bool v) { Raw(v ? "true" : "false"); }
  void Null() { Raw("null"); }
  void Double(double v) {
    if (std::isinf(v)) { Raw(v > 0 ? "\"inf\"" : "\"-inf\""); return; }
    char buf[64];
    snprintf(buf, sizeof(buf), "%.17g", v);
    Raw(buf);
  }
  void Time(Timestamp t) {
    if (t.IsPlusInfinity()) Raw("\"inf\"");
    else if (t.IsMinusInfinity()) Raw("\"-inf\"");
    else Int(t.us());
  }
  void Delta(TimeDelta t) {
    if (t.IsPlusInfinity()) Raw("\"inf\"");
    else if (t.IsMinusInfinity()) Raw("\"-inf\"");
    else Int(t.us());
  }
  void Str(const std::string& s) {
    Sep();
    str += "\"";
    for (unsigned char c : s) {
      if (c == '"' || c == '\\') { str += '\\'; str += c; }
      else if (c < 0x20 || c >= 0x7f) { char b[8]; snprintf(b, sizeof(b), "\\u%04x", c); str += b; }
      else str += c;
    }
    str += "\"";
  }
  void Hex(const uint8_t* data, size_t size) {
    static const char* d = "0123456789abcdef";
    std::string out;
    for (size_t i = 0; i < size; ++i) { out += d[data[i] >> 4]; out += d[data[i] & 15]; }
    Raw("\"" + out + "\"");
  }
  void Open(char c) { Sep(); str += c; first_ = true; }
  void Close(char c) { str += c; first_ = false; }

 private:
  void Sep() {
    if (!first_) str += ",";
    first_ = false;
  }
  bool first_ = true;
};

void DumpConfig(Json& j, Timestamp t, const rtclog::StreamConfig& c) {
  j.Open('{');
  j.Key("t"); j.Time(t);
  j.Key("local_ssrc"); j.UInt(c.local_ssrc);
  j.Key("remote_ssrc"); j.UInt(c.remote_ssrc);
  j.Key("rtx_ssrc"); j.UInt(c.rtx_ssrc);
  j.Key("extensions"); j.Open('[');
  for (const auto& e : c.rtp_extensions) {
    j.Open('['); j.Str(e.uri); j.Int(e.id.value()); j.Close(']');
  }
  j.Close(']');
  j.Close('}');
}

void DumpRtp(Json& j, const LoggedRtpPacket& p) {
  const RTPHeader& h = p.header;
  j.Open('{');
  j.Key("t"); j.Time(p.timestamp);
  j.Key("marker"); j.Bool(h.markerBit);
  j.Key("pt"); j.Int(h.payloadType);
  j.Key("seq"); j.Int(h.sequenceNumber);
  j.Key("ts"); j.UInt(h.timestamp);
  j.Key("ssrc"); j.UInt(h.ssrc);
  j.Key("header_length"); j.UInt(h.headerLength);
  j.Key("padding"); j.UInt(h.paddingLength);
  j.Key("total_length"); j.UInt(p.total_length);
  j.Key("tseq"); if (h.extension.hasTransportSequenceNumber) j.Int(h.extension.transportSequenceNumber); else j.Null();
  j.Key("tto"); if (h.extension.hasTransmissionTimeOffset) j.Int(h.extension.transmissionTimeOffset); else j.Null();
  j.Key("abs"); if (h.extension.hasAbsoluteSendTime) j.UInt(h.extension.absoluteSendTime); else j.Null();
  j.Key("rotation"); if (h.extension.hasVideoRotation) j.Int(h.extension.videoRotation); else j.Null();
  j.Key("audio_level");
  if (h.extension.audio_level()) {
    j.Open('['); j.Bool(h.extension.audio_level()->voice_activity()); j.Int(h.extension.audio_level()->level()); j.Close(']');
  } else {
    j.Null();
  }
  j.Key("rtx_osn"); if (p.rtx_original_sequence_number) j.Int(*p.rtx_original_sequence_number); else j.Null();
  j.Key("dd"); j.Hex(p.dependency_descriptor_wire_format.data(), p.dependency_descriptor_wire_format.size());
  j.Close('}');
}

void DumpReportBlocks(Json& j, const std::vector<rtcp::ReportBlock>& blocks) {
  j.Open('[');
  for (const auto& b : blocks) {
    j.Open('[');
    j.UInt(b.source_ssrc()); j.Int(b.fraction_lost()); j.Int(b.cumulative_lost()); j.UInt(b.extended_high_seq_num());
    j.UInt(b.jitter()); j.UInt(b.last_sr()); j.UInt(b.delay_since_last_sr());
    j.Close(']');
  }
  j.Close(']');
}

void DumpRtcpBlocks(Json& j, const ParsedRtcEventLog& log, PacketDirection d) {
  j.Open('{');
  j.Key("sr"); j.Open('[');
  for (const auto& e : log.sender_reports(d)) {
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(e.sr.sender_ssrc());
    j.Key("ntp"); j.Open('['); j.UInt(e.sr.ntp().seconds()); j.UInt(e.sr.ntp().fractions()); j.Close(']');
    j.Key("rtp_ts"); j.UInt(e.sr.rtp_timestamp());
    j.Key("packets"); j.UInt(e.sr.sender_packet_count());
    j.Key("octets"); j.UInt(e.sr.sender_octet_count());
    j.Key("blocks"); DumpReportBlocks(j, e.sr.report_blocks());
    j.Close('}');
  }
  j.Close(']');
  j.Key("rr"); j.Open('[');
  for (const auto& e : log.receiver_reports(d)) {
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(e.rr.sender_ssrc());
    j.Key("blocks"); DumpReportBlocks(j, e.rr.report_blocks());
    j.Close('}');
  }
  j.Close(']');
  j.Key("xr"); j.Open('[');
  for (const auto& e : log.extended_reports(d)) {
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(e.xr.sender_ssrc());
    j.Key("rrtr");
    if (e.xr.rrtr()) { j.Open('['); j.UInt(e.xr.rrtr()->ntp().seconds()); j.UInt(e.xr.rrtr()->ntp().fractions()); j.Close(']'); }
    else j.Null();
    j.Key("dlrr"); j.Open('[');
    for (const auto& i : e.xr.dlrr().sub_blocks()) { j.Open('['); j.UInt(i.ssrc); j.UInt(i.last_rr); j.UInt(i.delay_since_last_rr); j.Close(']'); }
    j.Close(']');
    j.Key("target_bitrate");
    if (e.xr.target_bitrate()) {
      j.Open('[');
      for (const auto& b : e.xr.target_bitrate()->GetTargetBitrates()) {
        j.Open('['); j.Int(b.spatial_layer); j.Int(b.temporal_layer); j.UInt(b.target_bitrate_kbps); j.Close(']');
      }
      j.Close(']');
    } else {
      j.Null();
    }
    j.Close('}');
  }
  j.Close(']');
  j.Key("remb"); j.Open('[');
  for (const auto& e : log.rembs(d)) {
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(e.remb.sender_ssrc());
    j.Key("bitrate"); j.Int(e.remb.bitrate_bps());
    j.Key("ssrcs"); j.Open('['); for (uint32_t s : e.remb.ssrcs()) j.UInt(s); j.Close(']');
    j.Close('}');
  }
  j.Close(']');
  j.Key("nack"); j.Open('[');
  for (const auto& e : log.nacks(d)) {
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(e.nack.sender_ssrc());
    j.Key("media_ssrc"); j.UInt(e.nack.media_ssrc());
    j.Key("ids"); j.Open('['); for (uint16_t s : e.nack.packet_ids()) j.Int(s); j.Close(']');
    j.Close('}');
  }
  j.Close(']');
  j.Key("fir"); j.Open('[');
  for (const auto& e : log.firs(d)) {
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(e.fir.sender_ssrc());
    j.Key("requests"); j.Open('[');
    for (const auto& r : e.fir.requests()) { j.Open('['); j.UInt(r.ssrc); j.Int(r.seq_nr); j.Close(']'); }
    j.Close(']');
    j.Close('}');
  }
  j.Close(']');
  j.Key("pli"); j.Open('[');
  for (const auto& e : log.plis(d)) {
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(e.pli.sender_ssrc());
    j.Key("media_ssrc"); j.UInt(e.pli.media_ssrc());
    j.Close('}');
  }
  j.Close(']');
  j.Key("bye"); j.Open('[');
  for (const auto& e : log.byes(d)) {
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(e.bye.sender_ssrc());
    j.Key("csrcs"); j.Open('['); for (uint32_t s : e.bye.csrcs()) j.UInt(s); j.Close(']');
    j.Key("reason"); j.Hex(reinterpret_cast<const uint8_t*>(e.bye.reason().data()), e.bye.reason().size());
    j.Close('}');
  }
  j.Close(']');
  j.Key("transport_feedback"); j.Open('[');
  for (const auto& e : log.transport_feedbacks(d)) {
    const auto& f = e.transport_feedback;
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(f.sender_ssrc());
    j.Key("media_ssrc"); j.UInt(f.media_ssrc());
    j.Key("base_seq"); j.Int(f.GetBaseSequence());
    j.Key("status_count"); j.UInt(f.GetPacketStatusCount());
    j.Key("base_time"); j.Time(f.BaseTime());
    j.Key("include_timestamps"); j.Bool(f.IncludeTimestamps());
    j.Key("packets"); j.Open('[');
    for (const auto& p : f.GetReceivedPackets()) { j.Open('['); j.Int(p.sequence_number()); j.Int(p.delta_ticks()); j.Close(']'); }
    j.Close(']');
    j.Close('}');
  }
  j.Close(']');
  j.Key("congestion_feedback"); j.Open('[');
  for (const auto& e : log.congestion_feedback(d)) {
    const auto& f = e.congestion_feedback;
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(f.sender_ssrc());
    j.Key("ntp"); j.UInt(f.report_timestamp_compact_ntp());
    j.Key("packets"); j.Open('[');
    for (const auto& p : f.packets()) {
      j.Open('['); j.UInt(p.ssrc); j.Int(p.sequence_number); j.Delta(p.arrival_time_offset); j.Int(static_cast<int>(p.ecn)); j.Close(']');
    }
    j.Close(']');
    j.Close('}');
  }
  j.Close(']');
  j.Key("loss_notification"); j.Open('[');
  for (const auto& e : const_cast<ParsedRtcEventLog&>(log).loss_notifications(d)) {
    const auto& n = e.loss_notification;
    j.Open('{');
    j.Key("t"); j.Time(e.timestamp);
    j.Key("ssrc"); j.UInt(n.sender_ssrc());
    j.Key("media_ssrc"); j.UInt(n.media_ssrc());
    j.Key("last_decoded"); j.Int(n.last_decoded());
    j.Key("last_received"); j.Int(n.last_received());
    j.Key("decodability"); j.Bool(n.decodability_flag());
    j.Close('}');
  }
  j.Close(']');
  j.Close('}');
}

void DumpPacketInfos(Json& j, const std::vector<LoggedPacketInfo>& infos) {
  j.Open('[');
  for (const auto& p : infos) {
    j.Open('{');
    j.Key("ssrc"); j.UInt(p.ssrc);
    j.Key("seq"); j.Int(p.stream_seq_no);
    j.Key("size"); j.Int(p.size);
    j.Key("payload"); j.Int(p.payload_size);
    j.Key("padding"); j.Int(p.padding_size);
    j.Key("overhead"); j.Int(p.overhead);
    j.Key("pt"); j.Int(p.payload_type);
    j.Key("media_type"); j.Int(static_cast<int>(p.media_type));
    j.Key("rtx"); j.Bool(p.rtx);
    j.Key("marker"); j.Bool(p.marker_bit);
    j.Key("has_tseq"); j.Bool(p.has_transport_seq_no);
    j.Key("tseq"); j.Int(p.transport_seq_no);
    j.Key("last_in_feedback"); j.Bool(p.last_in_feedback);
    j.Key("capture_time"); j.Time(p.capture_time);
    j.Key("log_packet_time"); j.Time(p.log_packet_time);
    j.Key("reported_send_time"); j.Time(p.reported_send_time);
    j.Key("reported_recv_time"); j.Time(p.reported_recv_time);
    j.Key("log_feedback_time"); j.Time(p.log_feedback_time);
    j.Key("feedback_hold_duration"); j.Delta(p.feedback_hold_duration);
    j.Close('}');
  }
  j.Close(']');
}

std::string Dump(const ParsedRtcEventLog& log) {
  Json j;
  j.Open('{');
  j.Key("start"); j.Open('[');
  for (const auto& e : log.start_log_events()) { j.Open('['); j.Time(e.timestamp); j.Time(e.utc_start_time); j.Close(']'); }
  j.Close(']');
  j.Key("stop"); j.Open('[');
  for (const auto& e : log.stop_log_events()) j.Time(e.timestamp);
  j.Close(']');
  j.Key("audio_recv_configs"); j.Open('['); for (const auto& e : log.audio_recv_configs()) DumpConfig(j, e.timestamp, e.config); j.Close(']');
  j.Key("audio_send_configs"); j.Open('['); for (const auto& e : log.audio_send_configs()) DumpConfig(j, e.timestamp, e.config); j.Close(']');
  j.Key("video_recv_configs"); j.Open('['); for (const auto& e : log.video_recv_configs()) DumpConfig(j, e.timestamp, e.config); j.Close(']');
  j.Key("video_send_configs"); j.Open('['); for (const auto& e : log.video_send_configs()) DumpConfig(j, e.timestamp, e.config); j.Close(']');
  j.Key("alr"); j.Open('[');
  for (const auto& e : log.alr_state_events()) { j.Open('['); j.Time(e.timestamp); j.Bool(e.in_alr); j.Close(']'); }
  j.Close(']');
  j.Key("route_changes"); j.Open('[');
  for (const auto& e : log.route_change_events()) { j.Open('['); j.Time(e.timestamp); j.Bool(e.connected); j.UInt(e.overhead); j.Close(']'); }
  j.Close(']');
  j.Key("remote_estimates"); j.Open('[');
  for (const auto& e : log.remote_estimate_events()) {
    j.Open('['); j.Time(e.timestamp);
    if (e.link_capacity_lower) j.Int(e.link_capacity_lower->bps()); else j.Null();
    if (e.link_capacity_upper) j.Int(e.link_capacity_upper->bps()); else j.Null();
    j.Close(']');
  }
  j.Close(']');
  j.Key("delay_based"); j.Open('[');
  for (const auto& e : log.bwe_delay_updates()) { j.Open('['); j.Time(e.timestamp); j.Int(e.bitrate_bps); j.Int(static_cast<int>(e.detector_state)); j.Close(']'); }
  j.Close(']');
  j.Key("loss_based"); j.Open('[');
  for (const auto& e : log.bwe_loss_updates()) { j.Open('['); j.Time(e.timestamp); j.Int(e.bitrate_bps); j.Int(e.fraction_lost); j.Int(e.expected_packets); j.Close(']'); }
  j.Close(']');
  j.Key("scream"); j.Open('[');
  for (const auto& e : log.bwe_scream_updates()) {
    j.Open('['); j.Time(e.timestamp); j.Int(e.ref_window.bytes()); j.Int(e.data_in_flight.bytes()); j.Int(e.target_rate.bps());
    j.Delta(e.smoothed_rtt); j.Delta(e.avg_queue_delay); j.UInt(e.l4s_marked_permille); j.Close(']');
  }
  j.Close(']');
  j.Key("probe_clusters"); j.Open('[');
  for (const auto& e : log.bwe_probe_cluster_created_events()) {
    j.Open('['); j.Time(e.timestamp); j.Int(e.id); j.Int(e.bitrate_bps); j.UInt(e.min_packets); j.UInt(e.min_bytes); j.Close(']');
  }
  j.Close(']');
  j.Key("probe_success"); j.Open('[');
  for (const auto& e : log.bwe_probe_success_events()) { j.Open('['); j.Time(e.timestamp); j.Int(e.id); j.Int(e.bitrate_bps); j.Close(']'); }
  j.Close(']');
  j.Key("probe_failure"); j.Open('[');
  for (const auto& e : log.bwe_probe_failure_events()) { j.Open('['); j.Time(e.timestamp); j.Int(e.id); j.Int(static_cast<int>(e.failure_reason)); j.Close(']'); }
  j.Close(']');
  j.Key("dtls_transport"); j.Open('[');
  for (const auto& e : log.dtls_transport_states()) { j.Open('['); j.Time(e.timestamp); j.Int(static_cast<int>(e.dtls_transport_state)); j.Close(']'); }
  j.Close(']');
  j.Key("dtls_writable"); j.Open('[');
  for (const auto& e : log.dtls_writable_states()) { j.Open('['); j.Time(e.timestamp); j.Bool(e.writable); j.Close(']'); }
  j.Close(']');
  j.Key("ice_configs"); j.Open('[');
  for (const auto& e : log.ice_candidate_pair_configs()) {
    j.Open('['); j.Time(e.timestamp); j.Int(static_cast<int>(e.type)); j.UInt(e.candidate_pair_id);
    j.Int(static_cast<int>(e.local_candidate_type)); j.Int(static_cast<int>(e.local_relay_protocol));
    j.Int(static_cast<int>(e.local_network_type)); j.Int(static_cast<int>(e.local_address_family));
    j.Int(static_cast<int>(e.remote_candidate_type)); j.Int(static_cast<int>(e.remote_address_family));
    j.Int(static_cast<int>(e.candidate_pair_protocol)); j.Close(']');
  }
  j.Close(']');
  j.Key("ice_events"); j.Open('[');
  for (const auto& e : log.ice_candidate_pair_events()) {
    j.Open('['); j.Time(e.timestamp); j.Int(static_cast<int>(e.type)); j.UInt(e.candidate_pair_id); j.UInt(e.transaction_id); j.Close(']');
  }
  j.Close(']');
  j.Key("audio_playout"); j.Open('[');
  for (const auto& [ssrc, events] : log.audio_playout_events()) {
    j.Open('['); j.UInt(ssrc); j.Open('['); for (const auto& e : events) j.Time(e.timestamp); j.Close(']'); j.Close(']');
  }
  j.Close(']');
  j.Key("neteq"); j.Open('[');
  for (const auto& [ssrc, events] : log.neteq_set_minimum_delay_events()) {
    j.Open('['); j.UInt(ssrc); j.Open('[');
    for (const auto& e : events) { j.Open('['); j.Time(e.timestamp); j.Int(e.minimum_delay_ms); j.Close(']'); }
    j.Close(']'); j.Close(']');
  }
  j.Close(']');
  j.Key("ana"); j.Open('[');
  for (const auto& e : log.audio_network_adaptation_events()) {
    const auto& c = e.config;
    j.Open('['); j.Time(e.timestamp);
    if (c.bitrate_bps) j.Int(*c.bitrate_bps); else j.Null();
    if (c.frame_length_ms) j.Int(*c.frame_length_ms); else j.Null();
    if (c.uplink_packet_loss_fraction) j.Double(*c.uplink_packet_loss_fraction); else j.Null();
    if (c.enable_fec) j.Bool(*c.enable_fec); else j.Null();
    if (c.enable_dtx) j.Bool(*c.enable_dtx); else j.Null();
    if (c.num_channels) j.UInt(*c.num_channels); else j.Null();
    j.Close(']');
  }
  j.Close(']');
  j.Key("frames"); j.Open('[');
  for (const auto& [ssrc, frames] : log.decoded_frames()) {
    j.Open('['); j.UInt(ssrc); j.Open('[');
    for (const auto& f : frames) {
      j.Open('['); j.Time(f.timestamp); j.Int(f.render_time_ms); j.UInt(f.ssrc); j.Int(f.width); j.Int(f.height);
      j.Int(static_cast<int>(f.codec)); j.Int(f.qp); j.Close(']');
    }
    j.Close(']'); j.Close(']');
  }
  j.Close(']');
  j.Key("rtp_in"); j.Open('[');
  for (const auto& s : log.incoming_rtp_packets_by_ssrc()) {
    j.Open('['); j.UInt(s.ssrc); j.Open('['); for (const auto& p : s.incoming_packets) DumpRtp(j, p.rtp); j.Close(']'); j.Close(']');
  }
  j.Close(']');
  j.Key("rtp_out"); j.Open('[');
  for (const auto& s : log.outgoing_rtp_packets_by_ssrc()) {
    j.Open('['); j.UInt(s.ssrc); j.Open('['); for (const auto& p : s.outgoing_packets) DumpRtp(j, p.rtp); j.Close(']'); j.Close(']');
  }
  j.Close(']');
  j.Key("rtcp_in"); j.Open('[');
  for (const auto& p : log.incoming_rtcp_packets()) {
    j.Open('['); j.Time(p.rtcp.timestamp); j.Hex(p.rtcp.raw_data.data(), p.rtcp.raw_data.size()); j.Close(']');
  }
  j.Close(']');
  j.Key("rtcp_out"); j.Open('[');
  for (const auto& p : log.outgoing_rtcp_packets()) {
    j.Open('['); j.Time(p.rtcp.timestamp); j.Hex(p.rtcp.raw_data.data(), p.rtcp.raw_data.size()); j.Close(']');
  }
  j.Close(']');
  j.Key("rtcp_blocks_in"); DumpRtcpBlocks(j, log, kIncomingPacket);
  j.Key("rtcp_blocks_out"); DumpRtcpBlocks(j, log, kOutgoingPacket);
  j.Key("first_timestamp"); j.Time(log.first_timestamp());
  j.Key("last_timestamp"); j.Time(log.last_timestamp());
  j.Key("first_log_segment"); j.Open('['); j.Time(log.first_log_segment().start_time()); j.Time(log.first_log_segment().stop_time()); j.Close(']');
  j.Key("packet_infos_in"); DumpPacketInfos(j, log.GetIncomingPacketInfos());
  j.Key("packet_infos_out"); DumpPacketInfos(j, log.GetOutgoingPacketInfos());
  j.Key("ice_log_events"); j.Open('[');
  for (const auto& e : log.GetIceEvents()) { j.Open('['); j.UInt(e.candidate_pair_id); j.Time(e.log_time); j.Int(static_cast<int>(e.event_type)); j.Close(']'); }
  j.Close(']');
  j.Key("route_change_inferred"); j.Open('[');
  for (const auto& e : log.GetRouteChanges()) {
    j.Open('['); j.UInt(e.route_id); j.Time(e.log_time); j.Int(e.send_overhead); j.Int(e.return_overhead); j.Close(']');
  }
  j.Close(']');
  j.Close('}');
  return j.str;
}

}  // namespace
}  // namespace webrtc

namespace webrtc {
namespace {

// Legacy format (rtc_event_log.proto): there is no upstream encoder for it
// any more, so the events are written with the protobuf API directly, one
// event per EventStream message as the old encoder did.
class LegacyWriter {
 public:
  explicit LegacyWriter(uint64_t seed) : prng_(seed) {}

  std::string Generate() {
    int64_t t = 1'000'000'000;
    auto next = [&]() { t += prng_.Rand(0, 20'000); return t; };
    Event(next(), rtclog::Event::LOG_START);

    // Streams and their header extensions.
    const uint32_t video_in = 0x1100, video_in_rtx = 0x1101, audio_in = 0x1200;
    const uint32_t video_out = 0x2100, video_out_rtx = 0x2101, audio_out = 0x2200;
    const std::vector<RtpExtension> ext_video_in = RandomExtensions();
    const std::vector<RtpExtension> ext_audio_in = RandomExtensions();
    const std::vector<RtpExtension> ext_video_out = RandomExtensions();
    const std::vector<RtpExtension> ext_audio_out = RandomExtensions();
    {
      auto* e = Event(next(), rtclog::Event::VIDEO_RECEIVER_CONFIG_EVENT);
      auto* c = e->mutable_video_receiver_config();
      c->set_remote_ssrc(video_in);
      c->set_local_ssrc(1);
      c->set_rtcp_mode(prng_.Rand<bool>() ? rtclog::VideoReceiveConfig::RTCP_COMPOUND
                                          : rtclog::VideoReceiveConfig::RTCP_REDUCEDSIZE);
      c->set_remb(prng_.Rand<bool>());
      auto* rtx = c->add_rtx_map();
      rtx->set_payload_type(96);
      rtx->mutable_config()->set_rtx_ssrc(video_in_rtx);
      rtx->mutable_config()->set_rtx_payload_type(97);
      AddExtensions(ext_video_in, c->mutable_header_extensions());
      auto* d = c->add_decoders();
      d->set_name("VP8");
      d->set_payload_type(96);
      d = c->add_decoders();
      d->set_name("H264");
      d->set_payload_type(100);
    }
    {
      auto* e = Event(next(), rtclog::Event::VIDEO_SENDER_CONFIG_EVENT);
      auto* c = e->mutable_video_sender_config();
      c->add_ssrcs(video_out);
      c->add_rtx_ssrcs(video_out_rtx);
      c->set_rtx_payload_type(97);
      AddExtensions(ext_video_out, c->mutable_header_extensions());
      c->mutable_encoder()->set_name("VP8");
      c->mutable_encoder()->set_payload_type(96);
    }
    {
      auto* e = Event(next(), rtclog::Event::AUDIO_RECEIVER_CONFIG_EVENT);
      e->mutable_audio_receiver_config()->set_remote_ssrc(audio_in);
      e->mutable_audio_receiver_config()->set_local_ssrc(1);
      AddExtensions(ext_audio_in, e->mutable_audio_receiver_config()->mutable_header_extensions());
    }
    {
      auto* e = Event(next(), rtclog::Event::AUDIO_SENDER_CONFIG_EVENT);
      e->mutable_audio_sender_config()->set_ssrc(audio_out);
      AddExtensions(ext_audio_out, e->mutable_audio_sender_config()->mutable_header_extensions());
    }

    SimulatedClock clock(Timestamp::Micros(t));
    test::EventGenerator gen(prng_.Rand<uint32_t>() + 1, &clock);
    std::vector<uint8_t> last_rtcp;
    for (int i = 0; i < 400; ++i) {
      switch (prng_.Rand(0, 19)) {
        case 0: case 1: case 2: case 3: case 4: case 5: {
          // RTP. Streams without a logged config (0x3xxx) exercise the default
          // header extension map.
          const bool incoming = prng_.Rand<bool>();
          uint32_t ssrc;
          const std::vector<RtpExtension>* ext;
          switch (prng_.Rand(0, 3)) {
            case 0: ssrc = incoming ? video_in : video_out; ext = incoming ? &ext_video_in : &ext_video_out; break;
            case 1: ssrc = incoming ? video_in_rtx : video_out_rtx; ext = incoming ? &ext_video_in : &ext_video_out; break;
            case 2: ssrc = incoming ? audio_in : audio_out; ext = incoming ? &ext_audio_in : &ext_audio_out; break;
            default: ssrc = 0x3000 + prng_.Rand(0, 2); ext = &default_extensions_; break;
          }
          Rtp(next(), incoming, ssrc, *ext);
          break;
        }
        case 6: case 7: {
          const bool incoming = prng_.Rand<bool>();
          std::vector<uint8_t> packet;
          if (incoming && !last_rtcp.empty() && prng_.Rand(0, 3) == 0) {
            packet = last_rtcp;  // logged twice, for audio and video
          } else {
            auto event = incoming ? gen.NewRtcpPacketIncoming() : nullptr;
            if (event) {
              packet.assign(event->packet().begin(), event->packet().end());
            } else {
              auto out = gen.NewRtcpPacketOutgoing();
              packet.assign(out->packet().begin(), out->packet().end());
            }
          }
          if (incoming) last_rtcp = packet;
          auto* e = Event(next(), rtclog::Event::RTCP_EVENT);
          e->mutable_rtcp_packet()->set_incoming(incoming);
          e->mutable_rtcp_packet()->set_type(rtclog::VIDEO);
          e->mutable_rtcp_packet()->set_packet_data(packet.data(), packet.size());
          break;
        }
        case 8: {
          auto* e = Event(next(), rtclog::Event::AUDIO_PLAYOUT_EVENT);
          e->mutable_audio_playout_event()->set_local_ssrc(prng_.Rand<bool>() ? audio_in : audio_in + 7);
          break;
        }
        case 9: {
          auto* e = Event(next(), rtclog::Event::LOSS_BASED_BWE_UPDATE);
          e->mutable_loss_based_bwe_update()->set_bitrate_bps(prng_.Rand(0, 5'000'000));
          e->mutable_loss_based_bwe_update()->set_fraction_loss(prng_.Rand(0, 300));
          e->mutable_loss_based_bwe_update()->set_total_packets(prng_.Rand(0, 1000));
          break;
        }
        case 10: {
          auto* e = Event(next(), rtclog::Event::DELAY_BASED_BWE_UPDATE);
          e->mutable_delay_based_bwe_update()->set_bitrate_bps(prng_.Rand(0, 5'000'000));
          e->mutable_delay_based_bwe_update()->set_detector_state(
              static_cast<rtclog::DelayBasedBweUpdate::DetectorState>(prng_.Rand(0, 2)));
          break;
        }
        case 11: {
          auto* e = Event(next(), rtclog::Event::AUDIO_NETWORK_ADAPTATION_EVENT);
          auto* a = e->mutable_audio_network_adaptation();
          if (prng_.Rand<bool>()) a->set_bitrate_bps(prng_.Rand(6000, 510000));
          if (prng_.Rand<bool>()) a->set_frame_length_ms(20 * prng_.Rand(1, 6));
          if (prng_.Rand<bool>()) a->set_uplink_packet_loss_fraction(prng_.Rand<float>());
          if (prng_.Rand<bool>()) a->set_enable_fec(prng_.Rand<bool>());
          if (prng_.Rand<bool>()) a->set_enable_dtx(prng_.Rand<bool>());
          if (prng_.Rand<bool>()) a->set_num_channels(prng_.Rand(1, 2));
          break;
        }
        case 12: {
          auto* e = Event(next(), rtclog::Event::BWE_PROBE_CLUSTER_CREATED_EVENT);
          auto* p = e->mutable_probe_cluster();
          p->set_id(prng_.Rand(1, 1000));
          p->set_bitrate_bps(prng_.Rand(0, 5'000'000));
          p->set_min_packets(prng_.Rand(1, 20));
          p->set_min_bytes(prng_.Rand(100, 20000));
          break;
        }
        case 13: {
          auto* e = Event(next(), rtclog::Event::BWE_PROBE_RESULT_EVENT);
          auto* p = e->mutable_probe_result();
          p->set_id(prng_.Rand(1, 1000));
          const auto result = static_cast<rtclog::BweProbeResult::ResultType>(prng_.Rand(0, 3));
          p->set_result(result);
          if (result == rtclog::BweProbeResult::SUCCESS) p->set_bitrate_bps(prng_.Rand(0, 5'000'000));
          break;
        }
        case 14: {
          auto* e = Event(next(), rtclog::Event::ALR_STATE_EVENT);
          e->mutable_alr_state()->set_in_alr(prng_.Rand<bool>());
          break;
        }
        case 15: {
          auto* e = Event(next(), rtclog::Event::ICE_CANDIDATE_PAIR_CONFIG);
          auto* c = e->mutable_ice_candidate_pair_config();
          c->set_config_type(static_cast<rtclog::IceCandidatePairConfig::IceCandidatePairConfigType>(prng_.Rand(0, 3)));
          c->set_candidate_pair_id(prng_.Rand(1, 5));
          c->set_local_candidate_type(static_cast<rtclog::IceCandidatePairConfig::IceCandidateType>(prng_.Rand(0, 3)));
          c->set_local_relay_protocol(static_cast<rtclog::IceCandidatePairConfig::Protocol>(prng_.Rand(0, 4)));
          c->set_local_network_type(static_cast<rtclog::IceCandidatePairConfig::NetworkType>(prng_.Rand(0, 5)));
          c->set_local_address_family(static_cast<rtclog::IceCandidatePairConfig::AddressFamily>(prng_.Rand(0, 2)));
          c->set_remote_candidate_type(static_cast<rtclog::IceCandidatePairConfig::IceCandidateType>(prng_.Rand(0, 3)));
          c->set_remote_address_family(static_cast<rtclog::IceCandidatePairConfig::AddressFamily>(prng_.Rand(0, 2)));
          c->set_candidate_pair_protocol(static_cast<rtclog::IceCandidatePairConfig::Protocol>(prng_.Rand(0, 4)));
          break;
        }
        case 16: {
          auto* e = Event(next(), rtclog::Event::ICE_CANDIDATE_PAIR_EVENT);
          e->mutable_ice_candidate_pair_event()->set_event_type(
              static_cast<rtclog::IceCandidatePairEvent::IceCandidatePairEventType>(prng_.Rand(0, 3)));
          e->mutable_ice_candidate_pair_event()->set_candidate_pair_id(prng_.Rand(1, 5));
          break;
        }
        case 17: {
          auto* e = Event(next(), rtclog::Event::REMOTE_ESTIMATE);
          if (prng_.Rand<bool>()) e->mutable_remote_estimate()->set_link_capacity_lower_kbps(prng_.Rand(0, 10000));
          if (prng_.Rand<bool>()) e->mutable_remote_estimate()->set_link_capacity_upper_kbps(prng_.Rand(0, 10000));
          break;
        }
        default:
          Event(next(), rtclog::Event::UNKNOWN_EVENT);
          break;
      }
    }
    Event(next(), rtclog::Event::LOG_END);
    return out_;
  }

 private:
  rtclog::Event* Event(int64_t timestamp_us, rtclog::Event::EventType type) {
    Flush();
    pending_.Clear();
    rtclog::Event* e = pending_.add_stream();
    e->set_timestamp_us(timestamp_us);
    e->set_type(type);
    has_pending_ = true;
    return e;
  }

  void Flush() {
    if (has_pending_) out_ += pending_.SerializeAsString();
    has_pending_ = false;
  }

  std::vector<RtpExtension> RandomExtensions() {
    // Distinct ids 1..14 for the extensions GetHeader() reads, plus one that
    // collides with an earlier id (ignored on registration).
    const char* uris[] = {RtpExtension::kTimestampOffsetUri, RtpExtension::kAbsSendTimeUri,
                          RtpExtension::kTransportSequenceNumberUri, RtpExtension::kAudioLevelUri,
                          RtpExtension::kVideoRotationUri, RtpExtension::kTransportSequenceNumberV2Uri};
    std::vector<int> ids = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14};
    std::vector<RtpExtension> result;
    for (const char* uri : uris) {
      if (prng_.Rand(0, 4) == 0) continue;
      const int i = prng_.Rand(0, ids.size() - 1);
      result.emplace_back(uri, RtpHeaderExtensionId(ids[i]));
      ids.erase(ids.begin() + i);
    }
    if (!result.empty() && prng_.Rand<bool>()) {
      result.emplace_back(RtpExtension::kMidUri, result.front().id);
    }
    return result;
  }

  void AddExtensions(const std::vector<RtpExtension>& extensions,
                     google::protobuf::RepeatedPtrField<rtclog::RtpHeaderExtension>* out) {
    for (const auto& e : extensions) {
      auto* x = out->Add();
      x->set_name(e.uri);
      x->set_id(e.id.value());
    }
  }

  void Rtp(int64_t timestamp_us, bool incoming, uint32_t ssrc, const std::vector<RtpExtension>& extensions) {
    const RtpHeaderExtensionMap map(extensions);
    RtpPacketToSend packet(&map);
    packet.SetMarker(prng_.Rand<bool>());
    packet.SetPayloadType(prng_.Rand(0, 127));
    packet.SetSequenceNumber(prng_.Rand<uint16_t>());
    packet.SetTimestamp(prng_.Rand<uint32_t>());
    packet.SetSsrc(ssrc);
    if (prng_.Rand(0, 3) == 0) packet.SetCsrcs(std::vector<uint32_t>{prng_.Rand<uint32_t>()});
    if (prng_.Rand(0, 3)) packet.SetExtension<TransmissionOffset>(prng_.Rand(-0x7fffff, 0x7fffff));
    if (prng_.Rand(0, 3)) packet.SetExtension<AbsoluteSendTime>(prng_.Rand(0, 0xffffff));
    if (prng_.Rand(0, 3)) packet.SetExtension<TransportSequenceNumber>(prng_.Rand<uint16_t>());
    if (prng_.Rand(0, 3)) packet.SetExtension<TransportSequenceNumberV2>(prng_.Rand<uint16_t>(), std::nullopt);
    if (prng_.Rand(0, 3)) packet.SetExtension<AudioLevelExtension>(AudioLevel(prng_.Rand<bool>(), prng_.Rand(0, 127)));
    if (prng_.Rand(0, 3)) packet.SetExtension<VideoOrientation>(prng_.Rand(0, 255));
    packet.SetPayloadSize(prng_.Rand(0, 1200));
    if (prng_.Rand(0, 4) == 0) packet.SetPadding(prng_.Rand(1, 200));
    auto* e = Event(timestamp_us, rtclog::Event::RTP_EVENT);
    auto* rtp = e->mutable_rtp_packet();
    rtp->set_incoming(incoming);
    rtp->set_type(rtclog::VIDEO);
    rtp->set_packet_length(packet.size());
    rtp->set_header(packet.data(), packet.headers_size());
  }

 public:
  ~LegacyWriter() = default;

 private:
  Random prng_;
  rtclog::EventStream pending_;
  bool has_pending_ = false;
  std::string out_;
  // The default map's assignment (GetDefaultHeaderExtensionMap ids).
  const std::vector<RtpExtension> default_extensions_ = {
      {RtpExtension::kAudioLevelUri, RtpHeaderExtensionId(1)},
      {RtpExtension::kTimestampOffsetUri, RtpHeaderExtensionId(2)},
      {RtpExtension::kAbsSendTimeUri, RtpHeaderExtensionId(3)},
      {RtpExtension::kVideoRotationUri, RtpHeaderExtensionId(4)},
      {RtpExtension::kTransportSequenceNumberUri, RtpHeaderExtensionId(5)}};

 public:
  std::string Finish() {
    Flush();
    return out_;
  }
};

}  // namespace
}  // namespace webrtc

int main(int argc, char** argv) {
  using namespace webrtc;
  // golden legacy <seed> <default-map 0|1> <out.rtc> <out.json>
  if (argc == 6 && std::string(argv[1]) == "legacy") {
    const uint64_t seed = std::strtoull(argv[2], nullptr, 10);
    LegacyWriter writer(seed);
    writer.Generate();
    const std::string encoded = writer.Finish();
    ParsedRtcEventLog parsed(std::string(argv[3]) == "1"
                                 ? ParsedRtcEventLog::UnconfiguredHeaderExtensions::kAttemptWebrtcDefaultConfig
                                 : ParsedRtcEventLog::UnconfiguredHeaderExtensions::kDontParse);
    auto status = parsed.ParseString(encoded);
    if (!status.ok()) {
      fprintf(stderr, "parse failed: %s\n", status.message().c_str());
      return 1;
    }
    std::ofstream(argv[4], std::ios::binary) << encoded;
    std::ofstream(argv[5]) << Dump(parsed) << "\n";
    return 0;
  }
  if (argc != 4) {
    fprintf(stderr, "usage: golden <seed> <out.rtc> <out.json>\n       golden legacy <seed> <default-map 0|1> <out.rtc> <out.json>\n");
    return 2;
  }
  const uint64_t seed = std::strtoull(argv[1], nullptr, 10);
  SimulatedClock clock(Timestamp::Millis(1'000'000));
  test::EventGenerator gen(seed, &clock);
  Random prng(seed * 7 + 1);
  FieldTrials field_trials("");
  RtcEventLogEncoderNewFormat encoder(field_trials);

  std::string encoded = encoder.EncodeLogStart(clock.TimeInMicroseconds(), clock.TimeInMicroseconds() + 1'600'000'000'000'000);

  // Streams, with header extension maps shared by their configs and packets.
  const uint32_t kAudioIn = 0x1000 + prng.Rand(0, 1000), kVideoIn = 0x2000 + prng.Rand(0, 1000);
  const uint32_t kAudioOut = 0x3000 + prng.Rand(0, 1000), kVideoOut = 0x4000 + prng.Rand(0, 1000);
  const RtpHeaderExtensionMap ext_audio_in = gen.NewRtpHeaderExtensionMap(true);
  const RtpHeaderExtensionMap ext_video_in = gen.NewRtpHeaderExtensionMap(true);
  const RtpHeaderExtensionMap ext_audio_out = gen.NewRtpHeaderExtensionMap(true);
  const RtpHeaderExtensionMap ext_video_out = gen.NewRtpHeaderExtensionMap(true);

  std::deque<std::unique_ptr<RtcEvent>> history;
  history.push_back(gen.NewAudioReceiveStreamConfig(kAudioIn, ext_audio_in));
  history.push_back(gen.NewVideoReceiveStreamConfig(kVideoIn, ext_video_in));
  history.push_back(gen.NewAudioSendStreamConfig(kAudioOut, ext_audio_out));
  history.push_back(gen.NewVideoSendStreamConfig(kVideoOut, ext_video_out));

  const int kNumEvents = 600;
  const int kBatchSize = 1 + prng.Rand(0, 120);
  for (int i = 0; i < kNumEvents; ++i) {
    clock.AdvanceTime(TimeDelta::Millis(prng.Rand(0, 20)));
    switch (prng.Rand(0, 29)) {
      case 0: history.push_back(gen.NewAlrState()); break;
      case 1: history.push_back(gen.NewAudioNetworkAdaptation()); break;
      case 2: history.push_back(gen.NewAudioPlayout(prng.Rand<bool>() ? kAudioIn : kAudioIn + 1)); break;
      case 3: history.push_back(gen.NewBweUpdateDelayBased()); break;
      case 4: history.push_back(gen.NewBweUpdateLossBased()); break;
      case 5: history.push_back(gen.NewBweUpdateScream()); break;
      case 6: history.push_back(gen.NewDtlsTransportState()); break;
      case 7: history.push_back(gen.NewDtlsWritableState()); break;
      case 8: history.push_back(gen.NewFrameDecodedEvent(prng.Rand<bool>() ? kVideoIn : kVideoIn + 1)); break;
      case 9: history.push_back(gen.NewIceCandidatePair()); break;
      case 10: history.push_back(gen.NewIceCandidatePairConfig()); break;
      case 11: history.push_back(gen.NewNetEqSetMinimumDelay(kAudioIn)); break;
      case 12: history.push_back(gen.NewProbeClusterCreated()); break;
      case 13: history.push_back(gen.NewProbeResultFailure()); break;
      case 14: history.push_back(gen.NewProbeResultSuccess()); break;
      case 15: history.push_back(gen.NewRouteChange()); break;
      case 16: history.push_back(gen.NewRemoteEstimate()); break;
      case 17: case 18: history.push_back(gen.NewRtcpPacketIncoming()); break;
      case 19: case 20: history.push_back(gen.NewRtcpPacketOutgoing()); break;
      case 21: case 22: history.push_back(gen.NewRtpPacketIncoming(kAudioIn, ext_audio_in, prng.Rand<bool>())); break;
      case 23: case 24: history.push_back(gen.NewRtpPacketIncoming(kVideoIn, ext_video_in, prng.Rand<bool>())); break;
      case 25: case 26: history.push_back(gen.NewRtpPacketOutgoing(kAudioOut, ext_audio_out, prng.Rand<bool>())); break;
      default: history.push_back(gen.NewRtpPacketOutgoing(kVideoOut, ext_video_out, prng.Rand<bool>())); break;
    }
    if (history.size() >= static_cast<size_t>(kBatchSize)) {
      encoded += encoder.EncodeBatch(history.begin(), history.end());
      history.clear();
    }
  }

  // Scripted part, for what the random events do not cover: outgoing video
  // packets with consecutive transport sequence numbers acknowledged by
  // transport feedback (reordered arrivals, i.e. negative deltas, and
  // losses), and outgoing audio packets without transport sequence numbers
  // acknowledged by RFC 8888 congestion control feedback.
  {
    const uint16_t first_tseq = prng.Rand<uint16_t>();
    const uint16_t first_video_seq = prng.Rand<uint16_t>();
    const uint16_t first_audio_seq = prng.Rand<uint16_t>();
    const RtpHeaderExtensionMap no_extensions;
    constexpr int kPackets = 60;
    constexpr int kPerFeedback = 10;
    std::vector<Timestamp> send_times;
    for (int k = 0; k < kPackets; ++k) {
      clock.AdvanceTime(TimeDelta::Millis(prng.Rand(1, 5)));
      send_times.push_back(clock.CurrentTime());

      RtpPacketToSend video(&ext_video_out);
      video.SetPayloadType(96);
      video.SetSequenceNumber(first_video_seq + k);
      video.SetTimestamp(450u * k);
      video.SetSsrc(kVideoOut);
      video.SetExtension<TransportSequenceNumber>(static_cast<uint16_t>(first_tseq + k));
      video.SetPayloadSize(prng.Rand(100, 1200));
      auto video_event = std::make_unique<RtcEventRtpPacketOutgoing>(video, PacedPacketInfo::kNotAProbe);
      video_event->SetTimestamp(clock.CurrentTime());
      history.push_back(std::move(video_event));

      RtpPacketToSend audio(&no_extensions);
      audio.SetPayloadType(111);
      audio.SetSequenceNumber(first_audio_seq + k);
      audio.SetTimestamp(960u * k);
      audio.SetSsrc(kAudioOut);
      audio.SetPayloadSize(prng.Rand(20, 120));
      auto audio_event = std::make_unique<RtcEventRtpPacketOutgoing>(audio, PacedPacketInfo::kNotAProbe);
      audio_event->SetTimestamp(clock.CurrentTime());
      history.push_back(std::move(audio_event));

      if ((k + 1) % kPerFeedback != 0) continue;
      clock.AdvanceTime(TimeDelta::Millis(prng.Rand(5, 30)));
      const int first = k + 1 - kPerFeedback;

      rtcp::TransportFeedback twcc;
      twcc.SetSenderSsrc(kVideoIn);
      twcc.SetMediaSsrc(kVideoOut);
      const Timestamp base = send_times[first] + TimeDelta::Millis(20);
      twcc.SetBase(static_cast<uint16_t>(first_tseq + first), base);
      for (int i = first; i <= k; ++i) {
        if (i != first && prng.Rand(0, 4) == 0) continue;  // lost
        // Some packets arrive "before" the previous one (negative delta).
        Timestamp recv = send_times[i] + TimeDelta::Millis(20) +
                         TimeDelta::Micros(prng.Rand(0, 40000)) - TimeDelta::Micros(prng.Rand(0, 40000));
        twcc.AddReceivedPacket(static_cast<uint16_t>(first_tseq + i), recv);
      }
      auto twcc_event = std::make_unique<RtcEventRtcpPacketIncoming>(twcc.Build());
      twcc_event->SetTimestamp(clock.CurrentTime());
      history.push_back(std::move(twcc_event));

      std::vector<rtcp::CongestionControlFeedback::PacketInfo> infos;
      for (int i = first; i <= k; ++i) {
        rtcp::CongestionControlFeedback::PacketInfo info;
        info.ssrc = kAudioOut;
        info.sequence_number = static_cast<uint16_t>(first_audio_seq + i);
        if (prng.Rand(0, 4) != 0) {
          info.arrival_time_offset = clock.CurrentTime() - send_times[i] - TimeDelta::Millis(prng.Rand(0, 10));
          info.ecn = prng.Rand<bool>() ? EcnMarking::kEct1 : EcnMarking::kCe;
        }
        infos.push_back(info);
      }
      const uint32_t compact_ntp = static_cast<uint32_t>(clock.CurrentTime().us() * 65536 / 1000000);
      rtcp::CongestionControlFeedback ccfb(std::move(infos), compact_ntp);
      ccfb.SetSenderSsrc(kAudioIn);
      auto ccfb_event = std::make_unique<RtcEventRtcpPacketIncoming>(ccfb.Build());
      ccfb_event->SetTimestamp(clock.CurrentTime());
      history.push_back(std::move(ccfb_event));
    }
  }

  encoded += encoder.EncodeBatch(history.begin(), history.end());
  clock.AdvanceTime(TimeDelta::Millis(5));
  encoded += encoder.EncodeLogEnd(clock.TimeInMicroseconds());

  ParsedRtcEventLog parsed;
  auto status = parsed.ParseString(encoded);
  if (!status.ok()) {
    fprintf(stderr, "parse failed: %s\n", status.message().c_str());
    return 1;
  }
  std::ofstream(argv[2], std::ios::binary) << encoded;
  std::ofstream(argv[3]) << Dump(parsed) << "\n";
  return 0;
}
