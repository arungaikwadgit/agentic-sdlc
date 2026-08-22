-- =============================================================================
-- Migration 022: Tool call audit log -- one row per integration action taken
--                 (Jira, GitHub, Slack, etc.), independent of any project.
--                 Reconstructed retroactively, 2026-08-22 (see 010's header
--                 for why).
--
-- Apply directly with psql (see docs/DEVELOPMENT.md):
--   psql "$POSTGRES_URL_PRODUCTION" -f backend/migrations/022_tool_call_audit_log.sql
--
-- Reconstructed from live production schema -- see 016's header for method.
-- No project_id / FK on this table (confirmed live: none) -- integration
-- credentials and their audit trail are account-scoped, not project-scoped,
-- per frontend/src/hooks/useIntegrations.ts's own credential model.
-- =============================================================================

CREATE TABLE IF NOT EXISTS tool_call_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor_email TEXT,
  status      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_call_audit_log_integration_created
  ON tool_call_audit_log(integration, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_call_audit_log_actor_created
  ON tool_call_audit_log(actor_email, created_at DESC);

-- Service-role-only table -- same rationale as 016. Confirmed live: RLS
-- enabled, no policy (default-deny for anon/authenticated).
ALTER TABLE tool_call_audit_log ENABLE ROW LEVEL SECURITY;
