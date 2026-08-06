# ADR-001: Backend Framework — Express 4.x + TypeScript

**Status:** ACCEPTED  
**Date:** 2026-06-15  
**Deciders:** Arun Gaikwad

---

## Context

The agentic-sdlc project currently has a plain JavaScript Express proxy (`backend/src/proxy.js`) that forwards LLM requests. The Autonomous Agent Runtime initiative requires a full backend application with: persistent DB access, repository layer, worker process, REST API routes, RBAC middleware, and shared types with the frontend. A framework decision must be committed before any backend build tasks begin.

## Decision

**CHOSEN: Express 4.x + TypeScript**

All new backend code is written in TypeScript. The existing `proxy.js` is migrated to `src/index.ts` as part of P0-4. No other framework is introduced.

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| Fastify | Marginal perf gain not worth migration cost; less ecosystem familiarity |
| NestJS | Over-engineered for this scope; decorators add complexity without benefit |
| Plain JS (keep as-is) | No type safety; can't share types with the TS frontend |
| Hono | Too new; less ecosystem maturity for middleware/auth patterns needed |

## Consequences

- `backend/tsconfig.json` required (added in P0-4)
- `ts-node-dev` for development hot reload
- All new files under `backend/src/` use `.ts` extension
- `tsc --noEmit` runs in CI as a gate
- Frontend and backend can share types via the `shared-types` package (ADR-004)
