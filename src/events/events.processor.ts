import { PlayerEvent } from "../sessions/sessions.types";
import { upsertSession } from "../sessions/sessions.store";

/** Max number of event IDs to keep for deduplication before evicting oldest entries. */
const MAX_DEDUP_SIZE = 100_000;

/** Deduplicates incoming events by eventId and delegates to the session store. */
export class EventProcessor {
  private processedEventIds = new Set<string>();

  /** Skips duplicate eventIds, then calls upsertSession. Evicts oldest entries when the dedup set exceeds MAX_DEDUP_SIZE. */
  processEvent(event: PlayerEvent): void {
    if (this.processedEventIds.has(event.eventId)) return;
    this.processedEventIds.add(event.eventId);

    // Evict oldest entries when the set grows too large to prevent unbounded memory growth.
    if (this.processedEventIds.size > MAX_DEDUP_SIZE) {
      const iter = this.processedEventIds.values();
      this.processedEventIds.delete(iter.next().value as string);
    }

    upsertSession(event);
  }

  /** Clears the dedup set. Used in tests for cleanup between runs. */
  clearProcessedEvents(): void {
    this.processedEventIds.clear();
  }
}

export const eventProcessor = new EventProcessor();
