-- =============================================================================
-- Migration 006: Consolidate team RBAC onto team_members; retire project_members;
--                 close the RLS-disabled gap on 12 tables.
--
-- Apply directly with psql (this project's real migrations are plain,
-- idempotent SQL run via psql -- NOT node-pg-migrate -- see docs/DEVELOPMENT.md):
--   psql "$POSTGRES_URL_PRODUCTION" -f backend/migrations/006_consolidate_team_members.sql
--
-- Safe to re-run (every statement is idempotent / IF EXISTS guarded).
--
-- WHY THIS MIGRATION EXISTS
-- --------------------------
-- Two separate, disconnected authorization systems have existed side by side:
--
--   1. team_members (this table) -- what 003_rls_policies.sql's RLS policies
--      already check, matched by email pulled out of the JWT claims. This is
--      the table backend/src/proxy.js's invite flow actually writes to.
--
--   2. project_members -- a table from an EARLIER, abandoned design
--      (supabase/migrations/001_initial_schema.sql, never part of this
--      project's real migration history in backend/migrations/). It was never
--      touched by 002/003/004/005. server/src/routes/projects.ts's
--      requireProjectRole() -- the actual Express-layer gate that matters,
--      since RLS is a no-op for the service-role connections both backend
--      services use -- was checking THIS table. So the thing that actually
--      decides "can this HTTP request through" and the thing the database's
--      own defense-in-depth RLS checks were, in production, two different
--      tables that could disagree.
--
-- On top of that: server/src/routes/projects.ts's POST / (project creation)
-- only ever wrote the creator into project_members + the data.teamMembers
-- JSONB blob -- never into team_members itself. Checked against production
-- data before writing this migration: 4 of this database's 5 projects have
-- ZERO team_members row for their own owner. Had anything ever actually
-- relied on team_members-based RLS (e.g. a direct anon-key query, or this
-- migration's own policy rewrite below without the backfill in section 1c),
-- those owners would have been locked out of their own projects.
--
-- This migration makes team_members the ONE place role/access lives, fixes
-- the missing-owner-row gap, and rewrites every policy that referenced the
-- old table or the fragile email-from-JWT match to use team_members.user_id
-- compared against auth.uid() instead -- the same robust pattern the rest of
-- this schema already uses (projects.owner_id, invites.created_by, etc.).
--
-- Also folds in: closing the RLS-disabled gap on 12 tables (found while
-- auditing this), since nothing in this codebase's frontend or either
-- backend service ever queries them via the anon/authenticated key -- both
-- backend/src/proxy.js's Postgres connection and server/'s supabaseAdmin
-- service-role client already bypass RLS entirely, so this only closes
-- direct anon-key access that was never a legitimate path to begin with.
-- =============================================================================


-- =============================================================================
-- SECTION 1: team_members becomes self-sufficient (no more project_members,
--            no more matching by email against JWT claims)
-- =============================================================================

-- 1a. New columns.
--   user_id      -- the missing piece. Lets RLS/app-layer checks use
--                   auth.uid() like every other table in this schema, instead
--                   of extracting email from JWT claims text (fragile: case
--                   sensitivity, email changes, depends on the JWT actually
--                   carrying an 'email' claim).
--   job_role, avatar_color -- absorbed from projects.data.teamMembers JSONB
--                   (see 1d) so that blob stops being a second place this
--                   information lives; the API can keep returning the same
--                   response shape to the frontend from these columns
--                   instead (application-layer change, not in this file).
ALTER TABLE team_members
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS job_role TEXT,
    ADD COLUMN IF NOT EXISTS avatar_color TEXT;

CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

-- 1b. Backfill user_id for every team_members row whose email matches a real
--     Supabase auth user (case-insensitive). Pending invites for an email
--     with no matching auth user yet are correctly left NULL -- they get a
--     user_id once accepted (application-layer change: dbAcceptInvite should
--     set it going forward).
UPDATE team_members tm
SET user_id = au.id
FROM auth.users au
WHERE tm.user_id IS NULL
  AND lower(au.email) = lower(tm.email);

-- 1c. THE ACTUAL BUG: backfill a project_owner row for every project whose
--     owner has no team_members row at all. Confirmed against this database
--     before writing this migration: 4 of 5 projects were missing this.
--     Without it, those owners would fail any team_members-based check.
INSERT INTO team_members (project_id, user_id, email, name, app_role, invite_status, invited_at, accepted_at)
SELECT
  p.id,
  p.owner_id,
  au.email,
  COALESCE(NULLIF(split_part(au.email, '@', 1), ''), 'Owner'),
  'project_owner',
  'accepted',
  p.created_at,
  p.created_at
FROM projects p
JOIN auth.users au ON au.id = p.owner_id
WHERE p.owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.project_id = p.id AND tm.user_id = p.owner_id
  );

-- 1d. Best-effort backfill of job_role/avatar_color from the JSONB mirror,
--     matched by email within each project. Anything not matched just stays
--     NULL -- non-critical display fields, not a correctness issue.
UPDATE team_members tm
SET
  job_role = COALESCE(tm.job_role, member->>'role'),
  avatar_color = COALESCE(tm.avatar_color, member->>'avatarColor')
FROM projects p,
     LATERAL jsonb_array_elements(COALESCE(p.data->'teamMembers', '[]'::jsonb)) AS member
WHERE p.id = tm.project_id
  AND lower(member->>'email') = lower(tm.email)
  AND (tm.job_role IS NULL OR tm.avatar_color IS NULL);


-- =============================================================================
-- SECTION 2: Rewrite RLS on projects/team_members (and the other
--            team-scoped tables from 003_rls_policies.sql) to use
--            team_members.user_id = auth.uid() instead of email-from-JWT.
-- =============================================================================

-- ── projects ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects
  FOR SELECT
  USING (
    id IN (
      SELECT project_id FROM team_members
      WHERE user_id = auth.uid() AND invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS projects_update ON projects;
CREATE POLICY projects_update ON projects
  FOR UPDATE
  USING (
    id IN (
      SELECT project_id FROM team_members
      WHERE user_id = auth.uid()
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
      WHERE user_id = auth.uid() AND app_role = 'project_owner' AND invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects
  FOR INSERT
  WITH CHECK (true);

-- Also remove the OLDER, project_members-based policies on projects from the
-- abandoned supabase/migrations/001_initial_schema.sql track, if they were
-- ever applied to this database (IF EXISTS makes this a no-op otherwise).
DROP POLICY IF EXISTS "projects: owner or member can select" ON projects;
DROP POLICY IF EXISTS "projects: owner or admin can update" ON projects;
DROP POLICY IF EXISTS "projects: owner can delete" ON projects;
DROP POLICY IF EXISTS "projects: authenticated users can create" ON projects;

-- ── team_members ─────────────────────────────────────────────────────────────
-- Per current requirements: any accepted member can VIEW the full team list;
-- only an accepted Project Owner can add/change/remove members. (App-wide
-- admins bypass this entirely at the Express layer via the service-role
-- connection, same as every other table here.)
DROP POLICY IF EXISTS team_members_select ON team_members;
CREATE POLICY team_members_select ON team_members
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM team_members tm2
      WHERE tm2.user_id = auth.uid() AND tm2.invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS team_members_insert ON team_members;
CREATE POLICY team_members_insert ON team_members
  FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM team_members tm2
      WHERE tm2.user_id = auth.uid() AND tm2.app_role = 'project_owner' AND tm2.invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS team_members_update ON team_members;
CREATE POLICY team_members_update ON team_members
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM team_members tm2
      WHERE tm2.user_id = auth.uid() AND tm2.app_role = 'project_owner' AND tm2.invite_status = 'accepted'
    )
  );

DROP POLICY IF EXISTS team_members_delete ON team_members;
CREATE POLICY team_members_delete ON team_members
  FOR DELETE
  USING (
    project_id IN (
      SELECT project_id FROM team_members tm2
      WHERE tm2.user_id = auth.uid() AND tm2.app_role = 'project_owner' AND tm2.invite_status = 'accepted'
    )
  );

-- ── agent_runs, agent_jobs, memory_records, action_proposals, rollback_log,
--    invite_log -- same email-from-JWT fragility, same fix. ──────────────────
DROP POLICY IF EXISTS agent_runs_all ON agent_runs;
CREATE POLICY agent_runs_all ON agent_runs FOR ALL
  USING (project_id IN (SELECT project_id FROM team_members WHERE user_id = auth.uid() AND invite_status = 'accepted'));

DROP POLICY IF EXISTS agent_jobs_all ON agent_jobs;
CREATE POLICY agent_jobs_all ON agent_jobs FOR ALL
  USING (project_id IN (SELECT project_id FROM team_members WHERE user_id = auth.uid() AND invite_status = 'accepted'));

DROP POLICY IF EXISTS memory_records_all ON memory_records;
CREATE POLICY memory_records_all ON memory_records FOR ALL
  USING (project_id IN (SELECT project_id FROM team_members WHERE user_id = auth.uid() AND invite_status = 'accepted'));

DROP POLICY IF EXISTS action_proposals_all ON action_proposals;
CREATE POLICY action_proposals_all ON action_proposals FOR ALL
  USING (project_id IN (SELECT project_id FROM team_members WHERE user_id = auth.uid() AND invite_status = 'accepted'));

DROP POLICY IF EXISTS rollback_log_all ON rollback_log;
CREATE POLICY rollback_log_all ON rollback_log FOR ALL
  USING (
    proposal_id IN (
      SELECT id FROM action_proposals
      WHERE project_id IN (SELECT project_id FROM team_members WHERE user_id = auth.uid() AND invite_status = 'accepted')
    )
  );

DROP POLICY IF EXISTS invite_log_all ON invite_log;
CREATE POLICY invite_log_all ON invite_log FOR ALL
  USING (project_id IN (SELECT project_id FROM team_members WHERE user_id = auth.uid() AND invite_status = 'accepted'));


-- =============================================================================
-- SECTION 3: Retire project_members and the abandoned-design leftovers.
-- =============================================================================

-- Order matters here: is_project_member() can't be dropped while ANY policy
-- still depends on it (Postgres will refuse with a dependency error) -- and
-- that includes the invites table's own insert policy below, not just
-- project_members'. Drop every dependent policy first, then the function,
-- then the tables. (Caught by dry-running this migration before applying it.)
DROP POLICY IF EXISTS "members: owner or admin can insert" ON project_members;
DROP POLICY IF EXISTS "members: owner or admin can update" ON project_members;
DROP POLICY IF EXISTS "members: owner or member can select" ON project_members;
DROP POLICY IF EXISTS "members: owner, admin, or self can delete" ON project_members;

-- invites: a completely separate, never-used invite table from the same
-- abandoned design (0 rows in production, no code anywhere references it --
-- backend/src/proxy.js's real invite flow uses team_members.invite_token_hash
-- instead). Confirmed empty and dead before including this.
DROP POLICY IF EXISTS "invites: anyone can read by token" ON invites;
DROP POLICY IF EXISTS "invites: owner or admin can insert" ON invites;

DROP FUNCTION IF EXISTS is_project_member(uuid, text[]);

DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS invites;


-- =============================================================================
-- SECTION 4: Close the RLS-disabled gap on the remaining 12 tables.
--
-- Every one of these is read/written exclusively via a service-role or
-- superuser-equivalent connection today (confirmed: no `.from(...)` calls
-- against any of them anywhere in frontend/src, and backend/src/proxy.js's
-- getSupabase() -- the anon-key client -- is only ever used for
-- auth.getUser(), never for table reads). Enabling RLS with no permissive
-- policy makes them default-deny for the anon/authenticated roles, which is
-- the entire point -- it does not change behavior for any code path this
-- app actually uses.
-- =============================================================================

ALTER TABLE invite_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_integrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_backlog_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pgmigrations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_phases              ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_review_gates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_agents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_phase_agents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_domains             ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_role_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_role_template_agents ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- DONE
-- =============================================================================
