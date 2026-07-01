# ADR-002: Database Migration Tooling — node-pg-migrate

**Status:** ACCEPTED  
**Date:** 2026-06-15  
**Deciders:** Arun Gaikwad

---

## Context

The initiative requires a Postgres schema with 6+ tables (agent_runs, agent_jobs, memory_records, action_proposals, rollback_log, projects, team_members). Migration tooling must be chosen before any `.sql` files are written, to avoid divergent approaches.

## Decision

**CHOSEN: node-pg-migrate**

Migrations are SQL-first `.sql` files under `backend/migrations/`. The runner is `node-pg-migrate` invoked via npm scripts: `migrate:up` and `migrate:down`.
Sample/demo seed files are not part of that migration chain; they live under `backend/seeds/` and are executed separately.

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| Prisma | ORM lock-in; schema.prisma diverges from raw SQL we need for pgvector later; generates its own migration files in a non-portable format |
| Knex | JS-based schema builder obscures actual SQL; harder to audit |
| Flyway | Java runtime dependency; overkill for a Node project |
| Raw psql scripts | No versioning, no up/down, no CI integration |

## Consequences

- `backend/migrations/` directory holds numbered SQL files (`001_initial_schema.sql`, etc.)
- `DATABASE_URL` env var required for migration runner
- `npm run migrate:up` and `npm run migrate:down` added to `backend/package.json`
- `npm run migrate:up:test` runs against `DATABASE_URL_TEST` in CI
- No ORM — all DB access is via raw `pg` queries in repository classes
