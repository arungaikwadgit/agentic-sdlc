-- =============================================================================
-- Migration 023: Correlation IDs -- a shared request-tracing column added
--                 across every table in the autonomous-execution/governance
--                 path, so one request can be traced end-to-end across
--                 agent_jobs, agent_runs, chat_messages, governance_decision,
--                 lifecycle_events, policy_decisions, and
--                 tool_call_audit_log. Reconstructed retroactively,
--                 2026-08-22 (see 010's header for why).
--
-- Apply directly with psql (see docs/DEVELOPMENT.md):
--   psql "$POSTGRES_URL_PRODUCTION" -f backend/migrations/023_correlation_ids.sql
--
-- This is the one migration in this reconstructed batch with its own real
-- run_on timestamp in pgmigrations (2026-07-25, a day after 006-022's
-- shared batch timestamp), confirming it shipped as a deliberate, separate
-- follow-up rather than part of that batch.
--
-- Reconstructed from live production schema -- see 016's header for method.
-- All seven columns and their indexes confirmed directly via
-- information_schema.columns / pg_indexes on project fmlhkrkukqqilcjcwwpq.
-- =============================================================================

ALTER TABLE agent_jobs          ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE agent_runs          ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE chat_messages       ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE governance_decision ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE lifecycle_events    ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE policy_decisions    ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE tool_call_audit_log ADD COLUMN IF NOT EXISTS correlation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_jobs_correlation_id
  ON agent_jobs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_correlation_id
  ON agent_runs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_correlation_id
  ON chat_messages(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_governance_decision_correlation_id
  ON governance_decision(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_correlation_id
  ON lifecycle_events(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_policy_decisions_correlation_id
  ON policy_decisions(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tool_call_audit_log_correlation_id
  ON tool_call_audit_log(correlation_id) WHERE correlation_id IS NOT NULL;
