import { PlayerEvent } from "../sessions/sessions.types";
import { eventProcessor } from "./events.processor";

/** In-memory event queue that buffers incoming events and drains them asynchronously. */
export class EventQueue {
  private queue: PlayerEvent[] = [];
  private drainInterval: ReturnType<typeof setInterval> | null = null;

  /** Pushes an event onto the queue. Returns immediately (non-blocking). */
  enqueue(event: PlayerEvent): void {
    this.queue.push(event);
  }

  /** Atomically removes all queued events and processes them in order. */
  drain(): void {
    const batch = this.queue.splice(0);
    for (const event of batch) {
      eventProcessor.processEvent(event);
    }
  }

  /** Starts a setInterval that drains the queue every intervalMs (default 100ms). Idempotent. */
  startDraining(intervalMs: number = 100): void {
    if (this.drainInterval) return;
    this.drainInterval = setInterval(() => this.drain(), intervalMs);
  }

  /** Stops the drain interval. Called on server shutdown and in tests for deterministic control. */
  stopDraining(): void {
    if (this.drainInterval) {
      clearInterval(this.drainInterval);
      this.drainInterval = null;
    }
  }

  /** Returns the number of events waiting to be processed. */
  getQueueLength(): number {
    return this.queue.length;
  }

  /** Discards all queued events without processing. Used in tests for cleanup. */
  clearQueue(): void {
    this.queue = [];
  }
}

export const eventQueue = new EventQueue();
