-- Migration: 001_initial_schema
-- Phase 0 (P0-6): Full initial schema for Autonomous Agent Runtime
-- All tables required by Phases 1-9 are defined here.
-- node-pg-migrate: up
--
-- IDEMPOTENCY NOTE (added — fixes CI/local "relation already exists" failures):
-- 000_full_schema.sql is a squash script that already creates every type/table
-- in this file (guarded with IF NOT EXISTS / DO $$ EXCEPTION). node-pg-migrate
-- runs every file in this directory in filename order on a fresh database, so
-- 000 runs first and 001 runs immediately after against the same DB. Every
-- statement below is now guarded the same way 000 already is, so re-running
-- this file against a DB that already has these objects (from 000) is a safe
-- no-op instead of an error. This does NOT change behavior on environments
-- (e.g. Railway prod) where 001 already ran previously and is recorded in
-- node-pg-migrate's tracking table — those are untouched.

-- ── Extensions ──────────────────────────────────────────────────────────────
-- pgvector deferred to v2; reserved here so the extension slot is claimed
-- CREATE EXTENSION IF NOT EXISTS vector;

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE agent_run_status AS ENUM ('running', 'succeeded', 'failed', 'retrying');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_job_status AS ENUM ('queued', 'running', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE memory_record_scope AS ENUM ('project', 'domain_shared');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE action_proposal_status AS ENUM ('pending', 'auto_approved', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'product_owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── projects ─────────────────────────────────────────────────────────────────
-- Mirrors the frontend Project type; created here as the authoritative source.
CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    industry        TEXT,
    team_size       TEXT,
    methodology     TEXT,
    active_admin_id UUID,                   -- FK to team_members, nullable, set later
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── team_members ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    name        TEXT NOT NULL,
    role        user_role NOT NULL DEFAULT 'product_owner',
    is_admin    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, email)
);

-- Back-fill FK now that team_members exists
DO $$ BEGIN
  ALTER TABLE projects
    ADD CONSTRAINT fk_projects_active_admin
    FOREIGN KEY (active_admin_id) REFERENCES team_members(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── agent_runs ────────────────────────────────────────────────────────────────
-- Persisted result of every agent pipeline execution.
-- Phase 1 adds: goal, plan_steps, tool_trace, decisions, memory_reads
CREATE TABLE IF NOT EXISTS agent_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_key       TEXT NOT NULL,          -- e.g. 'manager', 'logAnalysis'
    status          agent_run_status NOT NULL DEFAULT 'running',

    -- Phase 1: Agent Runtime Instrumentation fields
    goal            TEXT,                   -- Natural-language goal string
    plan_steps      JSONB,                  -- Ordered array of step name strings
    tool_trace      JSONB,                  -- Append-only array of LLM/tool call records
    decisions       JSONB,                  -- Array of {type, rationale, confidence, timestamp}
    memory_reads    JSONB,                  -- Array of memory_record IDs accessed

    -- Execution metadata
    provider        TEXT,                   -- 'openai' | 'claude'
    model           TEXT,                   -- e.g. 'gpt-4o', 'claude-sonnet-4-6'
    input_payload   JSONB,
    result          TEXT,
    error           TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_project_id ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_key ON agent_runs(agent_key);

-- ── agent_jobs ────────────────────────────────────────────────────────────────
-- Durable job queue for backend worker execution (Phase 3).
-- SELECT FOR UPDATE SKIP LOCKED used by worker to claim jobs atomically.
CREATE TABLE IF NOT EXISTS agent_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_key           TEXT NOT NULL,
    status              agent_job_status NOT NULL DEFAULT 'queued',
    input_payload       JSONB NOT NULL DEFAULT '{}',
    result              TEXT,
    error               TEXT,
    attempts            INTEGER NOT NULL DEFAULT 0,
    next_attempt_after  TIMESTAMPTZ,        -- Phase 3 retry: skip until this timestamp
    agent_run_id        UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_project_id ON agent_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(status);
-- Partial index for worker queue query: only queued jobs.
-- NOW()/CURRENT_TIMESTAMP cannot appear in an index predicate (Postgres
-- requires predicates to be IMMUTABLE — "functions in index predicate must
-- be marked IMMUTABLE"), so the next_attempt_after <= NOW() part of the
-- worker's query is just a normal runtime filter, not part of the index
-- predicate. 000_full_schema.sql already has this fixed; this file had
-- drifted from it until now.
CREATE INDEX IF NOT EXISTS idx_agent_jobs_queue ON agent_jobs(created_at)
    WHERE status = 'queued';

-- ── memory_records ───────────────────────────────────────────────────────────
-- Project-isolated and domain-shared memory (Phase 2).
-- Retrieval MUST always filter by project_id + (project_id match OR (domain_id + approved=true)).
CREATE TABLE IF NOT EXISTS memory_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope           memory_record_scope NOT NULL DEFAULT 'project',
    domain_id       TEXT,                   -- Required when scope='domain_shared'
    approved        BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by     UUID REFERENCES team_members(id) ON DELETE SET NULL,
    approved_at     TIMESTAMPTZ,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    tags            TEXT[] NOT NULL DEFAULT '{}',
    -- Phase 2 v2: embedding vector (pgvector, deferred)
    -- embedding    vector(1536),
    created_by      UUID REFERENCES team_members(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT domain_shared_requires_domain_id
        CHECK (scope != 'domain_shared' OR domain_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_memory_records_project_id ON memory_records(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_records_domain_id ON memory_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_memory_records_approved ON memory_records(approved);
CREATE INDEX IF NOT EXISTS idx_memory_records_tags ON memory_records USING GIN(tags);

-- ── action_proposals ─────────────────────────────────────────────────────────
-- Policy-bounded action proposals emitted by agents (Phase 4).
-- v1 action_type values: generate_document | tag_memory_record | flag_for_review
CREATE TABLE IF NOT EXISTS action_proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_run_id    UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    action_type     TEXT NOT NULL,          -- Constrained to v1 taxonomy (enforced in app layer)
    risk_level      risk_level NOT NULL DEFAULT 'low',
    payload         JSONB NOT NULL DEFAULT '{}',
    status          action_proposal_status NOT NULL DEFAULT 'pending',
    decided_by      UUID REFERENCES team_members(id) ON DELETE SET NULL,
    decided_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_proposals_project_id ON action_proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_action_proposals_agent_run_id ON action_proposals(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_action_proposals_status ON action_proposals(status);

-- ── rollback_log ─────────────────────────────────────────────────────────────
-- Snapshot recorded before every auto-approved generate_document proposal (Phase 4).
CREATE TABLE IF NOT EXISTS rollback_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id     UUID NOT NULL REFERENCES action_proposals(id) ON DELETE CASCADE,
    snapshot        JSONB NOT NULL,         -- {agent_key, output_preview: first 1000 chars}
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rollback_log_proposal_id ON rollback_log(proposal_id);

-- ── updated_at trigger (reusable) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_memory_records_updated_at
    BEFORE UPDATE ON memory_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
