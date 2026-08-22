-- =============================================================================
-- Migration 019: Policy decision consumption -- marks a policy_decisions row
--                 as spent once the caller has actually acted on it, and
--                 gives it a stable idempotency key so the same decision
--                 can't be consumed twice. Reconstructed retroactively,
--                 2026-08-22 (see 010's header for why).
--
-- Apply directly with psql (see docs/DEVELOPMENT.md):
--   psql "$POSTGRES_URL_PRODUCTION" -f backend/migrations/019_policy_decision_consumption.sql
--
-- Depends on: 016_policy_decisions.sql.
-- Reconstructed from live production schema -- see 016's header for method.
-- =============================================================================

ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;
ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS consumption_key TEXT;

-- One decision, one consumption -- confirmed live as a UNIQUE index, not
-- just a lookup index, so a second attempt to consume the same key fails
-- at the database rather than relying on the caller to check first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_decisions_consumption_key
  ON policy_decisions(consumption_key)
  WHERE consumption_key IS NOT NULL;

-- Lets a sweep job find decisions that expired before anyone consumed them,
-- without scanning every row.
CREATE INDEX IF NOT EXISTS idx_policy_decisions_unconsumed_expiry
  ON policy_decisions(expires_at)
  WHERE consumed_at IS NULL;
