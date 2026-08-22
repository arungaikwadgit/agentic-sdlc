-- Item #18 (Step 6 prioritization matrix), 2026-08-22 -- user feedback
-- capture on agent output. Confirmed absent in Step 1 baseline (Section E):
-- zero mechanism existed to learn from user corrections/ratings on any
-- agent's output.
--
-- Scope decision (explicit user choice, given three options): feedback is
-- keyed to (project_id, agent_id), NOT to a specific agent_runs.id row.
-- Rationale: what's actually rendered to users in ProjectWorkspace.tsx is
-- project.agentRuns[agentId] -- a JSON blob column on the projects table
-- with no stable per-execution id, overwritten wholesale on every rerun
-- (see frontend/src/types/project.types.ts's AgentRun, frontend/src/db/
-- projectRepository.ts's updateAgentRun). The separate Postgres agent_runs
-- table (backend/src/repositories/AgentRunRepository.ts) does have stable
-- row ids, but only L3-mode agent executions write to it -- building
-- against it would mean giving every agent a durable run row first, which
-- is materially more scope than this item's "quick win" billing. Tradeoff
-- accepted: a rerun does not invalidate prior feedback -- it just becomes
-- stale (about a previous version of the output) until the agent is rated
-- again. Append-only (no UNIQUE constraint) so a history of ratings over
-- time is preserved, not just the latest.
CREATE TABLE IF NOT EXISTS agent_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  rating      TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  comment     TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serves both the per-agent aggregate (admin FeedbackTab summary) and any
-- future "latest feedback for this project+agent" lookup.
CREATE INDEX IF NOT EXISTS idx_agent_feedback_project_agent
ON agent_feedback(project_id, agent_id, created_at DESC);

-- Serves the admin FeedbackTab's global recent-feedback list, which is not
-- scoped to one project.
CREATE INDEX IF NOT EXISTS idx_agent_feedback_created_at
ON agent_feedback(created_at DESC);
