import { buildApp } from "../src/app";
import {
  clearSessions,
  getActiveViewerCount,
  getSession,
  getAllSessions,
} from "../src/sessions/sessions.store";
import { eventProcessor } from "../src/events/events.processor";
import { eventQueue } from "../src/events/events.queue";
import { PlayerEvent } from "../src/sessions/sessions.types";
import { FastifyInstance } from "fastify";

/**
 * Helper to build a PlayerEvent with sensible defaults and easy overrides.
 * Each call generates a unique eventId unless overridden.
 */
let eventCounter = 0;
function makeEvent(overrides: Partial<PlayerEvent> = {}): PlayerEvent {
  eventCounter++;
  return {
    sessionId: "session-1",
    userId: "user-1",
    eventType: "start",
    eventId: `evt-${eventCounter}-${Math.random().toString(36).slice(2, 8)}`,
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

/** Sends a batch of events via POST /events and returns response metadata. */
async function postEvents(
  app: FastifyInstance,
  events: PlayerEvent[]
): Promise<{ statusCodes: number[]; totalMs: number }> {
  const start = performance.now();
  const responses = await Promise.all(
    events.map((e) =>
      app.inject({ method: "POST", url: "/events", payload: e })
    )
  );
  const totalMs = performance.now() - start;
  return {
    statusCodes: responses.map((r) => r.statusCode),
    totalMs,
  };
}

/** Queries the viewer count endpoint and returns the parsed response. */
async function getViewerCount(
  app: FastifyInstance,
  sportingEventId: string
): Promise<{ activeViewers: number; statusCode: number; ms: number }> {
  const start = performance.now();
  const res = await app.inject({
    method: "GET",
    url: `/events/${sportingEventId}/viewers`,
  });
  const ms = performance.now() - start;
  const body = JSON.parse(res.body);
  return { activeViewers: body.activeViewers, statusCode: res.statusCode, ms };
}

/** Queries a session by ID and returns the parsed response. */
async function querySession(
  app: FastifyInstance,
  sessionId: string
): Promise<{ statusCode: number; body: any; ms: number }> {
  const start = performance.now();
  const res = await app.inject({
    method: "GET",
    url: `/sessions/${sessionId}`,
  });
  const ms = performance.now() - start;
  return {
    statusCode: res.statusCode,
    body: res.statusCode === 200 ? JSON.parse(res.body) : null,
    ms,
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
  eventCounter = 0;
  clearSessions();
  eventProcessor.clearProcessedEvents();
  eventQueue.clearQueue();
  eventQueue.stopDraining();
});

describe("Integration: thousands of messages through both endpoints", () => {
  test("3000 unique sessions — ingest, drain, then query viewers and individual sessions", async () => {
    const TOTAL_EVENTS = 3000;
    const SPORTING_EVENT = "event-nba-finals-2026";

    // 1. Build 3000 start events, each for a unique session/user
    const events = Array.from({ length: TOTAL_EVENTS }, (_, i) =>
      makeEvent({
        sessionId: `sess-${i}`,
        userId: `user-${i}`,
        eventType: "start",
        payload: { eventId: SPORTING_EVENT, position: 0, quality: "1080p" },
      })
    );

    // 2. POST all events concurrently
    const { statusCodes, totalMs } = await postEvents(app, events);

    const accepted = statusCodes.filter((c) => c === 202).length;
    console.log(
      `  POST /events: ${accepted}/${TOTAL_EVENTS} accepted in ${totalMs.toFixed(0)}ms ` +
        `(${(TOTAL_EVENTS / (totalMs / 1000)).toFixed(0)} events/sec)`
    );
    expect(accepted).toBe(TOTAL_EVENTS);

    // 3. Queue should hold all events before drain
    expect(eventQueue.getQueueLength()).toBe(TOTAL_EVENTS);

    // 4. Drain and verify viewer count
    eventQueue.drain();
    expect(eventQueue.getQueueLength()).toBe(0);

    const viewers = await getViewerCount(app, SPORTING_EVENT);
    console.log(
      `  GET /events/${SPORTING_EVENT}/viewers: ${viewers.activeViewers} active in ${viewers.ms.toFixed(1)}ms`
    );
    expect(viewers.statusCode).toBe(200);
    expect(viewers.activeViewers).toBe(TOTAL_EVENTS);

    // 5. Spot-check individual sessions via GET /sessions/:id
    for (const idx of [0, 999, 1500, 2999]) {
      const result = await querySession(app, `sess-${idx}`);
      expect(result.statusCode).toBe(200);
      expect(result.body.currentState).toBe("active");
      expect(result.body.events).toHaveLength(1);
    }
  });

  test("5000 events across a realistic session lifecycle mix", async () => {
    const SPORTING_EVENT = "event-ufc-300";
    const SESSION_COUNT = 1000;

    // Each session gets: start → 2 heartbeats → pause → resume → end = 6 events
    // Except the last 200 sessions only get start → 2 heartbeats (stay active) = 3 events
    // Total: 800 * 6 + 200 * 3 = 5400 events
    const allEvents: PlayerEvent[] = [];
    const eventTypes: PlayerEvent["eventType"][][] = [];

    for (let s = 0; s < SESSION_COUNT; s++) {
      const sessionId = `lifecycle-${s}`;
      const userId = `u-${s}`;
      const base = {
        sessionId,
        userId,
        payload: { eventId: SPORTING_EVENT, position: 0, quality: "720p" },
      };

      if (s < 800) {
        // Full lifecycle — these will end
        const sequence: PlayerEvent["eventType"][] = [
          "start",
          "heartbeat",
          "heartbeat",
          "pause",
          "resume",
          "end",
        ];
        eventTypes.push(sequence);
        for (let i = 0; i < sequence.length; i++) {
          allEvents.push(
            makeEvent({
              ...base,
              eventType: sequence[i],
              payload: { ...base.payload, position: i * 30 },
            })
          );
        }
      } else {
        // Still watching — these stay active
        const sequence: PlayerEvent["eventType"][] = [
          "start",
          "heartbeat",
          "heartbeat",
        ];
        eventTypes.push(sequence);
        for (let i = 0; i < sequence.length; i++) {
          allEvents.push(
            makeEvent({
              ...base,
              eventType: sequence[i],
              payload: { ...base.payload, position: i * 30 },
            })
          );
        }
      }
    }

    console.log(`  Total events to send: ${allEvents.length}`);

    // POST all events
    const { statusCodes, totalMs } = await postEvents(app, allEvents);
    const accepted = statusCodes.filter((c) => c === 202).length;
    console.log(
      `  POST /events: ${accepted}/${allEvents.length} accepted in ${totalMs.toFixed(0)}ms ` +
        `(${(allEvents.length / (totalMs / 1000)).toFixed(0)} events/sec)`
    );
    expect(accepted).toBe(allEvents.length);

    // Drain
    eventQueue.drain();

    // Verify viewer count: only 200 sessions are still active
    const viewers = await getViewerCount(app, SPORTING_EVENT);
    console.log(
      `  Active viewers: ${viewers.activeViewers} (expected 200)`
    );
    expect(viewers.activeViewers).toBe(200);

    // Verify ended sessions
    const endedSession = await querySession(app, "lifecycle-0");
    expect(endedSession.body.currentState).toBe("ended");
    expect(endedSession.body.isActive).toBe(false);
    expect(endedSession.body.events).toHaveLength(6);

    // Verify still-active sessions
    const activeSession = await querySession(app, "lifecycle-999");
    expect(activeSession.body.currentState).toBe("active");
    expect(activeSession.body.isActive).toBe(true);
    expect(activeSession.body.events).toHaveLength(3);
  });

  test("high-frequency queries while events stream in using auto-drain", async () => {
    const SPORTING_EVENT = "event-world-cup-final";
    const BATCH_SIZE = 500;
    const BATCHES = 4;

    // Enable auto-draining (100ms interval) to simulate real server behavior
    eventQueue.startDraining(10);

    const viewerSnapshots: number[] = [];

    for (let batch = 0; batch < BATCHES; batch++) {
      // Send a batch of start events
      const events = Array.from({ length: BATCH_SIZE }, (_, i) =>
        makeEvent({
          sessionId: `stream-${batch}-${i}`,
          userId: `u-${batch}-${i}`,
          eventType: "start",
          payload: {
            eventId: SPORTING_EVENT,
            position: 0,
            quality: "1080p",
          },
        })
      );
      await postEvents(app, events);

      // Wait for drain to process
      await new Promise((r) => setTimeout(r, 50));

      // Query viewer count mid-stream
      const viewers = await getViewerCount(app, SPORTING_EVENT);
      viewerSnapshots.push(viewers.activeViewers);
      console.log(
        `  After batch ${batch + 1}: ${viewers.activeViewers} viewers`
      );
    }

    // Give final drain time
    await new Promise((r) => setTimeout(r, 100));
    eventQueue.stopDraining();

    const finalViewers = await getViewerCount(app, SPORTING_EVENT);
    console.log(`  Final viewer count: ${finalViewers.activeViewers}`);

    // Viewer count should be monotonically non-decreasing
    for (let i = 1; i < viewerSnapshots.length; i++) {
      expect(viewerSnapshots[i]).toBeGreaterThanOrEqual(viewerSnapshots[i - 1]);
    }

    // All 2000 sessions should exist at the end
    expect(finalViewers.activeViewers).toBe(BATCH_SIZE * BATCHES);
  });

  test("mixed sporting events with thousands of viewers each", async () => {
    const EVENTS_MAP: Record<string, number> = {
      "event-nfl-superbowl": 2000,
      "event-premier-league": 1500,
      "event-march-madness": 1000,
      "event-world-series": 500,
    };

    const allEvents: PlayerEvent[] = [];

    for (const [sportingEvent, count] of Object.entries(EVENTS_MAP)) {
      for (let i = 0; i < count; i++) {
        allEvents.push(
          makeEvent({
            sessionId: `${sportingEvent}-sess-${i}`,
            userId: `${sportingEvent}-user-${i}`,
            eventType: "start",
            payload: {
              eventId: sportingEvent,
              position: 0,
              quality: "1080p",
            },
          })
        );
      }
    }

    console.log(`  Total events across all sporting events: ${allEvents.length}`);

    // Shuffle events to simulate real-world interleaving
    for (let i = allEvents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allEvents[i], allEvents[j]] = [allEvents[j], allEvents[i]];
    }

    const { statusCodes, totalMs } = await postEvents(app, allEvents);
    const accepted = statusCodes.filter((c) => c === 202).length;
    console.log(
      `  POST /events: ${accepted}/${allEvents.length} accepted in ${totalMs.toFixed(0)}ms`
    );
    expect(accepted).toBe(allEvents.length);

    eventQueue.drain();

    // Verify each sporting event has the correct viewer count
    for (const [sportingEvent, expectedCount] of Object.entries(EVENTS_MAP)) {
      const viewers = await getViewerCount(app, sportingEvent);
      console.log(
        `  ${sportingEvent}: ${viewers.activeViewers} viewers (expected ${expectedCount})`
      );
      expect(viewers.activeViewers).toBe(expectedCount);
    }

    // Total sessions should be the sum
    const totalSessions = getAllSessions().length;
    const expectedTotal = Object.values(EVENTS_MAP).reduce((a, b) => a + b, 0);
    console.log(`  Total sessions in store: ${totalSessions}`);
    expect(totalSessions).toBe(expectedTotal);
  });

  test("duplicate event IDs are properly deduplicated at scale", async () => {
    const SPORTING_EVENT = "event-dedup-test";
    const UNIQUE_EVENTS = 1000;

    // Create 1000 unique events
    const uniqueEvents = Array.from({ length: UNIQUE_EVENTS }, (_, i) =>
      makeEvent({
        sessionId: `dedup-sess-${i}`,
        userId: `dedup-user-${i}`,
        eventId: `fixed-evt-${i}`,
        eventType: "start",
        payload: { eventId: SPORTING_EVENT, position: 0, quality: "1080p" },
      })
    );

    // Duplicate each event 3 times = 3000 total events, only 1000 unique
    const allEvents = [...uniqueEvents, ...uniqueEvents, ...uniqueEvents];

    // Shuffle so duplicates are interleaved
    for (let i = allEvents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allEvents[i], allEvents[j]] = [allEvents[j], allEvents[i]];
    }

    console.log(
      `  Sending ${allEvents.length} events (${UNIQUE_EVENTS} unique, rest are duplicates)`
    );

    const { statusCodes, totalMs } = await postEvents(app, allEvents);
    expect(statusCodes.every((c) => c === 202)).toBe(true);
    console.log(`  All ${allEvents.length} accepted in ${totalMs.toFixed(0)}ms`);

    eventQueue.drain();

    const viewers = await getViewerCount(app, SPORTING_EVENT);
    console.log(`  Active viewers after dedup: ${viewers.activeViewers}`);
    expect(viewers.activeViewers).toBe(UNIQUE_EVENTS);

    // Each session should have exactly 1 event (duplicates discarded)
    const spot = getSession("dedup-sess-500");
    expect(spot!.events).toHaveLength(1);
  });

  test("querying sessions that do not exist returns 404", async () => {
    // Send some real events first
    const events = Array.from({ length: 100 }, (_, i) =>
      makeEvent({
        sessionId: `real-${i}`,
        userId: `user-${i}`,
        eventType: "start",
      })
    );
    await postEvents(app, events);
    eventQueue.drain();

    // Query 100 nonexistent sessions in parallel
    const notFoundResults = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        querySession(app, `nonexistent-${i}`)
      )
    );

    expect(notFoundResults.every((r) => r.statusCode === 404)).toBe(true);

    // Query 100 real sessions in parallel
    const foundResults = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        querySession(app, `real-${i}`)
      )
    );

    expect(foundResults.every((r) => r.statusCode === 200)).toBe(true);
    console.log(
      `  100 not-found queries + 100 found queries all returned correct status`
    );
  });
});
