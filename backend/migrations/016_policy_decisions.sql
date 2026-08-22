-- =============================================================================
-- Migration 016: Policy decisions -- the governance gate every agent/tool
--                 action gets checked against before it's allowed to run.
--                 Reconstructed retroactively, 2026-08-22 (see 010's header
--                 for why this and eight siblings needed reconstruction).
--
-- Apply directly with psql (see docs/DEVELOPMENT.md):
--   psql "$POSTGRES_URL_PRODUCTION" -f backend/migrations/016_policy_decisions.sql
--
-- Reconstructed from live production schema (information_schema.columns,
-- pg_indexes, pg_type/pg_enum on project fmlhkrkukqqilcjcwwpq), matching the
-- current end-state exactly rather than guessing at original intent --
-- per this program's Step 4 spec for this item ("match live end-state via
-- list_tables/information_schema, not historical archaeology").
-- Columns added by later migrations (correlation_id: 023; consumed_at/
-- consumption_key: 019) are NOT included here -- they belong in their own
-- files so `pgmigrations` history stays honest about when each was added.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE policy_risk_tier AS ENUM ('low', 'moderate', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE policy_decision_outcome AS ENUM ('allow', 'constrain', 'approval_required', 'deny');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS policy_decisions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
  actor_email  TEXT,
  actor_role   TEXT,
  actor_kind   TEXT NOT NULL DEFAULT 'user',
  agent_id     TEXT,
  action       TEXT NOT NULL,
  route        TEXT,
  risk_tier    policy_risk_tier NOT NULL DEFAULT 'low',
  decision     policy_decision_outcome NOT NULL,
  reasons      JSONB NOT NULL DEFAULT '[]',
  constraints  JSONB NOT NULL DEFAULT '[]',
  input_hash   TEXT,
  expires_at   TIMESTAMPTZ,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_project_created
  ON policy_decisions(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_actor_created
  ON policy_decisions(actor_email, created_at DESC)
  WHERE actor_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_policy_decisions_agent_created
  ON policy_decisions(agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_policy_decisions_action_created
  ON policy_decisions(action, created_at DESC);

-- Service-role-only table (same rationale as migration 006 section 4): no
-- frontend or backend code queries this via the anon/authenticated key, both
-- backend services use their service-role connection. RLS enabled with no
-- policy makes it default-deny for anon/authenticated -- confirmed live via
-- Supabase's advisor (rls_enabled_no_policy, INFO, not a gap).
ALTER TABLE policy_decisions ENABLE ROW LEVEL SECURITY;
