// Port of logging/rtc_event_log/events/rtc_event_log_parse_status.h @ M154.
//
// The RTC_PARSE_* macros become plain `if (...) return RtcEventLogParseStatus.error(...)`;
// the message carries the failed check (as upstream's #X) without a C++
// source location.

export class RtcEventLogParseStatus {
  private constructor(private readonly error: string) {}

  static success(): RtcEventLogParseStatus {
    return new RtcEventLogParseStatus("");
  }

  static error(error: string): RtcEventLogParseStatus {
    return new RtcEventLogParseStatus(error);
  }

  ok(): boolean {
    return this.error === "";
  }

  message(): string {
    return this.error;
  }
}

export class RtcEventLogParseStatusOr<T> {
  private constructor(
    private readonly statusValue: RtcEventLogParseStatus,
    private readonly val: T | undefined,
  ) {}

  static ofStatus<T>(status: RtcEventLogParseStatus): RtcEventLogParseStatusOr<T> {
    return new RtcEventLogParseStatusOr<T>(status, undefined);
  }

  static ofValue<T>(value: T): RtcEventLogParseStatusOr<T> {
    return new RtcEventLogParseStatusOr<T>(RtcEventLogParseStatus.success(), value);
  }

  static error<T>(error: string): RtcEventLogParseStatusOr<T> {
    return new RtcEventLogParseStatusOr<T>(RtcEventLogParseStatus.error(error), undefined);
  }

  ok(): boolean {
    return this.statusValue.ok();
  }

  message(): string {
    return this.statusValue.message();
  }

  status(): RtcEventLogParseStatus {
    return this.statusValue;
  }

  value(): T {
    if (!this.ok()) throw new Error(`value() of a failed RtcEventLogParseStatusOr: ${this.message()}`);
    return this.val as T;
  }
}
