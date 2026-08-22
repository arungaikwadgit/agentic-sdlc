-- =============================================================================
-- Migration 017: Memory policy audit -- logs which actor/agent accessed which
--                 memory records, under which policy decision. Reconstructed
--                 retroactively, 2026-08-22 (see 010's header for why).
--
-- Apply directly with psql (see docs/DEVELOPMENT.md):
--   psql "$POSTGRES_URL_PRODUCTION" -f backend/migrations/017_memory_policy_audit.sql
--
-- Depends on: 016_policy_decisions.sql (policy_decision_id FK below).
-- Reconstructed from live production schema -- see 016's header for method.
-- =============================================================================

CREATE TABLE IF NOT EXISTS memory_access_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID REFERENCES projects(id) ON DELETE SET NULL,
  actor_email        TEXT,
  agent_key          TEXT,
  access_type        TEXT NOT NULL,
  policy_decision_id UUID REFERENCES policy_decisions(id) ON DELETE SET NULL,
  memory_record_ids  UUID[] NOT NULL DEFAULT '{}',
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_access_log_project_created
  ON memory_access_log(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_access_log_policy_decision
  ON memory_access_log(policy_decision_id)
  WHERE policy_decision_id IS NOT NULL;

-- Service-role-only table -- same rationale as 016. Confirmed live: RLS
-- enabled, no policy (default-deny for anon/authenticated).
ALTER TABLE memory_access_log ENABLE ROW LEVEL SECURITY;
