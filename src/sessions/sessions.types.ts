/** Raw event fired by the player SDK. Note: eventId is for dedup, payload.eventId is the sporting event. */
export interface PlayerEvent {
  sessionId: string;
  userId: string;
  eventType:
    | "start"
    | "heartbeat"
    | "pause"
    | "resume"
    | "seek"
    | "quality_change"
    | "buffer_start"
    | "buffer_end"
    | "end";
  eventId: string;
  eventTimestamp: string;
  receivedAt: string;
  payload: {
    eventId: string;
    position: number;
    quality: string;
  };
}

/** Aggregated viewer session built from one or more PlayerEvents. Stored in an in-memory Map keyed by sessionId. */
export interface Session {
  sessionId: string;
  userId: string;
  sportingEventId: string;

  startedAt: Date;
  lastEventAt: Date;
  duration: number;
  currentState: "active" | "paused" | "buffering" | "ended";
  isActive: boolean;

  events: PlayerEvent[];
}
