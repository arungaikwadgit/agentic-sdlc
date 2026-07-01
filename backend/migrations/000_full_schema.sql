-- ============================================================================
-- 000_full_schema.sql
-- Complete database schema for the Agentic SDLC Framework.
-- Run this once on a fresh database to create every table, type, index, and
-- trigger.  This is equivalent to running 001_initial_schema + 002_invite_roles
-- in order, but as a single idempotent script you can re-run safely.
--
-- Compatible with: PostgreSQL 14+
-- Run with:  psql $DATABASE_URL -f 000_full_schema.sql
-- ============================================================================

-- ── Extensions ───────────────────────────────────────────────────────────────
-- pgvector is reserved for v2 (embedding-based memory retrieval).
-- CREATE EXTENSION IF NOT EXISTS vector;

-- ── Enums ────────────────────────────────────────────────────────────────────
-- Guard every CREATE TYPE with DO $$ … $$ so re-running on an existing DB
-- does not error out on "type already exists".

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
  -- Legacy role enum kept for backward compatibility; use app_role for RBAC.
  CREATE TYPE user_role AS ENUM ('admin', 'product_owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Fine-grained role-based access control (added in 002_invite_roles).
  CREATE TYPE app_role AS ENUM ('project_owner', 'editor', 'reviewer', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── projects ─────────────────────────────────────────────────────────────────
-- Root aggregate. Every other table references this via project_id.
--
-- Columns:
--   id               UUID PK, auto-generated
--   name             Human-readable project name (required)
--   description      Free-text project description
--   industry         e.g. "FinTech", "Healthcare", "E-Commerce"
--   team_size        e.g. "1-5", "6-20", "21-50", "50+"
--   methodology      e.g. "Agile", "Kanban", "Waterfall"
--   active_admin_id  FK → team_members; the currently active project owner
--   created_at       Auto-set on INSERT
--   updated_at       Auto-updated by trigger on every UPDATE
CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    industry        TEXT,
    team_size       TEXT,
    methodology     TEXT,
    active_admin_id UUID,                   -- back-filled FK after team_members is created
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── team_members ─────────────────────────────────────────────────────────────
-- One row per person invited to (or registered on) a project.
--
-- Columns:
--   id              UUID PK
--   project_id      FK → projects (CASCADE delete)
--   email           Must be unique within a project
--   name            Display name
--   role            Legacy enum (admin | product_owner) — kept for migrations
--   is_admin        Convenience boolean; prefer app_role for access checks
--   app_role        Fine-grained RBAC role (project_owner | editor | reviewer | viewer)
--   invite_status   Current state of the invite lifecycle
--   invite_token    UUID token embedded in the magic-link URL; cleared on accept/revoke
--   invited_at      When the invite was last sent
--   accepted_at     When the invitee clicked "Accept Invitation"
--   created_at      Row creation timestamp
CREATE TABLE IF NOT EXISTS team_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    name            TEXT NOT NULL,
    role            user_role NOT NULL DEFAULT 'product_owner',
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    -- 002_invite_roles additions
    app_role        app_role NOT NULL DEFAULT 'viewer',
    invite_status   invite_status NOT NULL DEFAULT 'pending',
    invite_token    TEXT,
    invited_at      TIMESTAMPTZ DEFAULT NOW(),
    accepted_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, email)
);

-- Unique index on invite_token (sparse — only non-NULL values are indexed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_invite_token
    ON team_members(invite_token)
    WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_invite_status ON team_members(invite_status);
CREATE INDEX IF NOT EXISTS idx_team_members_project_id    ON team_members(project_id);

-- Now that team_members exists, add the FK from projects.active_admin_id.
-- ALTER … ADD CONSTRAINT is a no-op if the constraint already exists in PG 14+
-- when we use the DO $$ exception guard.
DO $$ BEGIN
  ALTER TABLE projects
    ADD CONSTRAINT fk_projects_active_admin
    FOREIGN KEY (active_admin_id) REFERENCES team_members(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── agent_runs ────────────────────────────────────────────────────────────────
-- Persisted result of every agent pipeline execution.
-- Consumed by: /api/agents/:projectId/runs (GET), /api/agents/run (POST).
--
-- Columns:
--   id              UUID PK
--   project_id      FK → projects (CASCADE delete)
--   agent_key       Identifies the agent: 'manager' | 'logAnalysis' | 'dataModel' | etc.
--   status          Lifecycle state (running → succeeded | failed | retrying)
--   goal            Natural-language goal string set by the agent on startup
--   plan_steps      Ordered JSON array of step-name strings
--   tool_trace      Append-only JSON array of LLM / tool-call records
--   decisions       JSON array of {type, rationale, confidence, timestamp}
--   memory_reads    JSON array of memory_record UUIDs accessed during the run
--   provider        LLM provider: 'openai' | 'claude'
--   model           Model string e.g. 'gpt-4o', 'claude-sonnet-4-6'
--   input_payload   Full request body sent to the agent (JSON)
--   result          Final text output produced by the agent
--   error           Error message if status = 'failed'
--   created_at      When the run was requested
--   started_at      When the first LLM call was made
--   completed_at    When the run reached a terminal status
CREATE TABLE IF NOT EXISTS agent_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_key       TEXT NOT NULL,
    status          agent_run_status NOT NULL DEFAULT 'running',
    goal            TEXT,
    plan_steps      JSONB,
    tool_trace      JSONB,
    decisions       JSONB,
    memory_reads    JSONB,
    provider        TEXT,
    model           TEXT,
    input_payload   JSONB,
    result          TEXT,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_project_id ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status     ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_key  ON agent_runs(agent_key);
-- Composite index for the common query: latest runs for a project
CREATE INDEX IF NOT EXISTS idx_agent_runs_project_created
    ON agent_runs(project_id, created_at DESC);


-- ── agent_jobs ────────────────────────────────────────────────────────────────
-- Durable job queue consumed by the background worker (Phase 3).
-- The worker uses SELECT FOR UPDATE SKIP LOCKED to claim jobs atomically.
--
-- Columns:
--   id                  UUID PK
--   project_id          FK → projects (CASCADE delete)
--   agent_key           Which agent to run
--   status              Job lifecycle (queued → running → succeeded | failed)
--   input_payload       JSON payload forwarded to the agent
--   result              Agent output text (set on success)
--   error               Error detail (set on failure)
--   attempts            Retry counter; incremented by worker on each attempt
--   next_attempt_after  Backoff timestamp; worker skips job until this passes
--   agent_run_id        FK → agent_runs; set when the job creates a run record
--   created_at          When the job was enqueued
--   started_at          When the worker last claimed it
--   completed_at        When it reached a terminal status
CREATE TABLE IF NOT EXISTS agent_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_key           TEXT NOT NULL,
    status              agent_job_status NOT NULL DEFAULT 'queued',
    input_payload       JSONB NOT NULL DEFAULT '{}',
    result              TEXT,
    error               TEXT,
    attempts            INTEGER NOT NULL DEFAULT 0,
    next_attempt_after  TIMESTAMPTZ,
    agent_run_id        UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_project_id ON agent_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_status     ON agent_jobs(status);
-- Partial index used by the worker's queue query (only queued, ready-to-run jobs).
CREATE INDEX IF NOT EXISTS idx_agent_jobs_queue ON agent_jobs(created_at)
    WHERE status = 'queued';


-- ── memory_records ────────────────────────────────────────────────────────────
-- Project-scoped or domain-shared memory entries (Phase 2).
-- All retrieval MUST filter by project_id + scope rules to prevent data leakage.
--
-- Columns:
--   id          UUID PK
--   project_id  FK → projects (CASCADE delete)
--   scope       'project' (private) | 'domain_shared' (approved cross-project)
--   domain_id   Required when scope = 'domain_shared' (e.g. "fintech-v1")
--   approved    Whether a project admin has approved sharing this record
--   approved_by FK → team_members; who approved it
--   approved_at When it was approved
--   title       Short title displayed in the memory panel
--   content     Full text content of the memory record
--   tags        Free-form tags for filtering (GIN-indexed array)
--   created_by  FK → team_members; who created it
--   created_at  Row creation timestamp
--   updated_at  Auto-updated by trigger on every UPDATE
CREATE TABLE IF NOT EXISTS memory_records (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope       memory_record_scope NOT NULL DEFAULT 'project',
    domain_id   TEXT,
    approved    BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by UUID REFERENCES team_members(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    tags        TEXT[] NOT NULL DEFAULT '{}',
    created_by  UUID REFERENCES team_members(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT domain_shared_requires_domain_id
        CHECK (scope != 'domain_shared' OR domain_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_memory_records_project_id ON memory_records(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_records_domain_id  ON memory_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_memory_records_approved   ON memory_records(approved);
-- GIN index for efficient tag filtering (ANY(tags) or @> queries).
CREATE INDEX IF NOT EXISTS idx_memory_records_tags ON memory_records USING GIN(tags);


-- ── action_proposals ─────────────────────────────────────────────────────────
-- Policy-bounded action proposals emitted by agents (Phase 4).
-- v1 action_type values: generate_document | tag_memory_record | flag_for_review
--
-- Columns:
--   id              UUID PK
--   project_id      FK → projects (CASCADE delete)
--   agent_run_id    FK → agent_runs (CASCADE delete)
--   action_type     What the agent wants to do (app-layer enum, not DB enum)
--   risk_level      'low' | 'medium' | 'high'
--   payload         Action-specific JSON payload
--   status          'pending' → 'auto_approved' | 'approved' | 'rejected'
--   decided_by      FK → team_members; who approved/rejected (NULL if auto)
--   decided_at      When the decision was made
--   created_at      When the proposal was emitted
CREATE TABLE IF NOT EXISTS action_proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_run_id    UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    action_type     TEXT NOT NULL,
    risk_level      risk_level NOT NULL DEFAULT 'low',
    payload         JSONB NOT NULL DEFAULT '{}',
    status          action_proposal_status NOT NULL DEFAULT 'pending',
    decided_by      UUID REFERENCES team_members(id) ON DELETE SET NULL,
    decided_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_proposals_project_id   ON action_proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_action_proposals_agent_run_id ON action_proposals(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_action_proposals_status       ON action_proposals(status);


-- ── rollback_log ──────────────────────────────────────────────────────────────
-- Snapshot of agent output recorded BEFORE every auto-approved
-- generate_document proposal is applied (Phase 4).
-- Allows reverting an automated change if it produced undesirable output.
--
-- Columns:
--   id          UUID PK
--   proposal_id FK → action_proposals (CASCADE delete)
--   snapshot    {agent_key, output_preview: first 1000 chars of previous output}
--   created_at  Row creation timestamp
CREATE TABLE IF NOT EXISTS rollback_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES action_proposals(id) ON DELETE CASCADE,
    snapshot    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rollback_log_proposal_id ON rollback_log(proposal_id);


-- ── invite_log ────────────────────────────────────────────────────────────────
-- Immutable audit trail of every invite action.
-- Kept even after the invite_token is cleared from team_members, so admins
-- can see the full history of who was invited, when, and by whom.
--
-- Columns:
--   id              UUID PK
--   project_id      FK → projects (CASCADE delete)
--   team_member_id  FK → team_members (CASCADE delete)
--   action          'sent' | 'resent' | 'revoked' | 'accepted'
--   performed_by    Email address of the admin who triggered the action
--   created_at      When the action occurred
CREATE TABLE IF NOT EXISTS invite_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_member_id  UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    performed_by    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_log_project_id     ON invite_log(project_id);
CREATE INDEX IF NOT EXISTS idx_invite_log_team_member_id ON invite_log(team_member_id);


-- ── Triggers ─────────────────────────────────────────────────────────────────
-- Shared trigger function — automatically updates the updated_at column on
-- any table that has one.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- projects.updated_at
DO $$ BEGIN
  CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- memory_records.updated_at
DO $$ BEGIN
  CREATE TRIGGER trg_memory_records_updated_at
    BEFORE UPDATE ON memory_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── End of schema ─────────────────────────────────────────────────────────────
-- Run backend/seeds/seed_mock_data.psql through the sample-data seeder if you
-- want demo records after the schema is in place.
