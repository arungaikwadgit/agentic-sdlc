-- =============================================================================
-- Migration 003: Row Level Security (RLS) policies
-- H-NEW-04 fix: the service role key bypasses RLS, but enabling policies here
-- provides a defence-in-depth layer that protects against Express middleware
-- bugs and any future anon/service-role key misuse.
--
-- IMPORTANT: This migration enables RLS on all tables and defines baseline
-- policies. It is a NO-OP when executed via the service role key (which bypasses
-- RLS by design), but policies are enforced for any anon/authenticated queries
-- made directly against the Supabase Data API or via the anon key.
--
-- Apply with:
--   node-pg-migrate up   (reads POSTGRES_URL from env)
-- Or in Railway terminal:
--   npx node-pg-migrate up --migrations-dir migrations --database-url-var POSTGRES_URL
-- =============================================================================

-- ── Enable RLS on all tables ─────────────────────────────────────────────────
ALTER TABLE projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rollback_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_log      ENABLE ROW LEVEL SECURITY;


-- ── projects ─────────────────────────────────────────────────────────────────
-- A user can read/write a project if they appear in team_members for that project.
-- project_owner and admin roles can update/delete; others are read-only via RLS.

DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects
  FOR SELECT
  USING (
    id IN (
      SELECT project_id FROM team_members
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS projects_update ON projects;
CREATE POLICY projects_update ON projects
  FOR UPDATE
  USING (
    id IN (
      SELECT project_id FROM team_members
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND app_role IN ('project_owner', 'editor')
        AND invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS projects_delete ON projects;
CREATE POLICY projects_delete ON projects
  FOR DELETE
  USING (
    id IN (
      SELECT project_id FROM team_members
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND app_role = 'project_owner'
        AND invite_status = 'accepted'
    )
  );

-- Insert: any authenticated user can create a project (they become the owner
-- via a subsequent team_members insert in the application layer).
DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects
  FOR INSERT
  WITH CHECK (true);


-- ── team_members ─────────────────────────────────────────────────────────────
-- Members can view other members on the same project.
-- Only project_owner can insert/update/delete members.

DROP POLICY IF EXISTS team_members_select ON team_members;
CREATE POLICY team_members_select ON team_members
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM team_members tm2
      WHERE tm2.email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND tm2.invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS team_members_insert ON team_members;
CREATE POLICY team_members_insert ON team_members
  FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM team_members tm2
      WHERE tm2.email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND tm2.app_role = 'project_owner'
        AND tm2.invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS team_members_update ON team_members;
CREATE POLICY team_members_update ON team_members
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM team_members tm2
      WHERE tm2.email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND tm2.app_role = 'project_owner'
        AND tm2.invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS team_members_delete ON team_members;
CREATE POLICY team_members_delete ON team_members
  FOR DELETE
  USING (
    project_id IN (
      SELECT project_id FROM team_members tm2
      WHERE tm2.email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND tm2.app_role = 'project_owner'
        AND tm2.invite_status = 'accepted'
    )
  );


-- ── agent_runs, agent_jobs, memory_records, action_proposals, rollback_log,
--    invite_log — all share the same pattern: readable/writable only to
--    members of the project they belong to. ────────────────────────────────────

-- Helper: check project membership (used in each policy below)
-- Note: Postgres doesn't support parameterised policy functions cleanly, so
-- we inline the sub-select. A dedicated is_project_member() function would be
-- cleaner but requires SECURITY DEFINER which has its own risks.

-- agent_runs
DROP POLICY IF EXISTS agent_runs_all ON agent_runs;
CREATE POLICY agent_runs_all ON agent_runs
  FOR ALL
  USING (
    project_id IN (
      SELECT project_id FROM team_members
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND invite_status = 'accepted'
    )
  );

-- agent_jobs
DROP POLICY IF EXISTS agent_jobs_all ON agent_jobs;
CREATE POLICY agent_jobs_all ON agent_jobs
  FOR ALL
  USING (
    project_id IN (
      SELECT project_id FROM team_members
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND invite_status = 'accepted'
    )
  );

-- memory_records
DROP POLICY IF EXISTS memory_records_all ON memory_records;
CREATE POLICY memory_records_all ON memory_records
  FOR ALL
  USING (
    project_id IN (
      SELECT project_id FROM team_members
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND invite_status = 'accepted'
    )
  );

-- action_proposals
DROP POLICY IF EXISTS action_proposals_all ON action_proposals;
CREATE POLICY action_proposals_all ON action_proposals
  FOR ALL
  USING (
    project_id IN (
      SELECT project_id FROM team_members
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND invite_status = 'accepted'
    )
  );

-- rollback_log
-- NOTE: rollback_log has no project_id column of its own (see
-- 000_full_schema.sql) -- it only relates to a project indirectly via
-- proposal_id -> action_proposals.project_id. The naive copy of the other
-- tables' pattern here used to reference a nonexistent rollback_log.project_id
-- column directly, which made this policy (and every migration after it,
-- including 004_master_data_catalog.sql) fail with
-- "error: column \"project_id\" does not exist".
DROP POLICY IF EXISTS rollback_log_all ON rollback_log;
CREATE POLICY rollback_log_all ON rollback_log
  FOR ALL
  USING (
    proposal_id IN (
      SELECT id FROM action_proposals
      WHERE project_id IN (
        SELECT project_id FROM team_members
        WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
          AND invite_status = 'accepted'
      )
    )
  );

-- invite_log
DROP POLICY IF EXISTS invite_log_all ON invite_log;
CREATE POLICY invite_log_all ON invite_log
  FOR ALL
  USING (
    project_id IN (
      SELECT project_id FROM team_members
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
        AND invite_status = 'accepted'
    )
  );
