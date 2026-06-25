# ADR-003: Database — PostgreSQL 15 (via Docker for local dev, Supabase for production)

**Status:** ACCEPTED  
**Date:** 2026-06-15  
**Deciders:** Arun Gaikwad

---

## Context

The agent runtime requires persistent storage for: agent runs, agent jobs (durable queue), memory records, action proposals, and rollback logs. The DB must support JSONB columns (for tool_trace, plan_steps, decisions arrays), SELECT FOR UPDATE SKIP LOCKED (for the worker queue), and future pgvector extension (for embedding-based memory retrieval in v2).

## Decision

**CHOSEN: PostgreSQL 15**

- **Local dev:** `postgres:15` via `docker-compose.yml`
- **Production:** Supabase (managed Postgres 15), chosen in ADR-008 for auth integration
- **No other DB engine** is introduced in any phase

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| SQLite | No SKIP LOCKED support; no pgvector; not production-viable |
| MySQL | No native JSONB; pgvector not available |
| MongoDB | No ACID transactions needed for job queue pattern; schema flexibility not required |
| DynamoDB | Vendor lock-in; no SKIP LOCKED equivalent |

## Consequences

- `docker-compose.yml` exposes Postgres on port 5432
- `POSTGRES_URL` env var format: `postgresql://user:pass@localhost:5432/agentdb`
- JSONB used for: `agent_runs.plan_steps`, `agent_runs.tool_trace`, `agent_runs.decisions`, `agent_runs.memory_reads`
- `SELECT FOR UPDATE SKIP LOCKED` used in `AgentJobRepository.lockNextQueued()` (Phase 3)
- pgvector extension deferred to v2; column type for embeddings reserved as `vector(1536)` placeholder
- Supabase chosen as production host (aligns with ADR-008 auth decision)
