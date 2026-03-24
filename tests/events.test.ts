import { buildApp } from "../src/app";
import { clearSessions, getSession } from "../src/sessions/sessions.store";
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

describe("POST /events", () => {
  test("returns 202 Accepted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: makeEvent(),
    });
    expect(res.statusCode).toBe(202);
  });

  test("returns 400 for invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: { sessionId: "s1" },
    });
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 for invalid eventType", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: makeEvent({ eventType: "invalid" as any }),
    });
    expect(res.statusCode).toBe(400);
  });

  test("stamps receivedAt on the server", async () => {
    const event = makeEvent();
    delete (event as any).receivedAt;
    await app.inject({ method: "POST", url: "/events", payload: event });
    eventQueue.drain();
    const session = getSession("session-1");
    expect(session).toBeDefined();
    expect(session!.events[0].receivedAt).toBeDefined();
  });
});

describe("Queue async behavior", () => {
  test("event is not processed immediately after POST", async () => {
    await app.inject({ method: "POST", url: "/events", payload: makeEvent() });
    expect(getSession("session-1")).toBeUndefined();
  });

  test("event is processed after drain", async () => {
    await app.inject({ method: "POST", url: "/events", payload: makeEvent() });
    eventQueue.drain();
    expect(getSession("session-1")).toBeDefined();
  });

  test("multiple events are drained in order", () => {
    const e1 = makeEvent({ eventId: "e1", eventType: "start" });
    const e2 = makeEvent({ eventId: "e2", eventType: "heartbeat" });
    const e3 = makeEvent({ eventId: "e3", eventType: "pause" });
    eventQueue.enqueue(e1);
    eventQueue.enqueue(e2);
    eventQueue.enqueue(e3);
    eventQueue.drain();
    const session = getSession("session-1");
    expect(session!.events).toHaveLength(3);
    expect(session!.events[0].eventId).toBe("e1");
    expect(session!.events[2].eventId).toBe("e3");
  });
});

describe("Deduplication", () => {
  test("duplicate eventId is ignored", () => {
    const e1 = makeEvent({ eventId: "dup-1" });
    const e2 = makeEvent({ eventId: "dup-1", eventTimestamp: new Date(Date.now() + 1000).toISOString() });
    eventQueue.enqueue(e1);
    eventQueue.enqueue(e2);
    eventQueue.drain();
    const session = getSession("session-1");
    expect(session!.events).toHaveLength(1);
  });

  test("different eventIds are both processed", () => {
    eventQueue.enqueue(makeEvent({ eventId: "a" }));
    eventQueue.enqueue(makeEvent({ eventId: "b", eventType: "heartbeat" }));
    eventQueue.drain();
    const session = getSession("session-1");
    expect(session!.events).toHaveLength(2);
  });
});

describe("Schema validation", () => {
  test("rejects missing sessionId", async () => {
    const event = makeEvent();
    delete (event as any).sessionId;
    const res = await app.inject({ method: "POST", url: "/events", payload: event });
    expect(res.statusCode).toBe(400);
  });

  test("rejects missing payload", async () => {
    const event = makeEvent();
    delete (event as any).payload;
    const res = await app.inject({ method: "POST", url: "/events", payload: event });
    expect(res.statusCode).toBe(400);
  });

  test("rejects invalid payload.position type", async () => {
    const event = makeEvent();
    (event.payload as any).position = "not-a-number";
    const res = await app.inject({ method: "POST", url: "/events", payload: event });
    expect(res.statusCode).toBe(400);
  });
});
