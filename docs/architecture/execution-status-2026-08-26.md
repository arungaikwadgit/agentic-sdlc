# Execution Status — 2026-08-26

Continues `docs/architecture/execution-status-2026-08-25.md`.

---

## 1. Completed today

| Item | What | Commit(s) | Status |
|---|---|---|---|
| #13 (partial) — RLS review, critical finding | Ran Supabase's security advisor (`get_advisors`, type=security) against the live database — the actual audit backlog item #13 asked for. Found and fixed one ERROR-level, externally-facing gap. | `backend/migrations/026_agent_feedback_enable_rls.sql` (pending commit) + applied directly to production via Supabase migration | Done, verified. See Section 2. |

---

## 2. Gap → fix → benefit

| Gap | How it was fixed | Benefit |
|---|---|---|
| **`agent_feedback` had row-level security disabled entirely** — the only `ERROR`-severity, `EXTERNAL`-facing finding across the whole database. The frontend ships a public Supabase anon key (`VITE_SUPABASE_ANON_KEY`, public by design). With RLS off, that key could hit Supabase's PostgREST API directly (`GET`/`POST`/`DELETE .../rest/v1/agent_feedback`) and read or write every project's feedback rows, completely bypassing the app's own `checkToken`/`requireAdmin` checks in `backend/src/routes/agentFeedback.js` — those guard the Express route, not the table. | `ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;` — applied directly to production (migration `026_agent_feedback_enable_rls.sql`, also added to the repo so `node-pg-migrate`'s history stays consistent for fresh environments; the statement is idempotent, safe to re-run). No policies added deliberately: the app never queries this table through PostgREST, only via a direct `pg.Pool` connection using `POSTGRES_URL`. Confirmed via `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'postgres'` that this role has `rolbypassrls = true`, so RLS has zero effect on the app's own access path. | Closes a live, publicly-exploitable data-exposure gap with zero risk to the app's actual functionality. Verified two ways post-fix: (1) `get_advisors` re-run — the `rls_disabled_in_public` finding for `agent_feedback` is gone, now shows the same fail-closed `rls_enabled_no_policy` (INFO, not ERROR) state as the other 26 tables; (2) a real insert+delete cycle through the same `postgres` role the app uses succeeded cleanly (0 leftover rows after), proving the feedback-capture feature is unaffected. |

**Confidence: ~0.95.** Both the vulnerability characterization and the fix's safety were verified against the live database directly (role privileges, advisor re-scan, actual write test) rather than assumed from documentation.

---

## 3. Scope note — what this pass did NOT touch

The same advisor scan surfaced three more items, deliberately left alone this pass:

- **26 tables with RLS enabled but zero policies** (`app_integrations`, `chat_messages`, `governance_decision`, `invite_sessions`, `master_*` catalog tables, etc.) — `INFO` level, not `ERROR`. These are already fail-closed (Postgres denies all PostgREST access by default when RLS is on with no policies), so they're not an active exposure — just lint noise. A real per-table review (backlog #13's original, broader scope) would decide whether any of these should have explicit policies as defense-in-depth, or whether "fail-closed with no policies" is the intended permanent state given the app never uses PostgREST for them. Not decided here — flagging as the remaining #13 scope.
- **`vector` extension installed in the `public` schema** (`WARN`) — Supabase recommends moving extensions out of `public`. Low risk, cosmetic/best-practice; would require re-pointing the `pgvector` migration's extension reference if moved. Not done this pass.
- **Leaked password protection disabled in Supabase Auth** (`WARN`) — a one-click toggle in Supabase's dashboard (HaveIBeenPwned check on new passwords), not a code change. Flagging for the user to enable directly, similar to how UptimeRobot was handled.

---

## 4. Next step

Remaining backlog (7 items, unchanged from 08-25's list minus the critical RLS finding just closed): the broader #13 scope (26 tables' policy review, per above), #12 (backup/PITR decision), #15 (integration provider scoping), #16 (eval scorers), #17 (load/performance testing), #21 (UI component inventory), #5 phases 4-6, deferred Jira full scope. User's call on what to prioritize next.
