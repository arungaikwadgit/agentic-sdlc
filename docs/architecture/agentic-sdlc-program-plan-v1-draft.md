# Agentic SDLC Enterprise-Readiness Program — Revised Execution Plan

**Status:** Draft for approval. No code has been changed. This document is the plan-before-the-plan you asked for — it governs how Steps 1-20 of the original request get executed, not the component specs themselves.

**Baseline:** verified against `main` (commit `1fb7758d`) via direct code/schema/config checks, not the generic template diagram originally shared. The corrected architecture diagram delivered earlier in this conversation is the visual companion to this document — do not use the original template diagram for any decision going forward.

---

## 1. Verification Ledger — closing the four open gaps

| # | Item | Status | Finding |
|---|---|---|---|
| 1 | Is the background lifecycle worker (Token Optimizer / AI Governance async runs) actually on in production? | **Closed** | No. `BACKGROUND_WORKER_ENABLED` does not appear anywhere in the live Railway service's variable list (33 variables enumerated, checked directly). The code path exists; it is not switched on. |
| 2 | Supabase encryption/backup posture | **Closed** | The "hibernated" error was real, not a bug: the Supabase org is on the **free plan** (confirmed via `get_organization`), and free-tier projects auto-pause on inactivity. Once woken, both `list_extensions` and `get_advisors` returned clean data. Extensions installed: `pgcrypto`, `supabase_vault`, `pg_stat_statements`, `uuid-ossp`, `plpgsql` — no `pgvector`, reconfirming the earlier finding from a second angle. Security advisor found: (a) ~24 tables have RLS enabled with zero policies attached, meaning all app access control is enforced in application code only, zero DB-layer defense-in-depth; (b) two SECURITY DEFINER views (`agent_token_usage_summary`, `agent_token_usage`) flagged ERROR; (c) leaked-password protection disabled on Supabase Auth; (d) two functions with mutable search_path. Backup/DR: free-tier Supabase does not include point-in-time recovery (published platform policy, not a direct query result — stated as high-confidence inference from the plan tier). **Also found and fixed in the process:** `public._claude_backup_2026_08_07` (the pre-reset snapshot table created earlier this session) had RLS disabled and was publicly exposed — an ERROR-level finding I introduced myself. Locked down via `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` per your explicit go-ahead; re-ran the advisor and confirmed the ERROR is gone, data intact. |
| 3 | Real test coverage % | **Blocked, not closed** | `npx vitest run --coverage` on the frontend suite did not finish inside this session's tool-call time ceiling (~170s) — the full suite alone takes longer than that even without coverage instrumentation. CI (`npm run test:coverage`) runs this on every push, so the number exists — it's just not obtainable from an ad hoc sandbox run. Action: pull the last CI run's coverage artifact instead of re-running locally. |
| 4 | User feedback loop absence | **Closed** | Confirmed by grep with zero hits across `*.ts`/`*.js` for thumbs/rating/feedback capture patterns. Absence-of-evidence, but a clean negative. |

**New finding surfaced while closing #1, not previously flagged:** the live Railway variable list for the single deployed service (`agentic-sdlc`, project `steadfast-flexibility`) includes `SERVER_API_URL`, implying the frontend/proxy expects to reach a separate Project/Admin API (`server/src`, per `ARCHITECTURE.md`'s documented 3-service split: proxy / project-admin API / runtime API). But `list-services` on that Railway project returns **exactly one service** — there is no second deployed service visible for `server/src` or `backend/src/index.ts` (the Runtime API) anywhere in the two Railway projects checked. Either:
- `server/src` and the Runtime API are not actually deployed anywhere reachable, and `SERVER_API_URL` points at a dead or unconfigured URL, or
- they're deployed somewhere not visible to the Railway MCP connection used this session (a third Railway project/workspace, or hosted outside Railway entirely).

**This is now a P0 open question, not a documentation nitpick.** If `server/src` (authenticated project CRUD, app-admin checks) isn't actually reachable in production, that changes the current-state classification of Identity/RBAC, project persistence, and admin-panel functionality from green to at minimum "requires verification" — and it means part of what this session already fixed and pushed may not even be the code path serving real traffic. **This must be resolved before Step 1's baseline table is finalized**, because Step 1 asks for evidence-backed status, and this is exactly the kind of thing Step 1 exists to catch.

---

## 2. Process rules for the rest of the program

These apply to every wave, every component spec, every future response in this program — not just this document.

### Rule 1 — Accuracy gate between every step
No step (1 through 20) is presented as final until it passes three checks:
1. **Cited** — every status claim links to a specific file path, table name, config value, or test name (as done in the corrected diagram).
2. **Cross-checked** — where a claim depends on production state (env vars, deployment topology, live data), it's checked against the actual running system (Railway/Vercel/Supabase), not just the repo — exactly what surfaced the `SERVER_API_URL` gap above.
3. **Flagged, not guessed** — anything that can't be verified within the current tooling is marked "requires verification" with an explicit reason and a concrete next action, never silently assumed either way.

### Rule 2 — Dependency/risk resolution precedes implementation, per component, not once globally
For every component in Step 6 (all 60-80+ of them), before any implementation task is opened:
1. Its upstream dependencies (Step 7 dependency matrix) must all be either already implemented, or explicitly sequenced earlier in the wave plan with no circular wait.
2. Its top risks (Step 11 risk register) must each have a stated mitigation, a contingency, or an explicit accepted-risk sign-off — "unaddressed" is not a valid state to start coding from.
3. If a dependency or risk cannot be resolved or mitigated, the component is marked **Blocked** in the wave plan and excluded from that wave's implementation tasks until it's unblocked — it does not get deprioritized and coded anyway.

Each Step 6 spec will carry a **Pre-Implementation Gate** subsection (a 22nd field, extending the requested 21-part template) that must show green before task breakdown is actionable.

### Rule 3 — No code changes without an explicit go
Everything through Step 20 is planning and specification. No application code gets created or modified as part of this program until there is separate, explicit approval to move from "plan" to "implement" for a specific wave or component — matching how this session's actual code fixes (the gate-ordering bug) were only made after an explicit "yes."

### Rule 4 — Re-verify before reuse
Given this session already found one architecture doc (`ARCHITECTURE.md`, dated 2026-07-14) describing a 3-service topology that the live Railway account doesn't obviously match, no existing doc in `docs/` gets treated as current truth without a live spot-check. Docs are a starting hypothesis, not evidence.

---

## 3. Immediate next actions (before Step 1 is generated)

In order:

1. **Resolve the `SERVER_API_URL` / deployment-topology question.** Check the redacted variable's shape indirectly (test the URL's health endpoint if reachable from the sandbox, check for a third Railway project/workspace, check Vercel for any serverless functions standing in for `server/src`) before writing Step 1's row for Identity, Project CRUD, and Admin API.
2. **Pull real coverage numbers from the last CI run** instead of re-running locally, so Step 1's Testing row and the later 90%-coverage NFR are grounded in an actual number, not an assumption.
3. **Retry the Supabase advisor check** once, and if still blocked, mark Data Privacy & Encryption as "requires verification" in Step 1 rather than inferring it from `integrationCredentialCrypto.js` alone (that only covers integration credentials, not the database's own posture).
4. Only then generate **Step 1's full baseline matrix** (Component / Current Status / Current Capability / Gap / Evidence Needed / Production Impact) as a standalone deliverable, held for review before Steps 2-20 (the 60-80 full component specs) begin.

---

## 4. What this changes about scope, stated plainly

The plan is still full 21-section specs on every missing/partial component. Two things follow from the rules above that are worth saying now rather than discovering later:

- **Some components can't get a real spec yet.** If the deployment-topology question resolves to "the Project/Admin API isn't actually reachable in production," then any component whose spec assumes that API exists as a foundation (RBAC extensions, project-scoped governance, several Security-layer items) needs that resolved first — their Step 6 spec would otherwise be built on an unverified foundation, which is exactly what Rule 2 exists to prevent.
- **This will take more tool calls and more turns than a single response, by design.** 60-80 fully-cited 21-section specs, each gated on dependency/risk resolution, is a multi-session program, not a single document. The task list tracks where the program is so nothing gets silently dropped.

---

**Approval needed to proceed:** confirm this plan structure (Sections 2-3 especially), then the four immediate next actions in Section 3 get executed, followed by Step 1's baseline matrix for review before Steps 2 onward.
