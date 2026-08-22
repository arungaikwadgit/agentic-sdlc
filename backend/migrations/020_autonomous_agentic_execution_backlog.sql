-- =============================================================================
-- Migration 020: Autonomous agentic execution backlog -- wires the policy
--                 gate (016) into every place autonomous execution actually
--                 happens: the job queue, lifecycle events, agent runs, and
--                 chat-triggered actions. Reconstructed retroactively,
--                 2026-08-22 (see 010's header for why).
--
-- Apply directly with psql (see docs/DEVELOPMENT.md):
--   psql "$POSTGRES_URL_PRODUCTION" -f backend/migrations/020_autonomous_agentic_execution_backlog.sql
--
-- Depends on: 016_policy_decisions.sql (every FK below); agent_jobs (001),
-- lifecycle_events (009), agent_runs (001), chat_messages (012) must already
-- exist.
--
-- Reconstructed from live production schema -- see 016's header for method.
-- All four tables carry the identical pattern (policy_decision_id UUID,
-- SET NULL on delete, partial index) confirmed via pg_indexes on each.
-- =============================================================================

ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS policy_decision_id UUID
  REFERENCES policy_decisions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_jobs_policy_decision
  ON agent_jobs(policy_decision_id) WHERE policy_decision_id IS NOT NULL;

ALTER TABLE lifecycle_events ADD COLUMN IF NOT EXISTS policy_decision_id UUID
  REFERENCES policy_decisions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_policy_decision
  ON lifecycle_events(policy_decision_id) WHERE policy_decision_id IS NOT NULL;

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS policy_decision_id UUID
  REFERENCES policy_decisions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_policy_decision
  ON agent_runs(policy_decision_id) WHERE policy_decision_id IS NOT NULL;

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS policy_decision_id UUID
  REFERENCES policy_decisions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_policy_decision
  ON chat_messages(policy_decision_id) WHERE policy_decision_id IS NOT NULL;

-- Backlog-scanning optimization for the job queue itself -- confirmed live
-- (idx_agent_jobs_queue). Grouped here under the "backlog" theme; harmless
-- via IF NOT EXISTS if it actually predates this migration.
CREATE INDEX IF NOT EXISTS idx_agent_jobs_queue
  ON agent_jobs(created_at) WHERE status = 'queued';
