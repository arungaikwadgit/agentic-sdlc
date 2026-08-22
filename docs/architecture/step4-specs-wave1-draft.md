# Step 4 — Component Specs, Wave 1

**Status:** Draft. Steps 1-3 treated as signed off per your instruction. Per Process Rule 3, nothing here authorizes implementation — these are specs, not a go-ahead to touch production. Wave 1 implementation itself remains a separate, explicit decision point.

**Template note:** the original request asked for a 21-section spec per component. I'm reconstructing that template myself (not quoting your exact original wording, which I don't have verbatim) — listed in full below. For the two P0 items, the full template is genuinely warranted. For the four P2 quick wins, several sections would be padding for a single-setting or few-line fix, so I've compressed those to what's actually useful and said so explicitly rather than manufacture content to hit a section count. The P1 item (server test runner) sits in between.

**Template (21 sections):** Purpose & Problem Statement · Current State · Target State / Definition of Done · Scope (In/Out) · Functional Requirements · Non-Functional Requirements · Architecture/Design Approach · Data Model/Schema Changes · API/Interface Changes · Dependencies · Pre-Implementation Gate (risks + mitigations, per Process Rule 2) · Security Considerations · Testing Strategy · Rollout Plan · Rollback Plan · Monitoring/Observability · Documentation Updates Required · Acceptance Criteria · Effort Estimate · Open Questions · Owner/Sign-off.

---

# 1. Migration File Reconstruction (P0)

**1. Purpose & Problem Statement.** Production's applied schema history (`pgmigrations` table: `000`-`023`) doesn't match what's in `main`'s `backend/migrations/` folder (`000`-`009`, `011`-`015` — missing `010` and `016`-`023`, 9 files). A fresh `migrate:up` against a new environment cannot reproduce production today.

**2. Current State.** Confirmed via direct `execute_sql` against the live `pgmigrations` table this program (Step 1, Section F). Missing migration names, from the live tracking table: `010_voice_rerun_backlog`, `016_policy_decisions`, `017_memory_policy_audit`, `018_signed_policy_decisions`, `019_policy_decision_consumption`, `020_autonomous_agentic_execution_backlog`, `021_agent_token_usage_view`, `022_tool_call_audit_log`, `023_correlation_ids`.

**3. Target State / Definition of Done.** All 9 missing migration files exist in `backend/migrations/`, numbered and named to match the live `pgmigrations` record exactly, and a fresh `migrate:up` against an empty database produces a schema matching production (verified by schema diff, not assumed).

**4. Scope.** In: recreating the 9 missing SQL files by reverse-engineering current live schema (table/view/function definitions already queryable via `list_tables`/`execute_sql`). Out: changing any live schema — this is a documentation/reproducibility fix, not a schema change.

**5. Functional Requirements.** Each reconstructed file must be idempotent-safe to run against a database already at that state where possible (`IF NOT EXISTS` guards, matching the existing house style visible in `002_invite_roles.sql`, `003_rls_policies.sql`).

**6. Non-Functional Requirements.** Zero downtime — this is read-only investigation against production plus new files added to the repo; no live migration is being run as part of this task.

**7. Architecture/Design Approach.** For each of the 9 migrations, in order: query live schema for objects introduced at that point (diff against the prior known-good migration's expected state), write the corresponding `CREATE`/`ALTER` SQL, name the file to match the live `pgmigrations.name` exactly so `node-pg-migrate`'s own tracking stays consistent.

**8. Data Model/Schema Changes.** None to production. New files only.

**9. API/Interface Changes.** None.

**10. Dependencies.** None (Step 2, item #1) — can start immediately.

**11. Pre-Implementation Gate.** Risk: reconstructed SQL might not byte-for-byte match what originally ran (e.g. a column default that was later altered by a subsequent migration). Mitigation: verify each reconstructed file's *end state* against live schema via `list_tables(verbose=true)` and `execute_sql` on `information_schema`, not just plausibility — the goal is a matching end state, not historical archaeology. No circular dependency; no blocker.

**12. Security Considerations.** None directly — this doesn't change access, but accurate migration history is itself a governance/audit control (Step 1, Section F's "reproducibility" framing).

**13. Testing Strategy.** After reconstruction, run `migrate:up` against a fresh local/throwaway Postgres and diff its resulting schema against a live schema dump. This is the actual acceptance test, not a unit test.

**14. Rollout Plan.** Commit the 9 files to `backend/migrations/`. No deploy needed — `pgmigrations` on production already shows these as run, so `migrate:up` against production will no-op correctly once the files exist (node-pg-migrate checks the tracking table, not file presence, before running).

**15. Rollback Plan.** N/A — additive documentation, nothing to roll back.

**16. Monitoring/Observability.** N/A.

**17. Documentation Updates Required.** Update Step 1's Section F row once this closes (change 🔴 to 🟢 with the commit reference).

**18. Acceptance Criteria.** Fresh `migrate:up` against an empty DB produces a schema that diffs clean against production's current schema (excluding data).

**19. Effort Estimate.** Medium — 9 files, each requiring a live-schema round-trip to verify; no single file is complex, but doing all 9 carefully is the bulk of the work.

**20. Open Questions.** None outstanding — this is investigation, not a design decision.

**21. Owner/Sign-off.** Unassigned. Awaiting your go to begin (per Process Rule 3, this is Wave 1 implementation, not covered by "Steps 1-3 signed off").

---

# 2. Server-Side RBAC Re-Verification (P0)

**1. Purpose & Problem Statement.** `frontend/src/lib/projectAccess.ts` centralizes permission checks, but it's unconfirmed whether `server/src` route handlers independently re-check these permissions or simply trust whatever the frontend sends — a real security-relevant unknown (Step 1, Section G).

**2. Current State.** Role model confirmed in sync (frontend `AppRole` type ↔ DB `app_role` enum). Frontend-side permission functions exist and are used in the UI. Server-side enforcement: unverified — no code has been read on the `server/src` route handlers to confirm or deny.

**3. Target State / Definition of Done.** A definitive answer, backed by reading the actual route handler code: either (a) `server/src` re-checks `app_role`/team membership itself on every mutating route, or (b) it doesn't, in which case this becomes a real P0 security fix, not just a documentation task.

**4. Scope.** In: reading `server/src` route handlers (likely `server/src/routes/*.ts`) for authorization checks. Out: any code change — this spec is the investigation; a fix (if needed) would be a follow-on spec.

**5-9.** Not applicable to an investigation task — no new functional/architecture/data/API surface is being built here.

**10. Dependencies.** None (Step 2, item #2) — can start immediately.

**11. Pre-Implementation Gate.** Risk: if the answer is "no server-side check," this is a live vulnerability, not a backlog item — a malicious or compromised client could bypass RBAC entirely by calling `server/src` endpoints directly. Mitigation: treat a negative finding as an immediate escalation back to you, not something that waits for the next planning cycle.

**12. Security Considerations.** This entire spec *is* a security consideration.

**13. Testing Strategy.** If a gap is found, the fix's test would be: an authenticated-but-unauthorized request (e.g. a `viewer` role attempting a `project_owner`-only mutation) hits the API directly (bypassing the frontend) and is rejected with 403.

**14-16.** N/A until a fix (if needed) is scoped.

**17. Documentation Updates Required.** Update Step 1 Section G with the definitive finding.

**18. Acceptance Criteria.** A clear yes/no answer, with file:line citations, on whether every mutating `server/src` route checks `app_role` server-side.

**19. Effort Estimate.** Small — reading existing route handler code, not writing new code.

**20. Open Questions.** None — this is exactly what needs to be answered.

**21. Owner/Sign-off.** Unassigned. This one is cheap enough (read-only) that I'd suggest treating it as pre-approved investigation even under a strict reading of Process Rule 3 — but flagging rather than assuming, since it's still your call.

---

# 3. Server Test Runner Fix (P1)

**1. Purpose & Problem Statement.** `server/` has 140 `*.test.ts` files and no test runner installed (no `test` script, no jest/vitest/mocha dependency in `server/package.json`) — currently dead code.

**2. Current State.** Confirmed via `server/package.json` inspection and `find server -name "*.test.ts"` (Step 1, Section E).

**3. Target State.** Either these 140 files run as part of `server`'s CI job, or a documented decision that they're abandoned and should be removed.

**4. Scope.** In: determining which of the two situations this is (missing config vs. abandoned effort), then either wiring up a runner or proposing removal. Out: fixing whatever the 140 tests actually assert (that's downstream of getting them running at all).

**5. Functional Requirements.** If wiring up: add jest or vitest as a devDependency, add a `test` script, add to `.github/workflows/ci.yml`'s server job.

**10. Dependencies.** None (Step 2, item #6). Blocks: CI coverage gap fix (#7).

**11. Pre-Implementation Gate.** Risk: the 140 files may be stale/broken if truly abandoned for a while — first run could surface a large number of failures unrelated to this task's scope. Mitigation: get them running first, triage pass/fail count, don't assume "wire up the runner" and "fix everything it finds" are the same task.

**19. Effort Estimate.** Small to Medium, depending entirely on what's found once a runner is wired up.

**20. Open Questions.** Genuinely unknown until investigated: missing config, or abandoned test suite? This spec doesn't presume the answer.

**21. Owner/Sign-off.** Unassigned, awaiting go.

---

# 4-7. Quick Wins (P2) — compressed treatment, not a full 21 sections each

Each of these is a single setting or a few lines of code with no architecture, no data model, no rollout complexity — writing a full 21-section spec for each would be padding, not rigor. Compressed to what's actually decision-relevant:

## 4. Leaked-Password Protection

**Current state:** Disabled in Supabase Auth (Step 1, D4). **Fix:** enable the setting in Supabase Auth config. **Risk:** none identified — purely additive protection, no expected user impact. **Effort:** trivial. **Owner:** unassigned, awaiting go.

## 5. SECURITY DEFINER Views + Mutable Search Path

**Current state:** Two views (`agent_token_usage_summary`, `agent_token_usage`) and two functions flagged by Supabase's advisor (Step 1, D5). **Fix:** recreate the views without `SECURITY DEFINER` (or add explicit `SECURITY INVOKER` + row-level checks if the definer behavior was intentional — needs a quick check of *why* they're definer views before blindly flipping it), and set an explicit `search_path` on the two flagged functions. **Risk:** if `SECURITY DEFINER` was intentional (e.g. to let a lower-privilege role query aggregate usage data it couldn't otherwise see), removing it could break that use case — worth 10 minutes confirming intent before changing. **Dependency:** proper migration-file tracking of this fix depends on Item 1 (migration reconstruction) landing first, so the next migration number is correct. **Effort:** small. **Owner:** unassigned, awaiting go.

## 6. Dead Code Removal (`server/src/routes/invites.ts`)

**Current state:** References tables that don't exist (Step 1, D3, `docs/security-review-2026-07-05.md`). **Fix:** confirm the referenced tables are truly gone/unused, then remove the dead code paths. **Risk:** low — should be a no-op if genuinely dead, worth grepping for any remaining callers first. **Effort:** trivial. **Owner:** unassigned, awaiting go.

## 7. `express-rate-limit` Trust-Proxy Config

**Current state:** Every request to `artistic-charm` logs `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` (found this program, Step 2 addendum) — Railway's proxy sends `X-Forwarded-For` but Express's `trust proxy` setting doesn't match. **Fix:** set `app.set('trust proxy', ...)` to the correct value for a single-hop Railway proxy (typically `1`, not `true`, to avoid trusting arbitrary spoofed headers). **Risk:** setting this wrong (`true`) would let a client spoof its own IP for rate-limiting purposes — worth getting the exact value right, not just silencing the warning. **Effort:** trivial. **Owner:** unassigned, awaiting go.

---

**Next in Step 4:** Wave 3's items (vector search → RAG grounding) are the largest remaining spec in this step — next turn, continuing without pausing per your instruction.
