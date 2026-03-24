import { buildApp } from "../src/app";
import {
  clearSessions,
  getActiveViewerCount,
  getSession,
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

describe("Load / burst test", () => {
  test("handles 1000 concurrent events without dropping any", async () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      makeEvent({ sessionId: `s-${i}`, eventId: `e-${i}` })
    );

    const responses = await Promise.all(
      events.map((e) =>
        app.inject({ method: "POST", url: "/events", payload: e })
      )
    );

    expect(responses.every((r) => r.statusCode === 202)).toBe(true);

    eventQueue.drain();

    expect(getActiveViewerCount("event-2026-wrestling-finals")).toBe(1000);
  });

  test("handles burst of events for same session", async () => {
    const events: PlayerEvent[] = [
      makeEvent({ eventId: "e-0", eventType: "start" }),
    ];
    for (let i = 1; i <= 98; i++) {
      events.push(
        makeEvent({ eventId: `e-${i}`, eventType: "heartbeat" })
      );
    }
    events.push(makeEvent({ eventId: "e-99", eventType: "end" }));

    const responses = await Promise.all(
      events.map((e) =>
        app.inject({ method: "POST", url: "/events", payload: e })
      )
    );

    expect(responses.every((r) => r.statusCode === 202)).toBe(true);

    eventQueue.drain();

    const session = getSession("session-1");
    expect(session!.events).toHaveLength(100);
    expect(session!.currentState).toBe("ended");
  });

  test("concurrent events across multiple sporting events", async () => {
    const eventsA = Array.from({ length: 500 }, (_, i) =>
      makeEvent({
        sessionId: `a-${i}`,
        eventId: `ea-${i}`,
        payload: { eventId: "event-A", position: 0, quality: "1080p" },
      })
    );
    const eventsB = Array.from({ length: 500 }, (_, i) =>
      makeEvent({
        sessionId: `b-${i}`,
        eventId: `eb-${i}`,
        payload: { eventId: "event-B", position: 0, quality: "720p" },
      })
    );

    const responses = await Promise.all(
      [...eventsA, ...eventsB].map((e) =>
        app.inject({ method: "POST", url: "/events", payload: e })
      )
    );

    expect(responses.every((r) => r.statusCode === 202)).toBe(true);

    eventQueue.drain();

    expect(getActiveViewerCount("event-A")).toBe(500);
    expect(getActiveViewerCount("event-B")).toBe(500);
  });
});
