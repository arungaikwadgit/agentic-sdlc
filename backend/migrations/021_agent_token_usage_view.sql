-- =============================================================================
-- Migration 021: Agent token usage views -- reconstructed retroactively,
--                 2026-08-22 (see 010's header for why).
--
-- Apply directly with psql (see docs/DEVELOPMENT.md):
--   psql "$POSTGRES_URL_PRODUCTION" -f backend/migrations/021_agent_token_usage_view.sql
--
-- Reconstructed from the live view definitions (pg_views) on project
-- fmlhkrkukqqilcjcwwpq, WITH one deliberate difference from what production
-- originally ran: `security_invoker = true` is included here. The original
-- 2026-07-24 deploy created both views SECURITY DEFINER (Supabase's
-- default), which the advisor flagged ERROR (security_definer_view) --
-- fixed live via this same Wave 1 pass, same session, 2026-08-22 (see
-- docs/architecture/step4-specs-wave1-draft.md item 5). This file
-- intentionally captures the CURRENT, fixed end-state rather than
-- reproducing the bug, per this reconstruction's stated goal of matching
-- live state -- reproducing a since-fixed vulnerability here would just
-- reintroduce it on the next fresh environment built from these files.
-- =============================================================================

CREATE OR REPLACE VIEW agent_token_usage
  WITH (security_invoker = true) AS
SELECT
  p.id AS project_id,
  p.name AS project_name,
  agent_run.key AS agent_key,
  (agent_run.value ->> 'model') AS model,
  (agent_run.value ->> 'provider') AS provider,
  (agent_run.value ->> 'status') AS status,
  COALESCE(((agent_run.value ->> 'tokensUsed'))::bigint, 0) AS tokens_used,
  CASE
    WHEN (agent_run.value ->> 'startedAt') ~ '^[0-9]+$'
      THEN to_timestamp((((agent_run.value ->> 'startedAt'))::bigint)::numeric / 1000.0)
    ELSE NULL
  END AS started_at,
  CASE
    WHEN (agent_run.value ->> 'completedAt') ~ '^[0-9]+$'
      THEN to_timestamp((((agent_run.value ->> 'completedAt'))::bigint)::numeric / 1000.0)
    ELSE NULL
  END AS completed_at
FROM projects p
CROSS JOIN LATERAL jsonb_each(COALESCE(p.data -> 'agentRuns', '{}'::jsonb)) AS agent_run(key, value)
WHERE agent_run.value ? 'tokensUsed';

CREATE OR REPLACE VIEW agent_token_usage_summary
  WITH (security_invoker = true) AS
SELECT
  project_id,
  project_name,
  agent_key,
  model,
  provider,
  count(*) AS run_count,
  sum(tokens_used) AS total_tokens,
  round(avg(tokens_used), 2) AS avg_tokens_per_run,
  min(started_at) AS first_run_at,
  max(completed_at) AS last_run_at
FROM agent_token_usage
GROUP BY project_id, project_name, agent_key, model, provider;
