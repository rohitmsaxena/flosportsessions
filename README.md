# REDME.md — Watch Session Tracker (FloSports Take-Home)

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