// Port of logging/rtc_event_log/events/rtc_event_dtls_transport_state.h @ M154 (LoggedDtlsTransportState).

import {DtlsTransportState} from "../../../api/dtls-transport-interface.js";
import {Timestamp} from "../../../api/units/timestamp.js";
import {LoggedEvent} from "./logged-event.js";

export class LoggedDtlsTransportState extends LoggedEvent {
  constructor(
    timestamp: Timestamp = Timestamp.minusInfinity(),
    public dtlsTransportState: DtlsTransportState = DtlsTransportState.kNew,
  ) {
    super(timestamp);
  }
}
