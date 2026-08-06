-- Migration: 005_secure_invite_links
-- Manual (in-app) invite-link hardening — see docs/DEVELOPMENT.md "Invite links"
-- section for the full security model.
--
-- 1. Formally tracks two columns on `projects` that already exist in
--    production (added out-of-band, outside node-pg-migrate, at some point
--    before this migration — confirmed live via dbSyncAcceptedMemberInProjectData()
--    in backend/src/proxy.js, which reads/writes projects.data JSONB, and the
--    invite-scoped project API, which reads projects.owner_id). Fresh
--    databases (CI, new local dev, a new environment) built only from the
--    node-pg-migrate-tracked migration files never had these columns, which
--    caused schema drift between production and every other environment.
--    ADD COLUMN IF NOT EXISTS makes this migration a safe no-op on production
--    and a real fix on every fresh database.
-- 2. Adds invite_token_hash — invites now store only a SHA-256 hash of the
--    invite token server-side; the raw token is returned to the caller once
--    (in the API response / share link) and never persisted. invite_token
--    (raw) is kept only for backward-read compatibility with any invite rows
--    created before this migration shipped; new invites always write NULL to
--    invite_token and the hash to invite_token_hash.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS owner_id UUID,
    ADD COLUMN IF NOT EXISTS data      JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS domain    TEXT,
    ADD COLUMN IF NOT EXISTS status    TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);

ALTER TABLE team_members
    ADD COLUMN IF NOT EXISTS invite_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_invite_token_hash
    ON team_members(invite_token_hash)
    WHERE invite_token_hash IS NOT NULL;
