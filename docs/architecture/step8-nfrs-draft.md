# Step 8 — Non-Functional Requirements (NFRs)

**Status:** Draft, held for review — Process Rules 1-4 apply. Planning artifact; nothing here authorizes implementation on its own.

**Source:** derived from actual current-state evidence across Steps 1-7 and Wave 1's live verification, not a generic NFR checklist. Every "Current" cell below is cited to a specific finding; every "Target" is a judgment call on my part, flagged as such where it's not already implied by an existing project instruction.

**Standing instruction carried forward:** your own project-level directive — "code coverage >95%, confidence level >95%" — is treated as the target for the testing/coverage rows below, not something I'm inventing. Current state falls well short of it in two of three codebases; that gap is stated plainly, not softened.

---

## 1. Performance

| Requirement | Current | Target | Gap |
|---|---|---|---|
| API response latency | Railway healthcheck timeout set to 60s (`server/railway.json`); no p50/p95 latency SLA measured or defined anywhere in the codebase | p95 < 500ms for non-agent routes; agent/LLM-proxy routes excluded (inherently variable, provider-bound) | Needs real measurement — no baseline exists to compare against |
| Load capacity | Load/performance testing is minimal — Step 1/2 findings describe it as ~10 virtual users, not representative of production scale | Defined by actual expected concurrent usage (unknown — no usage data collected yet, per Step 1's user-feedback-loop finding) | Tracked as Step 6 item #17; blocked on having real usage numbers to test against, not just a bigger VU count |
| Rate limiting | `/api/` 200 req/15min, `/api/agents/` 60 req/min (backend/src/proxy.js); `server/`'s own trust-proxy misconfiguration fixed this session (Wave 1 item 7) | Current limits are reasonable defaults; revisit once real usage data exists | Low priority — already functioning correctly post-fix |

## 2. Scalability

| Requirement | Current | Target | Gap |
|---|---|---|---|
| Background/async job processing | `agent_jobs` queue table exists with retry/idempotency columns (migration 009); `BACKGROUND_WORKER_ENABLED` confirmed **not set** in production (Step 1 Ledger #1) — the worker code path exists but is switched off | Explicit decision: turn it on, or formally scope it out | Tracked as Step 6 item #8 — a decision, not blocked on anything technical |
| Database tier | Supabase **Free plan** — confirmed via `get_organization` (Step 1 Ledger #2) | Sized to actual load once known; Free tier is adequate for current dev/early-stage usage | No action needed unless usage grows — revisit alongside I1/I6 from the RAID register |
| Horizontal scaling of `server/`/`backend/` | Single-instance Railway services (no replica count specified beyond default in `railway.json`) | Not yet a concern at current scale | No action needed now |

## 3. Reliability / Availability

| Requirement | Current | Target | Gap |
|---|---|---|---|
| Deploy safety | Railway auto-rollback to last successful deployment masked a real ~2-week silent deploy failure on `server/` (Step 1 Ledger #6) with zero visible outage but zero new code shipping | Deploy failures should alert, not just silently roll back | Worth a follow-up item: Railway deployment-failure notifications aren't currently configured anywhere found in this program — new finding, not previously tracked; recommend adding to the backlog |
| Healthchecks | Both Railway services confirmed healthy this session (`05a5705a`, `7fe62b7f`, both SUCCESS) with working `/health` (`server/`) and `/api/health` (`backend/`) endpoints | Maintain as-is | None |
| Data durability | No point-in-time recovery on Supabase Free tier (Step 1 Ledger #2, RAID I6) | PITR available (Pro tier) or an explicit accepted-risk sign-off, same treatment as leaked-password protection | Open — business decision, tracked in RAID I6 |

## 4. Security

| Requirement | Current | Target | Gap |
|---|---|---|---|
| Server-side authorization | Confirmed enforced via `requireProjectRole()` against `team_members`/`app_role` on every mutating project route (Wave 1 item 2) | Maintain — already met | None found |
| Database-layer defense-in-depth (RLS) | ~24 tables have RLS enabled with **zero policies** — all access control is application-layer only (Step 1 Ledger #2, RAID I2) | Either real per-table RLS policies where anon/authenticated access is a legitimate path, or an explicit documented decision that service-role-only access makes policies unnecessary for a given table | Tracked as Step 6 item #13, not started |
| Leaked-password protection | Disabled — Supabase Free plan doesn't support it (confirmed via failed live save attempt this session) | Enabled, contingent on Pro plan upgrade | **Accepted risk** (RAID I1) — not an open action item |
| SECURITY DEFINER / search_path hygiene | Fixed live this session (Wave 1 item 5) — both flagged views now `security_invoker`, both functions have explicit `search_path` | Maintain — already met | None found |
| Credential storage | **One system**: `backend/src/integrationCredentialCrypto.js` (server-side AES-256-GCM). The client-side system was dead code and was deleted (commit `404a5d2a`, 2026-08-22) | One system, or an explicit documented reason for two — met | Resolved via Step 6 item #14 (2026-08-22) + #15 provider scoping (2026-08-27, GitHub/Jira wired, Confluence/GitLab/Slack are placeholders) |
| App-admin allowlist | Enforced via `ADMIN_EMAIL_ALLOWLIST` env var, tested this session (`auth.test.ts`, pending real execution) | Maintain | None found, pending test suite execution (RAID R2) |

## 5. Observability

| Requirement | Current | Target | Gap |
|---|---|---|---|
| Request tracing | `correlation_id` added across 7 governance/execution tables this session (migration 023, reconstructed and verified live); structured JSON request logging with correlation IDs already present in `server/src/index.ts` and `backend/src/proxy.js` | End-to-end traceability from HTTP request through to DB rows — schema now supports it; application-layer wiring to actually *populate* `correlation_id` on writes wasn't verified this session | New gap worth flagging: schema exists, but whether the application code actually sets `correlation_id` on every insert wasn't checked — recommend a quick audit before relying on it for incident response |
| Audit trail | `tool_call_audit_log` (migration 022) and `policy_decisions`/`memory_access_log` (016/017) all exist and are RLS-enabled service-role-only tables | Maintain | None found |
| Test/coverage visibility | CI runs `test:coverage` for frontend only; backend runs plain `jest` with **no coverage step**; `server/` had **zero** test infrastructure before this session (Wave 1 item 3, corrected from an earlier wrong "140 dead files" claim) | Your standing instruction: >95% coverage across the board | Large gap — frontend's actual % was never pulled from a live CI run (Step 1 Ledger #3, still open); backend has zero coverage enforcement; `server/` has exactly one test file so far. Tracked as Step 6 item #7, not started |

## 6. Maintainability

| Requirement | Current | Target | Gap |
|---|---|---|---|
| Migration history integrity | Continuous 000-023 as of this session (Wave 1 item 1), verified against live schema | Maintain — every future migration gets a real file, no more silent gaps | Process discipline going forward, not a code fix |
| Dead code | `server/src/routes/invites.ts` removed this session after confirming it was unreachable (Wave 1 item 6) | Maintain | None found this pass |
| Documentation currency | This program's own docs (`docs/architecture/step*-draft.md`) are current as of this session; `ARCHITECTURE.md` (dated 2026-07-14) was flagged earlier this program as describing a topology the live account doesn't match (Process Rule 4's origin) | `ARCHITECTURE.md` updated to match reality, or superseded explicitly by this program's docs | Not yet actioned — worth a follow-up item |

## 7. Compliance / Governance

| Requirement | Current | Target | Gap |
|---|---|---|---|
| AI governance decision trail | `policy_decisions`, `governance_decision`, `governance_finding`, `governance_override` tables all exist and are wired into the execution path (agent_jobs, lifecycle_events, agent_runs, chat_messages all carry `policy_decision_id` as of Wave 1 item 1) | Maintain | None found |
| Formal compliance framework (SOC 2, GDPR, etc.) | No specific framework referenced anywhere in this program's findings | Not yet scoped — no evidence this was ever a stated requirement | Flagging as an open question for you, not assuming either way: is there a target compliance framework this platform needs to meet, or is the governance tooling itself the requirement? |

---

## 8. Summary — where the real gaps are

Two things stood out as genuinely unresolved when this pass was written; both are now closed. **RLS policy coverage** (24+ tables with no DB-layer defense-in-depth) was resolved 2026-08-26 (Step 6 #13 — reviewed, confirmed RLS-enabled-zero-policy is the correct fail-closed state, and additionally revoked wide-open `anon`/`authenticated` grants and backfilled migration drift on 8 tables). **Credential storage duplication** was resolved 2026-08-22/27 (Step 6 #14/#15 — see the Credential storage row above). **Test coverage** (the standing >95% instruction, far from met in `backend/` and `server/`) remains the one genuinely open item from this NFR pass.

---

**Approval needed to proceed:** confirm this NFR set (or flag anything missing/wrong) before Step 9 (testing strategy) begins, per Process Rule 3.
