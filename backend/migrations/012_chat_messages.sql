-- Copyright (c) 2026 Arun Gaikwad. All rights reserved.
-- Persisted Agentic Help chatbot conversation turns.
--
-- Prior to this migration, chat history lived only in ChatWidget.tsx's React
-- state -- ephemeral per browser tab, never shared between team members, and
-- lost on refresh. This table backs two related-but-distinct features:
--   1. "Shared context" -- a bounded recent window across the WHOLE project
--      team is read back and injected into the chat orchestrator's synthesis
--      prompt for conversational continuity, regardless of who asked what.
--   2. "Private view" -- each user's own rendered chat log (what they see in
--      the widget) is hydrated only from their OWN rows -- nobody's literal
--      chat bubbles become visible to a teammate, only the retrieval benefits
--      from the wider team context.
--
-- user_id/user_email are denormalized (not a team_members FK) because a
-- caller may be a project owner or app admin with no team_members row at
-- all (see ownerFallbackMember in projectAccess.ts / adminBypass in
-- proxy.js's checkToken), and dashboard-level chat (project_id NULL) has no
-- project membership context whatsoever.
--
-- Retention: same lifetime as the project (ON DELETE CASCADE) -- no separate
-- expiry job, matching how agent_runs/memory_records already behave.
CREATE TABLE IF NOT EXISTS chat_messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id        UUID,
    user_email     TEXT,
    role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text           TEXT NOT NULL,
    response_mode  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bounded shared-context reads: most recent N turns for a project, across
-- every team member.
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_created
    ON chat_messages (project_id, created_at);

-- Private-view hydration: one user's own turns for a project.
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_user_created
    ON chat_messages (project_id, user_id, created_at);
