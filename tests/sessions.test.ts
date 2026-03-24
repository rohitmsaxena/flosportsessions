import { buildApp } from "../src/app";
import {
  clearSessions,
  upsertSession,
  getSession,
  isSessionActive,
  getActiveViewerCount,
} from "../src/sessions/sessions.store";
import { eventProcessor } from "../src/events/events.processor";
import { eventQueue } from "../src/events/events.queue";
import { PlayerEvent } from "../src/sessions/sessions.types";
import { FastifyInstance } from "fastify";

function makeEvent(overrides: Partial<PlayerEvent> = {}): PlayerEvent {
  return {
    sessionId: "session-1",
    userId: "user-1",
    eventType: "start",
    eventId: `evt-${Date.now()}-${Math.random()}`,
    eventTimestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    payload: {
      eventId: "event-2026-wrestling-finals",
      position: 0,
      quality: "1080p",
    },
    ...overrides,
  };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clearSessions();
  eventProcessor.clearProcessedEvents();
  eventQueue.clearQueue();
  eventQueue.stopDraining();
});

describe("Session lifecycle", () => {
  test("start event creates a new active session", () => {
    const session = upsertSession(makeEvent({ eventType: "start" }));
    expect(session.currentState).toBe("active");
    expect(session.isActive).toBe(true);
  });

  test("heartbeat updates lastEventAt without changing state", () => {
    upsertSession(makeEvent({ eventType: "start" }));
    const later = new Date(Date.now() + 5000).toISOString();
    const session = upsertSession(
      makeEvent({ eventType: "heartbeat", eventTimestamp: later })
    );
    expect(session.currentState).toBe("active");
    expect(session.lastEventAt).toEqual(new Date(later));
  });

  test("pause transitions to paused", () => {
    upsertSession(makeEvent({ eventType: "start" }));
    const session = upsertSession(makeEvent({ eventType: "pause" }));
    expect(session.currentState).toBe("paused");
  });

  test("resume transitions back to active", () => {
    upsertSession(makeEvent({ eventType: "start" }));
    upsertSession(makeEvent({ eventType: "pause" }));
    const session = upsertSession(makeEvent({ eventType: "resume" }));
    expect(session.currentState).toBe("active");
  });

  test("buffer_start transitions to buffering", () => {
    upsertSession(makeEvent({ eventType: "start" }));
    const session = upsertSession(makeEvent({ eventType: "buffer_start" }));
    expect(session.currentState).toBe("buffering");
  });

  test("buffer_end transitions back to active", () => {
    upsertSession(makeEvent({ eventType: "start" }));
    upsertSession(makeEvent({ eventType: "buffer_start" }));
    const session = upsertSession(makeEvent({ eventType: "buffer_end" }));
    expect(session.currentState).toBe("active");
  });

  test("end transitions to ended and sets isActive false", () => {
    upsertSession(makeEvent({ eventType: "start" }));
    const session = upsertSession(makeEvent({ eventType: "end" }));
    expect(session.currentState).toBe("ended");
    expect(session.isActive).toBe(false);
  });

  test("seek and quality_change do not change state", () => {
    upsertSession(makeEvent({ eventType: "start" }));
    let session = upsertSession(makeEvent({ eventType: "seek" }));
    expect(session.currentState).toBe("active");
    session = upsertSession(makeEvent({ eventType: "quality_change" }));
    expect(session.currentState).toBe("active");
  });
});

describe("Active session definition", () => {
  test("session is active within 60s of last event", () => {
    const session = upsertSession(makeEvent({ eventType: "start" }));
    expect(isSessionActive(session)).toBe(true);
  });

  test("session becomes inactive after 60s of no events", () => {
    const oldTimestamp = new Date(Date.now() - 61_000).toISOString();
    const session = upsertSession(
      makeEvent({ eventType: "start", eventTimestamp: oldTimestamp })
    );
    expect(isSessionActive(session)).toBe(false);
  });

  test("ended session is never active regardless of time", () => {
    upsertSession(makeEvent({ eventType: "start" }));
    const session = upsertSession(makeEvent({ eventType: "end" }));
    expect(isSessionActive(session)).toBe(false);
  });
});

describe("Viewer count", () => {
  test("counts only active sessions for a given sporting event", () => {
    upsertSession(
      makeEvent({ sessionId: "s1", eventType: "start" })
    );
    upsertSession(
      makeEvent({ sessionId: "s2", eventType: "start" })
    );
    upsertSession(
      makeEvent({ sessionId: "s3", eventType: "start" })
    );
    upsertSession(
      makeEvent({ sessionId: "s3", eventType: "end" })
    );

    expect(getActiveViewerCount("event-2026-wrestling-finals")).toBe(2);
  });

  test("returns 0 for unknown sporting event", () => {
    expect(getActiveViewerCount("nonexistent")).toBe(0);
  });
});

describe("GET /sessions/:sessionId", () => {
  test("returns session details with 200", async () => {
    upsertSession(makeEvent({ eventType: "start" }));
    const res = await app.inject({ method: "GET", url: "/sessions/session-1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe("session-1");
    expect(body.currentState).toBe("active");
  });

  test("returns 404 for unknown session", async () => {
    const res = await app.inject({ method: "GET", url: "/sessions/unknown" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /events/:sportingEventId/viewers", () => {
  test("returns viewer count", async () => {
    upsertSession(makeEvent({ sessionId: "s1", eventType: "start" }));
    upsertSession(makeEvent({ sessionId: "s2", eventType: "start" }));
    const res = await app.inject({
      method: "GET",
      url: "/events/event-2026-wrestling-finals/viewers",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().activeViewers).toBe(2);
  });
});
