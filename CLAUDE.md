# CLAUDE.md

## Stack
TypeScript + Fastify + Jest + Supertest. No database, no external services.

## Structure
src/events/ — routes, queue, processor, schema
src/sessions/ — routes, store, types
tests/ — events, sessions, load

## Key Types
[just the interfaces]

## Commands
npm run dev / npm test / npm run build

## Do NOT build
- Auth, database, external queue, websockets