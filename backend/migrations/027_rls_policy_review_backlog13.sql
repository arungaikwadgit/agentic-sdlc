-- Backlog #13 (full RLS policy review), 2026-08-26.
--
-- CONTEXT: Supabase's security advisor (get_advisors, type=security) flags
-- 26 public-schema tables as "RLS Enabled No Policy" -- RLS is on, but no
-- policy exists for any command. A 27th table, agent_feedback, was in the
-- same state until migration 026 enabled RLS on it (it previously had RLS
-- OFF entirely, which was the one ERROR-level finding).
--
-- REVIEW CONCLUSION for all 27: RLS-enabled-with-zero-policy is the correct,
-- intentional end state, not an unfinished migration. Verified two ways:
--   1. Code search: frontend/src/lib/supabase.ts (the only place the app's
--      anon-key Supabase client is constructed) is used exclusively for
--      Supabase Auth (session/token) across every file that imports it --
--      zero `.from(...)` table calls exist anywhere in frontend/src. Every
--      DB read/write in the app goes through the Express backend, which
--      uses either a direct pg.Pool connection (POSTGRES_URL) or the
--      service_role key -- both bypass RLS entirely.
--   2. Because RLS blocks anon/authenticated by default when no policy
--      exists, "zero policy" == "zero access for anon/authenticated" == the
--      safest possible state given nothing in this app is meant to query
--      these tables via the anon key.
-- Adding real per-role policies to these 27 tables would be undone work
-- (there is no legitimate anon/authenticated access pattern to allow) and
-- would only widen the attack surface for no functional benefit.
--
-- FINDING 1 -- grants: despite RLS blocking every one of these tables,
-- Postgres/Supabase's default schema privileges still GRANT
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on all of them to
-- both anon and authenticated. Today RLS is the only thing standing between
-- those roles and full read/write access via PostgREST. This migration
-- revokes those grants outright, so a future policy added carelessly to
-- any one of these tables can no longer accidentally reopen it -- two
-- independent layers instead of one.
--
-- FINDING 2 -- migration drift: 8 of these tables (chat_messages,
-- governance_decision, governance_finding, governance_override,
-- agent_global_settings, project_agent_overrides, agent_prompt_versions,
-- agent_prompt_audit_log) already have RLS enabled in production, but that
-- was applied directly via raw SQL against the live database outside this
-- migration history (confirmed via supabase_migrations.schema_migrations,
-- which lists untracked entries enable_rls_agent_prompt_versions_and_audit_log
-- and tool_call_audit_log_rls, both 2026-07-24, with no matching file in
-- this directory). A fresh database built from these migration files alone
-- -- CI's test Postgres, a new dev environment -- would NOT enable RLS on
-- those 8 tables. The ENABLE statements below are a no-op against
-- production (already true there) and a real fix everywhere else.
--
-- OUT OF SCOPE: a stray empty table, _claude_backup_2026_08_07, left behind
-- by a prior session directly in production, is deliberately NOT touched
-- here -- flagged separately for manual removal by the project owner (it
-- isn't declared in any migration file, so there's nothing to reconcile).
--
-- Applied directly to production via Supabase MCP (apply_migration) on
-- 2026-08-26 and verified with get_advisors + a role_table_grants check
-- before this file was committed, so this file documents/backfills a change
-- that is already live -- see docs/architecture/execution-status-2026-08-26.md.

-- Finding 2: backfill drift -- make repo match production
ALTER TABLE public.chat_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_decision      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_finding       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_override      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_global_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_agent_overrides  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_prompt_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_prompt_audit_log   ENABLE ROW LEVEL SECURITY;

-- Finding 1: revoke anon/authenticated grants -- second independent layer
REVOKE ALL ON TABLE public.admin_backlog_items         FROM anon, authenticated;
REVOKE ALL ON TABLE public.agent_feedback              FROM anon, authenticated;
REVOKE ALL ON TABLE public.agent_global_settings       FROM anon, authenticated;
REVOKE ALL ON TABLE public.agent_prompt_audit_log      FROM anon, authenticated;
REVOKE ALL ON TABLE public.agent_prompt_versions       FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_config                  FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_integrations            FROM anon, authenticated;
REVOKE ALL ON TABLE public.chat_messages               FROM anon, authenticated;
REVOKE ALL ON TABLE public.governance_decision         FROM anon, authenticated;
REVOKE ALL ON TABLE public.governance_finding          FROM anon, authenticated;
REVOKE ALL ON TABLE public.governance_override         FROM anon, authenticated;
REVOKE ALL ON TABLE public.invite_sessions             FROM anon, authenticated;
REVOKE ALL ON TABLE public.lifecycle_events            FROM anon, authenticated;
REVOKE ALL ON TABLE public.master_agents               FROM anon, authenticated;
REVOKE ALL ON TABLE public.master_domains              FROM anon, authenticated;
REVOKE ALL ON TABLE public.master_phase_agents         FROM anon, authenticated;
REVOKE ALL ON TABLE public.master_phases               FROM anon, authenticated;
REVOKE ALL ON TABLE public.master_review_gates         FROM anon, authenticated;
REVOKE ALL ON TABLE public.master_role_template_agents FROM anon, authenticated;
REVOKE ALL ON TABLE public.master_role_templates       FROM anon, authenticated;
REVOKE ALL ON TABLE public.memory_access_log           FROM anon, authenticated;
REVOKE ALL ON TABLE public.pgmigrations                FROM anon, authenticated;
REVOKE ALL ON TABLE public.policy_decisions            FROM anon, authenticated;
REVOKE ALL ON TABLE public.project_agent_overrides     FROM anon, authenticated;
REVOKE ALL ON TABLE public.tool_call_audit_log         FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_preferences            FROM anon, authenticated;
