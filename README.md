# README.md — Watch Session Tracker (FloSports Take-Home)

## What This Service Does
Ingests player SDK events from a video streaming platform and provides
real-time analytics on active viewer sessions. Replaces a legacy hourly
batch pipeline with a near-real-time alternative.

## The Three Stakeholder Tensions (and how we resolve them)
- **Product** wants viewer counts within 10-15 seconds of reality
- **Ops** cannot afford dropped events during traffic spikes
- **Engineering** wants simplicity — this is a v1 POC

Resolution: in-memory queue (array + setInterval) that buffers incoming
events and drains them asynchronously every 100ms. Same conceptual
architecture as SQS — just without the external dependency. In production
this would be replaced with SQS.

## Tech Stack
- **Runtime:** Node.js + TypeScript
- **Framework:** Fastify — built-in schema validation, faster than Express
- **Storage:** In-memory Map — no database, no ORM, no setup overhead
- **Queue:** In-memory array + setInterval (100ms drain interval)
- **Testing:** Jest + Supertest

## Project Structure
```
src/
  events/
    events.routes.ts      # POST /events endpoint
    events.queue.ts       # in-memory queue + drain worker
    events.processor.ts   # processes event, updates session state
    events.schema.ts      # Fastify schema validation for incoming events
  sessions/
    sessions.routes.ts    # GET /sessions/:sessionId
    sessions.store.ts     # in-memory Map, all session read/write logic
    sessions.types.ts     # TypeScript interfaces
  app.ts                  # Fastify app setup, registers routes
  server.ts               # entry point, starts server
tests/
  events.test.ts          # event ingestion + queue tests
  sessions.test.ts        # session lifecycle tests
  load.test.ts            # burst/throughput stress test
```

## Data Model

### Incoming Event (from SDK)
```typescript
interface PlayerEvent {
  sessionId: string;
  userId: string;
  eventType: 'start' | 'heartbeat' | 'pause' | 'resume' | 'seek' | 
             'quality_change' | 'buffer_start' | 'buffer_end' | 'end';
  eventId: string;          // unique ID for THIS sdk event (deduplication)
  eventTimestamp: string;   // ISO8601 — when the player fired it
  receivedAt: string;       // ISO8601 — when we received it
  payload: {
    eventId: string;        // sports event being watched (grouping key)
    position: number;       // playhead position in seconds
    quality: string;        // e.g. "1080p"
  };
}
```

### Session (stored in Map)
```typescript
interface Session {
  sessionId: string;
  userId: string;
  sportingEventId: string;    // payload.eventId — groups sessions by event
  
  // computed fields
  startedAt: Date;            // timestamp of first event
  lastEventAt: Date;          // timestamp of most recent event
  duration: number;           // seconds since startedAt
  currentState: 'active' | 'paused' | 'buffering' | 'ended';
  isActive: boolean;          // false if ended or no event in last 60s
  
  // raw event history
  events: PlayerEvent[];      // all events received for this session
}
```

## Active Session Definition
A session is considered **active** if:
- It has NOT received an `end` event
- Its `lastEventAt` is within the last **60 seconds**

The 60s threshold accounts for the 30s heartbeat interval plus a 30s
grace period for network delays.

## Key Architecture Notes

### Two Different eventId Fields
- `event.eventId` — unique ID for the SDK event itself (use for deduplication)
- `event.payload.eventId` — the sporting event being watched (use for grouping/viewer counts)

### Queue Flow
```
POST /events → push to queue array → return 202 immediately
                      ↓
setInterval (100ms) → drain queue → processEvent() → update session Map
```

### Session State Machine
```
start → active
heartbeat → stays active (updates lastEventAt)
pause → paused
resume → active
buffer_start → buffering
buffer_end → active
end → ended (isActive = false)
```

## Assumptions
- **Event schema is fixed.** The SDK owns the schema; we accept it as-is. The confusing dual use of `eventId` (top-level = dedup key, `payload.eventId` = sporting event) is the SDK's design, not ours. In a real engagement I'd ask if we can rename `payload.eventId` to `payload.sportingEventId` to reduce confusion.
- **Wall-clock duration is acceptable.** `duration` measures time from first event to last event, including paused and buffering periods. If product needs actual watch time (excluding pauses), we'd need to track state transition timestamps and subtract non-active intervals. I'd ask product which definition they want before building it.
- **Events arrive roughly in order.** The SDK fires events sequentially per session. We don't handle out-of-order delivery (e.g., a `heartbeat` arriving before `start` due to network reordering). For v1 this is fine; in production we'd sort by `eventTimestamp` before processing.
- **No event replay or backfill.** If the service restarts, in-flight sessions are lost. The PRD says "events that get dropped are gone forever — there's no replay mechanism yet," so persistence isn't expected for v1.
- **Single instance only.** In-memory state means one process. Horizontal scaling would require moving sessions to Redis or a shared store. This is a known limitation we'd address before production.
- **Heartbeat interval is 30 seconds.** The PRD states this. We use a 60-second inactivity threshold (30s heartbeat + 30s grace) to determine if a session is still active. If the heartbeat interval changes, this threshold needs to change with it.

## Tools and Resources Used
- **Claude (AI assistant)** — Used for initial project scaffolding, generating boilerplate (Fastify setup, Jest config, TypeScript config), drafting test cases, and iterating on the queue/processor architecture. All generated code was reviewed and modified to fit the design.
- **Fastify documentation** — Referenced for schema validation syntax, plugin registration pattern, and lifecycle hooks (`onReady`, `onClose`).
- **Jest documentation** — Referenced for `inject()` testing pattern (Fastify's built-in alternative to Supertest for integration tests).

## Trade-offs
- **In-memory queue over external queue (SQS/Redis).** Keeps the service to a single `npm run dev` with zero infrastructure. The trade-off is that queued events are lost on crash. In production, SQS would give us durability, retry, and dead-letter queues — but that's infrastructure complexity that doesn't belong in a v1 POC.
- **In-memory Map over SQLite/Redis.** Node's long-running process model supports in-memory state natively. This avoids I/O latency and setup overhead. The cost is no persistence across restarts and no horizontal scaling. In production, Redis would be the natural next step — it gives us shared state across instances, TTL-based expiration for inactive sessions, and pub/sub for real-time viewer count updates.
- **Dedup set grows unbounded.** The `processedEventIds` Set and the `sessions` Map never evict entries. For a 2-hour POC this is fine. In production, we'd add TTL-based eviction (e.g., remove dedup entries after 5 minutes, archive ended sessions after 1 hour).
- **100ms drain interval over immediate processing.** Batching gives us a natural backpressure mechanism — if events arrive faster than we process, they queue up rather than overwhelming the processor. The 100ms interval means viewer counts lag by at most ~100ms, well within the 10-15 second target.
- **Storing full event history on each session.** Convenient for the session details endpoint and debugging, but memory-expensive at scale. In production, events would go to a time-series store (e.g., ClickHouse, TimescaleDB) and the session would only hold computed state.

## What We Are NOT Building
- No authentication
- No database or ORM
- No external queue (SQS, Redis, etc.)
- No horizontal scaling / distributed state
- No WebSockets or SSE (viewer count is polled, not pushed)
- No event replay or persistence across restarts

## API Endpoints

### POST /events
Accepts a player SDK event. Returns 202 immediately (async processing).

### GET /events/:sportingEventId/viewers
Returns current active session count for a sporting event.
```json
{ "eventId": "event-2026-wrestling-finals", "activeViewers": 42 }
```

### GET /sessions/:sessionId
Returns full session details.
```json
{
  "sessionId": "abc-123",
  "userId": "user-456",
  "sportingEventId": "event-2026-wrestling-finals",
  "startedAt": "2026-02-10T19:30:00.000Z",
  "lastEventAt": "2026-02-10T19:32:15.123Z",
  "duration": 135,
  "currentState": "active",
  "isActive": true,
  "events": [...]
}
```

## Testing Strategy
- **Session lifecycle** — core domain logic (start, heartbeat, pause, end)
- **Active session definition** — sessions expire after 60s of inactivity
- **Viewer count accuracy** — only active sessions counted per sporting event
- **Queue async behavior** — 202 returned immediately, state updated after drain
- **Load/burst test** — fire N concurrent events, verify none dropped

## Commands
```bash
npm run dev       # start dev server
npm run build     # compile TypeScript
npm start         # start production build
npm test          # run all tests
```