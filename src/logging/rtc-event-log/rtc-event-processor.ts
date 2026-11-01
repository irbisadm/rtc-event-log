// Port of logging/rtc_event_log/rtc_event_processor.h @ M154.
//
// Merges several time-ordered event lists and calls their handlers in
// timestamp order; ties are broken by type order (rtc_event_processor_order),
// then transport sequence number, then insertion order. With the insertion
// order as the last key, the next list is picked by a linear scan instead of
// upstream's std::*_heap calls; the result is the same whenever the
// comparison is a strict weak order (transport sequence numbers more than
// half the range apart could make it cyclic).

import {aheadOf} from "../../rtc-base/numerics/sequence-number-util.js";

interface Timed {
  logTimeUs(): number;
}

class ProcessableEventList<T extends Timed> {
  private next = 0;

  constructor(
    private readonly events: readonly T[],
    private readonly handler: (event: T) => void,
    readonly typeOrder: number,
    private readonly transportSeqNumAccessor: ((event: T) => number | undefined) | undefined,
    readonly insertionOrder: number,
  ) {}

  processNext(): void {
    this.handler(this.events[this.next]);
    ++this.next;
  }

  isEmpty(): boolean {
    return this.next === this.events.length;
  }

  getNextTime(): number {
    return this.events[this.next].logTimeUs();
  }

  getTransportSeqNum(): number | undefined {
    return this.transportSeqNumAccessor?.(this.events[this.next]);
  }
}

export class RtcEventProcessor {
  private eventLists: ProcessableEventList<Timed>[] = [];
  private numInsertions = 0;

  // `typeOrder` is the TieBreaker type order of the event type (see
  // rtc-event-processor-order.ts); `transportSeqNumAccessor` is given for RTP
  // packets only.
  addEvents<T extends Timed>(
    iterable: readonly T[],
    handler: (event: T) => void,
    typeOrder: number,
    transportSeqNumAccessor?: (event: T) => number | undefined,
  ): void {
    if (iterable.length === 0) return;
    const insertionOrder = this.numInsertions++;
    this.eventLists.push(
      new ProcessableEventList<T>(iterable, handler, typeOrder, transportSeqNumAccessor, insertionOrder) as unknown as ProcessableEventList<Timed>,
    );
  }

  processEventsInOrder(): void {
    const lists = this.eventLists.filter((list) => !list.isEmpty());
    while (lists.length !== 0) {
      // The list that is not "less than" any other (the heap top).
      let best = 0;
      for (let i = 1; i < lists.length; ++i) {
        if (RtcEventProcessor.cmp(lists[best], lists[i])) best = i;
      }
      lists[best].processNext();
      if (lists[best].isEmpty()) lists.splice(best, 1);
    }
    this.eventLists = [];
  }

  // Comparison function to make `event_lists_` into a min heap.
  private static cmp(a: ProcessableEventList<Timed>, b: ProcessableEventList<Timed>): boolean {
    const timeDiff = a.getNextTime() - b.getNextTime();
    if (timeDiff !== 0) return timeDiff > 0;

    if (a.typeOrder !== b.typeOrder) return a.typeOrder > b.typeOrder;

    const wrappedSeqNumA = a.getTransportSeqNum();
    const wrappedSeqNumB = b.getTransportSeqNum();
    if (wrappedSeqNumA !== undefined && wrappedSeqNumB !== undefined) {
      return aheadOf(wrappedSeqNumA, wrappedSeqNumB, 16);
    } else if ((wrappedSeqNumA !== undefined) !== (wrappedSeqNumB !== undefined)) {
      return wrappedSeqNumA !== undefined;
    }

    return a.insertionOrder > b.insertionOrder;
  }
}
