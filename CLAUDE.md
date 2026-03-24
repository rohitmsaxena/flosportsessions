# CLAUDE.md

## IMPORTANT NOTES
- Add comments to each function, class, or api endpoint describing what it does.

## Stack
TypeScript + Fastify + Jest + Supertest. No database, no external services.

## Structure
src/events/ — routes, queue, processor, schema
src/sessions/ — routes, store, types
tests/ — events, sessions, load

## Key Types
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

## Commands
npm run dev / npm test / npm run build

## Do NOT build
- Auth, database, external queue, websockets