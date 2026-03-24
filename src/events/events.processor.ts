import { PlayerEvent } from "../sessions/sessions.types";
import { upsertSession } from "../sessions/sessions.store";

/** Deduplicates incoming events by eventId and delegates to the session store. */
export class EventProcessor {
  private processedEventIds = new Set<string>();

  /** Skips duplicate eventIds, then calls upsertSession. */
  processEvent(event: PlayerEvent): void {
    if (this.processedEventIds.has(event.eventId)) return;
    this.processedEventIds.add(event.eventId);
    upsertSession(event);
  }

  /** Clears the dedup set. Used in tests for cleanup between runs. */
  clearProcessedEvents(): void {
    this.processedEventIds.clear();
  }
}

export const eventProcessor = new EventProcessor();
