-- AI Governance MVP-0, 2026-07-20.
-- See docs/architecture/govern-ai-gap-assessment-and-implementation-plan.md
-- for the full design rationale and the 8 finalized behavioral decisions
-- this schema implements (tiered block/flag, global + per-project kill
-- switch, soft domain handling, persistent badge, override authority,
-- backlog de-dup by controlId, Medium+ backlog threshold, badge visible to
-- everyone).
--
-- Cross-service note: `projects` is defined in
-- supabase/migrations/001_initial_schema.sql and owned by the separate
-- server/ service (accessed there via the Supabase client), not by this
-- backend's raw pg pool. Both reach the SAME physical Postgres database --
-- already confirmed working today via agent_prompt_versions.project_id's
-- existing FK (007_prompt_governance.sql), which this backend created and
-- which resolves correctly against that same projects table. secondary
-- domains are added directly onto `projects` as a plain column (matching
-- the shape of the existing `domain` column) rather than a separate join
-- table, since server/'s project CRUD already reads/writes plain columns on
-- this same row and a join table would need its own cross-service wiring
-- for no real benefit at this scale.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS secondary_domains TEXT[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  CREATE TYPE governance_decision_value AS ENUM (
    'approved',
    'approved_with_conditions',
    'human_review_required',
    'blocked',
    'not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE governance_risk_tier AS ENUM ('critical', 'high', 'moderate', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE governance_finding_severity AS ENUM ('critical', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per aiGovernance assessment run (INSERT-only, never updated in
-- place) so the admin Governance tab can show a real decision history --
-- same versioned-record spirit as agent_prompt_versions, just append-only
-- instead of superseded-in-place, since a governance assessment doesn't
-- have an "active" concept the way a prompt version does.
CREATE TABLE IF NOT EXISTS governance_decision (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_run_id    UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  risk_tier       governance_risk_tier NOT NULL,
  decision        governance_decision_value NOT NULL,
  -- Self-reported by the agent's own output, NOT independently computed --
  -- same known limitation flagged as F5 in the gap-assessment doc
  -- (outputGovernance's confidence is decorative for the same reason).
  -- Stored anyway for display/record-keeping, never used to gate anything.
  confidence      NUMERIC(5,2),
  decision_reason TEXT,
  -- Snapshot of findings as of THIS run, for historical/audit replay.
  -- The live, cross-run-de-duplicated state lives in governance_finding
  -- below -- this column is a record of what one specific run produced,
  -- not the thing other features (badge, backlog) read from.
  findings        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_governance_decision_project
ON governance_decision(project_id, created_at DESC);

-- Individual findings, one row per (project, control_id) -- upserted on
-- every governance run rather than recreated, so a finding has a stable
-- identity across re-runs. This is what the badge's "open findings count"
-- and the backlog auto-creation upsert (de-dup by control_id, per the plan
-- doc's decision 6) actually key against.
CREATE TABLE IF NOT EXISTS governance_finding (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  control_id      TEXT NOT NULL,
  severity        governance_finding_severity NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  gap             TEXT,
  recommendation  TEXT,
  owner_role      TEXT,
  -- FK-by-convention, not a real FK: admin_backlog_items.id is a
  -- client-generated TEXT id (see appState.js/dbCreateBacklogItem), not a
  -- UUID column this table could formally reference.
  backlog_item_id TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  UNIQUE (project_id, control_id)
);

CREATE INDEX IF NOT EXISTS idx_governance_finding_project
ON governance_finding(project_id, status);

-- Records every admin/project-owner override of a Blocked decision at
-- gate0. Distinct from governance_decision (agent-authored) -- this is
-- human-authored, append-only, and required whenever an App Admin or
-- Project Owner overrides a Blocked decision (plan doc decision 5).
CREATE TABLE IF NOT EXISTS governance_override (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  governance_decision_id  UUID NOT NULL REFERENCES governance_decision(id) ON DELETE CASCADE,
  actor_email             TEXT NOT NULL,
  -- Which authority path was used -- 'app_admin' | 'project_owner' --
  -- both are permitted per the plan doc, but the audit trail records
  -- which one applied for any later review.
  actor_role              TEXT NOT NULL,
  reason                  TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT governance_override_reason_required CHECK (length(trim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_governance_override_project
ON governance_override(project_id, created_at DESC);

-- Global, platform-wide agent kill switch (admin-only). Absence of a row
-- means "enabled" -- mirrors modelCatalog.ts's enabled-by-default pattern,
-- so most agents never need a row here at all.
CREATE TABLE IF NOT EXISTS agent_global_settings (
  agent_id    TEXT PRIMARY KEY,
  disabled    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-project agent kill switch. A row here, if present, takes precedence
-- over agent_global_settings for that (project, agent) pair. The
-- resolution order (per-project override wins, else fall back to global)
-- is enforced in backend/src/dispatch/agentDispatch.js, not in the
-- database -- this table only stores the raw settings.
CREATE TABLE IF NOT EXISTS project_agent_overrides (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  disabled    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, agent_id)
);

-- Links an agent run to the exact prompt version it executed with --
-- closes the AI-BOM gap (F8 in the gap-assessment doc): today agent_runs
-- captures model/tool_trace/decisions but nothing ties a run back to
-- "which prompt version produced this." Nullable: most existing agent_runs
-- predate this column, and most agents don't have a promptGovernance-
-- managed version at all (only agents with an active row in
-- agent_prompt_versions do).
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS prompt_version_id UUID REFERENCES agent_prompt_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_prompt_version
ON agent_runs(prompt_version_id) WHERE prompt_version_id IS NOT NULL;
