// Port of api/dtls_transport_interface.h @ M154 (DtlsTransportState).

export enum DtlsTransportState {
  kNew, // Has not started negotiating yet.
  kConnecting, // In the process of negotiating a secure connection.
  kConnected, // Completed negotiation and verified fingerprints.
  kClosed, // Intentionally closed.
  kFailed, // Failure due to an error or failing to verify a remote fingerprint.
  kNumValues,
}
