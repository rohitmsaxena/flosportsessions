import { PlayerEvent, Session } from "./sessions.types";

/** In-memory session storage. All session read/write logic lives here. */
const sessions = new Map<string, Session>();

/** 60s = 30s heartbeat interval + 30s grace period for network delays. */
const INACTIVE_THRESHOLD_MS = 60_000;

/** Returns true if the session has not ended and received an event within the last 60s. */
export function isSessionActive(session: Session): boolean {
  if (session.currentState === "ended") return false;
  return Date.now() - session.lastEventAt.getTime() < INACTIVE_THRESHOLD_MS;
}

/** Recomputes duration and isActive so reads always reflect current truth. */
function computeFields(session: Session): void {
  session.duration = Math.round(
    (session.lastEventAt.getTime() - session.startedAt.getTime()) / 1000
  );
  session.isActive = isSessionActive(session);
}

/** Creates a new session or updates an existing one. Applies the state machine transition and appends the event. */
export function upsertSession(event: PlayerEvent): Session {
  let session = sessions.get(event.sessionId);

  if (!session) {
    session = {
      sessionId: event.sessionId,
      userId: event.userId,
      sportingEventId: event.payload.eventId,
      startedAt: new Date(event.eventTimestamp),
      lastEventAt: new Date(event.eventTimestamp),
      duration: 0,
      currentState: "active",
      isActive: true,
      events: [],
    };
  } else {
    const eventTime = new Date(event.eventTimestamp);
    // Update startedAt if this event is earlier (out-of-order delivery).
    if (eventTime < session.startedAt) {
      session.startedAt = eventTime;
    }
    // Update lastEventAt if this event is later.
    if (eventTime > session.lastEventAt) {
      session.lastEventAt = eventTime;
    }
  }

  switch (event.eventType) {
    case "start":
    case "resume":
    case "buffer_end":
      session.currentState = "active";
      break;
    case "pause":
      session.currentState = "paused";
      break;
    case "buffer_start":
      session.currentState = "buffering";
      break;
    case "end":
      session.currentState = "ended";
      break;
    case "heartbeat":
    case "seek":
    case "quality_change":
      break;
  }

  session.events.push(event);
  computeFields(session);
  sessions.set(event.sessionId, session);

  return session;
}

/** Looks up a session by ID. Recomputes isActive/duration before returning. */
export function getSession(sessionId: string): Session | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  computeFields(session);
  return session;
}

/** Counts sessions that are currently active for a given sporting event. */
export function getActiveViewerCount(sportingEventId: string): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (
      session.sportingEventId === sportingEventId &&
      isSessionActive(session)
    ) {
      count++;
    }
  }
  return count;
}

/** Returns all sessions with recomputed fields. Useful for debugging. */
export function getAllSessions(): Session[] {
  const all = Array.from(sessions.values());
  for (const session of all) {
    computeFields(session);
  }
  return all;
}

/** Clears all sessions. Used in tests for cleanup between runs. */
export function clearSessions(): void {
  sessions.clear();
}