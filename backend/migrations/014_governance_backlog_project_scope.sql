-- Backlog project-scoping for AI Governance MVP-0 auto-created findings.
-- See docs/architecture/govern-ai-gap-assessment-and-implementation-plan.md
-- (F3 / decision 6). admin_backlog_items (backend/src/routes/appState.js)
-- predates this feature and has always been a single global admin list --
-- adding project_id here (nullable, so every pre-existing row is untouched
-- and BacklogTab.tsx's manual admin-added items are unaffected) is what
-- lets an auto-created governance finding actually attribute a backlog
-- item to the project that produced it, and lets the de-dup-by-
-- (projectId, controlId) design in decision 6 mean something real.
--
-- This is a separate migration from 013_ai_governance_mvp.sql (rather than
-- editing that file in place) because 013 may already be applied in some
-- deployment by the time this was written -- editing an already-applied
-- migration file risks a migration runner skipping the new ALTER entirely
-- in that environment.

ALTER TABLE admin_backlog_items ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_admin_backlog_items_project
ON admin_backlog_items(project_id) WHERE project_id IS NOT NULL;
