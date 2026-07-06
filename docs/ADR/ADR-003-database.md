# ADR-003: Database — PostgreSQL 15 (via Docker for local dev, Supabase for production)

**Status:** ACCEPTED  
**Date:** 2026-06-15  
**Deciders:** Arun Gaikwad

---

## Context

The agent runtime requires persistent storage for: agent runs, agent jobs (durable queue), memory records, action proposals, rollback logs, invite membership, invite sessions, app configuration, and master catalogs. The DB must support JSONB columns (for tool_trace, plan_steps, decisions arrays), SELECT FOR UPDATE SKIP LOCKED (for the worker queue), and future pgvector extension (for embedding-based memory retrieval in v2).

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
- Collaboration/auth tables include `team_members` and `invite_sessions` for project-scoped access control
- App-state tables include `app_config`, `app_integrations`, and `admin_backlog_items`
- Master catalog tables include `master_phases`, `master_review_gates`, `master_agents`, `master_phase_agents`, `master_domains`, `master_role_templates`, and `master_role_template_agents`
- pgvector extension deferred to v2; column type for embeddings reserved as `vector(1536)` placeholder
- Supabase chosen as production host (aligns with ADR-008 auth decision)

### Amendment — 2026-07-05: closing tracked/untracked schema drift on `projects`

Production's `projects` table had accumulated four columns (`owner_id`, `data`
JSONB, `domain`, `status`) that were never added through a node-pg-migrate
file — likely applied by hand at some point directly against Supabase. A
freshly-created database (CI's ephemeral test DB, a new contributor's local
Postgres) never had them, which silently broke anything that depended on
`projects.data` (e.g. `dbSyncAcceptedMemberInProjectData()` in
`backend/src/proxy.js`) outside of production.

`backend/migrations/005_secure_invite_links.sql` formally tracks these four
columns with `ADD COLUMN IF NOT EXISTS` — a no-op on production, a real fix
everywhere else. Going forward, **any manual/ad-hoc schema change made
directly against Supabase must be back-filled into a node-pg-migrate file**
in the same PR, or this class of drift recurs. See also the ADR-002
amendment on migration idempotency, which this same incident also exposed.
t also exposed.
