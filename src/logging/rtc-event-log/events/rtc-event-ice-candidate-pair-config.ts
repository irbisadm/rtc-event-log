// Port of logging/rtc_event_log/events/rtc_event_ice_candidate_pair_config.h @ M154 (LoggedIceCandidatePairConfig and its enums).

import {IceCandidateType} from "../../../api/candidate.js";
import {LoggedEvent} from "./logged-event.js";

export enum IceCandidatePairConfigType {
  kAdded,
  kUpdated,
  kDestroyed,
  kSelected,
  kNumValues,
}

// TODO(qingsi): Change the names of candidate types to "host", "srflx", "prflx"
// and "relay" after the naming is spec-compliant in the signaling part
export enum IceCandidatePairProtocol {
  kUnknown,
  kUdp,
  kTcp,
  kSsltcp,
  kTls,
  kNumValues,
}

export enum IceCandidatePairAddressFamily {
  kUnknown,
  kIpv4,
  kIpv6,
  kNumValues,
}

export enum IceCandidateNetworkType {
  kUnknown,
  kEthernet,
  kLoopback,
  kWifi,
  kVpn,
  kCellular,
  kNumValues,
}

export class LoggedIceCandidatePairConfig extends LoggedEvent {
  type: IceCandidatePairConfigType = IceCandidatePairConfigType.kAdded;
  candidatePairId = 0;
  localCandidateType: IceCandidateType = IceCandidateType.kHost;
  localRelayProtocol: IceCandidatePairProtocol = IceCandidatePairProtocol.kUnknown;
  localNetworkType: IceCandidateNetworkType = IceCandidateNetworkType.kUnknown;
  localAddressFamily: IceCandidatePairAddressFamily = IceCandidatePairAddressFamily.kUnknown;
  remoteCandidateType: IceCandidateType = IceCandidateType.kHost;
  remoteAddressFamily: IceCandidatePairAddressFamily = IceCandidatePairAddressFamily.kUnknown;
  candidatePairProtocol: IceCandidatePairProtocol = IceCandidatePairProtocol.kUnknown;
}
