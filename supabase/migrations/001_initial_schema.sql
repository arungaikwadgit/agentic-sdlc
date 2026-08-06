-- =============================================================================
-- © 2026 Arun Gaikwad. All rights reserved.
-- Proprietary and Confidential — Unauthorized use prohibited.
-- =============================================================================

-- =============================================================================
-- Agentic SDLC — Initial PostgreSQL Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================================

-- Enable the uuid extension (already on in Supabase, but just in case)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- PROJECTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  domain        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  -- All agent outputs, settings, and large JSON blobs live here.
  -- We keep one JSONB column instead of many columns so schema stays stable
  -- as the app evolves. The backend validates/coerces before writing.
  data          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status);
CREATE INDEX IF NOT EXISTS projects_updated_idx ON projects (updated_at DESC);

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =============================================================================
-- PROJECT MEMBERS (RBAC)
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin', 'member', 'viewer')),
  invited_email TEXT,            -- email they were invited with (may differ from current email)
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id)   -- one membership row per user per project
);

CREATE INDEX IF NOT EXISTS members_project_idx ON project_members (project_id);
CREATE INDEX IF NOT EXISTS members_user_idx    ON project_members (user_id);

-- =============================================================================
-- INVITES
-- =============================================================================
CREATE TABLE IF NOT EXISTS invites (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,    -- 48-char hex, generated server-side
  role          TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin', 'member', 'viewer')),
  invited_email TEXT,                    -- NULL = open invite (any email can accept)
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted      BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_by   UUID REFERENCES auth.users(id),
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invites_project_idx ON invites (project_id);
CREATE INDEX IF NOT EXISTS invites_token_idx   ON invites (token);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Important: our Express server uses the service_role key which BYPASSES RLS.
-- RLS below is a defence-in-depth layer in case anything ever hits Supabase
-- directly (e.g. Supabase client in frontend, dashboard queries, etc.).

ALTER TABLE projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites         ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user a member of a project with one of the given roles?
CREATE OR REPLACE FUNCTION is_project_member(p_project_id UUID, VARIADIC p_roles TEXT[])
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id
      AND user_id    = auth.uid()
      AND role       = ANY(p_roles)
  );
$$;

-- ── projects policies ────────────────────────────────────────────────────────

-- Read: owner OR any member
CREATE POLICY "projects: owner or member can select"
  ON projects FOR SELECT
  USING (
    owner_id = auth.uid()
    OR is_project_member(id, 'admin', 'member', 'viewer')
  );

-- Insert: any authenticated user can create a project (becomes owner)
CREATE POLICY "projects: authenticated users can create"
  ON projects FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Update: owner or admin only
CREATE POLICY "projects: owner or admin can update"
  ON projects FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR is_project_member(id, 'admin')
  );

-- Delete: owner only
CREATE POLICY "projects: owner can delete"
  ON projects FOR DELETE
  USING (owner_id = auth.uid());

-- ── project_members policies ─────────────────────────────────────────────────

-- Read: project owner or any member can see the member list
CREATE POLICY "members: owner or member can select"
  ON project_members FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid())
    OR user_id = auth.uid()
    OR is_project_member(project_id, 'admin', 'member', 'viewer')
  );

-- Insert: project owner or admin (via backend; RLS matches server logic)
CREATE POLICY "members: owner or admin can insert"
  ON project_members FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid())
    OR is_project_member(project_id, 'admin')
  );

-- Update: owner or admin can change roles
CREATE POLICY "members: owner or admin can update"
  ON project_members FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid())
    OR is_project_member(project_id, 'admin')
  );

-- Delete: owner/admin can remove members; members can remove themselves
CREATE POLICY "members: owner, admin, or self can delete"
  ON project_members FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid())
    OR is_project_member(project_id, 'admin')
    OR user_id = auth.uid()
  );

-- ── invites policies ─────────────────────────────────────────────────────────

-- Anyone can read by token (the backend does the expiry/accepted check)
CREATE POLICY "invites: anyone can read by token"
  ON invites FOR SELECT
  USING (TRUE);

-- Only project owner/admin can create invites
CREATE POLICY "invites: owner or admin can insert"
  ON invites FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid())
    OR is_project_member(project_id, 'admin')
  );

-- Accept/revoke: backend handles this via service role, no direct client writes needed
-- (leave update/delete locked down to service role only by omitting policies)

-- =============================================================================
-- DONE
-- =============================================================================
-- After running this migration, note down:
--   • Your Supabase project URL     → goes in SUPABASE_URL env var
--   • Your service_role secret key  → goes in SUPABASE_SERVICE_KEY env var
--   • Your anon/public key          → goes in VITE_SUPABASE_ANON_KEY env var
