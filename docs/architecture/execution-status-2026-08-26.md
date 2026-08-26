# Execution Status — 2026-08-26

Continues `docs/architecture/execution-status-2026-08-25.md`.

---

## 1. Completed today

| Item | What | Commit(s) | Status |
|---|---|---|---|
| #13 (critical finding) — RLS review, `agent_feedback` | Ran Supabase's security advisor (`get_advisors`, type=security) against the live database. Found and fixed one ERROR-level, externally-facing gap. | `backend/migrations/026_agent_feedback_enable_rls.sql` + applied directly to production via Supabase migration | Done, verified. See Section 2. |
| #12 — backup / disaster recovery | Supabase org is on the free plan: no automatic backups, no PITR available below Pro. Built a manual nightly encrypted backup as the free-tier substitute Supabase's own docs recommend: `pg_dump` → GPG (AES256) → pushed to a new private repo, 7-day retention. | `.github/workflows/db-backup.yml` (`f188c2e`) + new private repo `arungaikwadgit/agentic-sdlc-backups` | Shipped, not yet functional — needs 3 secrets added manually by the user (`SUPABASE_DB_URL`, `BACKUP_ENCRYPTION_PASSPHRASE`, `BACKUP_REPO_PAT`), then a first test run and a restore drill. See prior session notes / project memory for exact instructions. |
| #13 (full scope) — RLS policy review, remaining 26 tables + grants + drift | Reviewed all 26 `rls_enabled_no_policy` (INFO) tables left over from the critical-finding pass. Concluded RLS-enabled-zero-policy is the correct, intentional end state (verified via code search + role-privilege queries, not assumed). Found and fixed two real issues on top of that conclusion: wide-open `anon`/`authenticated` table grants on all 27 tables (RLS was the *only* thing blocking access), and migration drift (8 tables had RLS enabled in production via untracked raw SQL, not reflected in any repo migration file). | `backend/migrations/027_rls_policy_review_backlog13.sql` (`2fbb236`) + applied directly to production via Supabase migration | Done, verified. See Section 2a. |

---

## 2. Gap → fix → benefit — `agent_feedback` (ERROR-level)

| Gap | How it was fixed | Benefit |
|---|---|---|
| **`agent_feedback` had row-level security disabled entirely** — the only `ERROR`-severity, `EXTERNAL`-facing finding across the whole database. The frontend ships a public Supabase anon key (`VITE_SUPABASE_ANON_KEY`, public by design). With RLS off, that key could hit Supabase's PostgREST API directly (`GET`/`POST`/`DELETE .../rest/v1/agent_feedback`) and read or write every project's feedback rows, completely bypassing the app's own `checkToken`/`requireAdmin` checks in `backend/src/routes/agentFeedback.js` — those guard the Express route, not the table. | `ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;` — applied directly to production (migration `026_agent_feedback_enable_rls.sql`, also added to the repo so `node-pg-migrate`'s history stays consistent for fresh environments; the statement is idempotent, safe to re-run). No policies added deliberately: the app never queries this table through PostgREST, only via a direct `pg.Pool` connection using `POSTGRES_URL`. Confirmed via `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'postgres'` that this role has `rolbypassrls = true`, so RLS has zero effect on the app's own access path. | Closes a live, publicly-exploitable data-exposure gap with zero risk to the app's actual functionality. Verified two ways post-fix: (1) `get_advisors` re-run — the `rls_disabled_in_public` finding for `agent_feedback` is gone, now shows the same fail-closed `rls_enabled_no_policy` (INFO, not ERROR) state as the other 26 tables; (2) a real insert+delete cycle through the same `postgres` role the app uses succeeded cleanly (0 leftover rows after), proving the feedback-capture feature is unaffected. |

**Confidence: ~0.95.** Both the vulnerability characterization and the fix's safety were verified against the live database directly (role privileges, advisor re-scan, actual write test) rather than assumed from documentation.

---

## 2a. Gap → fix → benefit — full RLS review of the remaining 26 tables

**Review conclusion (all 27 tables including `agent_feedback`):** RLS-enabled-with-zero-policy is the correct, intentional end state, not an unfinished migration. Verified two ways: (1) code search — `frontend/src/lib/supabase.ts`, the only place the app's anon-key Supabase client is constructed, is used exclusively for Supabase Auth (session/token) everywhere it's imported; zero `.from(...)` table calls exist anywhere in `frontend/src`. Every DB read/write goes through the Express backend, which uses either a direct `pg.Pool` connection or the `service_role` key — both bypass RLS entirely. (2) Because RLS blocks `anon`/`authenticated` by default when no policy exists, "zero policy" already equals "zero access" for those roles — the safest state possible given no legitimate anon-key access pattern exists for any of these tables. Adding real per-role policies would be undone work with no functional benefit.

| Gap | How it was fixed | Benefit |
|---|---|---|
| **Wide-open table grants**: despite RLS blocking every one of the 27 tables, Postgres/Supabase's default schema privileges still `GRANT`ed `SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` on all of them to both `anon` and `authenticated`. RLS was the *only* thing standing between those roles and full read/write access via PostgREST. | `REVOKE ALL ... FROM anon, authenticated` on all 27 tables (`backend/migrations/027_rls_policy_review_backlog13.sql`). Zero functional impact — the app never used these grants. | A future policy added carelessly to any one of these tables can no longer accidentally reopen it to the public anon key — two independent layers instead of one. |
| **Migration drift**: 8 tables (`chat_messages`, `governance_decision`, `governance_finding`, `governance_override`, `agent_global_settings`, `project_agent_overrides`, `agent_prompt_versions`, `agent_prompt_audit_log`) had RLS enabled in production via raw SQL applied directly against the live database, with no matching file anywhere in `backend/migrations/`. Confirmed via `supabase_migrations.schema_migrations`, which lists untracked entries `enable_rls_agent_prompt_versions_and_audit_log` and `tool_call_audit_log_rls` (both 2026-07-24). A fresh CI/dev database built from the repo's migrations alone would not match production's security posture for these 8 tables. | Backfilled the same `ENABLE ROW LEVEL SECURITY` statements into `027_rls_policy_review_backlog13.sql` — a no-op against production (already true there), a real fix for any fresh environment. | Repo and production are back in sync; `node-pg-migrate up` against a clean database now reproduces production's actual RLS posture. |

**Confidence: ~0.9.** The access-pattern conclusion rests on a full-repo code search finding zero direct table calls from the frontend's anon-key client — high confidence, but a codebase this size could theoretically have a call path missed by search (e.g. dynamically constructed). The grant/drift findings are directly queried from `pg_catalog`/`information_schema`, not inferred — high confidence.

**Deliberately out of scope:** a stray, empty table `_claude_backup_2026_08_07` (id, project_id, field, snapshot jsonb, created_at) was found in production's public schema, left behind by a prior session's ad hoc backup-before-edit mechanism. It carries the same wide-open grants as the other tables but was not touched by this migration since it isn't declared in any migration file (nothing to reconcile) and dropping a table is a data-deletion action outside what an agent should do unilaterally. The user has the exact `DROP TABLE` command to run themselves when ready.

---

## 3. Scope note — what remains untouched

- **`vector` extension installed in the `public` schema** (`WARN`) — Supabase recommends moving extensions out of `public`. Low risk, cosmetic/best-practice; would require re-pointing the `pgvector` migration's extension reference if moved. Not done.
- **Leaked password protection disabled in Supabase Auth** (`WARN`) — a one-click toggle in Supabase's dashboard (HaveIBeenPwned check on new passwords), not a code change. Flagging for the user to enable directly.
- **Stray `_claude_backup_2026_08_07` table** — see Section 2a. Awaiting the user's own `DROP TABLE` execution.
- **#12 backup workflow** — shipped but not yet live: needs 3 secrets, a first `workflow_dispatch` test run, and a restore drill against a scratch database.

---

## 4. Next step

Backlog #13 is now fully closed (both the critical finding and the full 26-table review). Remaining items, in the program's original order: #15 (integration provider scoping), #16 (eval scorers), #17 (load/performance testing), #21 (UI component inventory), #5 phases 4-6, deferred Jira full scope — plus the two open #12 follow-ups (test run, restore drill) and the three untouched findings in Section 3. User's call on what to prioritize next.
