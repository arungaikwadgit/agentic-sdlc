-- Migration: 002_invite_roles
-- Adds invite system and role-based access control to team_members.
-- node-pg-migrate: up

-- ── New enums ─────────────────────────────────────────────────────────────────
CREATE TYPE app_role AS ENUM ('project_owner', 'editor', 'reviewer', 'viewer');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'revoked');

-- ── Alter team_members ────────────────────────────────────────────────────────
ALTER TABLE team_members
    ADD COLUMN app_role      app_role NOT NULL DEFAULT 'viewer',
    ADD COLUMN invite_status invite_status NOT NULL DEFAULT 'pending',
    ADD COLUMN invite_token  TEXT,          -- UUID token embedded in the invite link
    ADD COLUMN invited_at    TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN accepted_at   TIMESTAMPTZ;  -- set when invitee clicks the link

-- Unique index so tokens can be looked up directly
CREATE UNIQUE INDEX idx_team_members_invite_token
    ON team_members(invite_token)
    WHERE invite_token IS NOT NULL;

CREATE INDEX idx_team_members_invite_status ON team_members(invite_status);

-- ── invites log (audit trail) ─────────────────────────────────────────────────
-- Keeps a record of every invite action (sent, resent, revoked, accepted)
-- even after the token is cleared from team_members.
CREATE TABLE invite_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    action        TEXT NOT NULL,   -- 'sent' | 'resent' | 'revoked' | 'accepted'
    performed_by  TEXT,            -- email of the admin who triggered the action
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invite_log_project_id ON invite_log(project_id);
CREATE INDEX idx_invite_log_team_member_id ON invite_log(team_member_id);
