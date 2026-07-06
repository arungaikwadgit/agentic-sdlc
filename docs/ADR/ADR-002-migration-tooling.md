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
- `npm run migrate:up:test` runs against `POSTGRES_URL_TEST` in CI
- No ORM — all DB access is via raw `pg` queries in repository classes

### Amendment — 2026-07-05: migration files must be idempotent, not just ordered

`000_full_schema.sql` was added later as a single-file "squash" for fresh
databases, documented as equivalent to running `001_initial_schema.sql` +
`002_invite_roles.sql` in order — but `001`/`002` were never removed from
`backend/migrations/`, and node-pg-migrate runs every file in the directory
in filename order regardless of what any file's comment claims. On a
database that had never run any migration before (CI's ephemeral test DB, a
new contributor's local Postgres), this meant `000` created every
table/type, and `001`/`002` immediately failed re-creating the same objects
without `IF NOT EXISTS`/guard clauses — this was the root cause of a
GitHub Actions CI failure and a local Postgres setup failure (2026-07-05).

**Consequence going forward:** every migration file must be safe to re-run
against a database that may already have some or all of its objects —
`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF
NOT EXISTS`, and `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END
$$;` around `CREATE TYPE`/`ADD CONSTRAINT`/`CREATE TRIGGER` — the same
pattern `000_full_schema.sql` and `003_rls_policies.sql` already used. This
was retrofitted into `001_initial_schema.sql` and `002_invite_roles.sql`;
any new migration file should follow this pattern from the start rather than
assuming it only ever runs once, in sequence, against a database that
already has the exact prior migrations applied.
