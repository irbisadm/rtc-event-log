// Port of api/transport/ecn_marking.h @ M154.

export enum EcnMarking {
  kNotEct = 0b00, // Not ECN-Capable Transport
  kEct1 = 0b01, // ECN-Capable Transport
  kEct0 = 0b10, // Not used by L4S (or webrtc.)
  kCe = 0b11, // Congestion experienced
}
