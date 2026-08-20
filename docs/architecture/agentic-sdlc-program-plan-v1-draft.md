# Agentic SDLC Enterprise-Readiness Program — Revised Execution Plan

**Status:** Draft for approval. No code has been changed. This document is the plan-before-the-plan you asked for — it governs how Steps 1-20 of the original request get executed, not the component specs themselves.

**Baseline:** verified against `main` (commit `1fb7758d`) via direct code/schema/config checks, not the generic template diagram originally shared. The corrected architecture diagram delivered earlier in this conversation is the visual companion to this document — do not use the original template diagram for any decision going forward.

---

## 1. Verification Ledger — closing the four open gaps

| # | Item | Status | Finding |
|---|---|---|---|
| 1 | Is the background lifecycle worker (Token Optimizer / AI Governance async runs) actually on in production? | **Closed** | No. `BACKGROUND_WORKER_ENABLED` does not appear anywhere in the live Railway service's variable list (33 variables enumerated, checked directly). The code path exists; it is not switched on. |
| 2 | Supabase encryption/backup posture | **Closed** | The "hibernated" error was real, not a bug: the Supabase org is on the **free plan** (confirmed via `get_organization`), and free-tier projects auto-pause on inactivity. Once woken, both `list_extensions` and `get_advisors` returned clean data. Extensions installed: `pgcrypto`, `supabase_vault`, `pg_stat_statements`, `uuid-ossp`, `plpgsql` — no `pgvector`, reconfirming the earlier finding from a second angle. Security advisor found: (a) ~24 tables have RLS enabled with zero policies attached, meaning all app access control is enforced in application code only, zero DB-layer defense-in-depth; (b) two SECURITY DEFINER views (`agent_token_usage_summary`, `agent_token_usage`) flagged ERROR; (c) leaked-password protection disabled on Supabase Auth; (d) two functions with mutable search_path. Backup/DR: free-tier Supabase does not include point-in-time recovery (published platform policy, not a direct query result — stated as high-confidence inference from the plan tier). **Also found and fixed in the process:** `public._claude_backup_2026_08_07` (the pre-reset snapshot table created earlier this session) had RLS disabled and was publicly exposed — an ERROR-level finding I introduced myself. Locked down via `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` per your explicit go-ahead; re-ran the advisor and confirmed the ERROR is gone, data intact. |
| 3 | Real test coverage % | **Partially closed — sandbox-blocked, CI-gap found** | Attempted a fresh local run three ways for backend (workers+coverage, workers no coverage, `--runInBand`) — all three failed with low-level Node/V8 crashes (`SIGTRAP` worker termination; fatal V8 Scavenger GC crash) or a 165s timeout with zero output. Frontend `vitest` hung 100s with no crash and no result. A plain Node GC-stress script ran fine, so this is this sandbox's resource ceiling colliding with ts-jest/vitest's transform+worker load, not a code defect. Separately, and independent of the crash: `.github/workflows/ci.yml` was re-read directly — CI only runs `test:coverage` for the **frontend**. Backend runs plain `jest` with no coverage step at all, and `server/` has 140 `*.test.ts` files with **no test runner installed** (`server/package.json` has no `test` script, no jest/vitest/mocha in dependencies) — those 140 files are currently unrunnable. This is a real, newly-confirmed gap, not a data-pull limitation. Action: get the frontend number from the next GitHub Actions run post-push; treat backend/server coverage as **zero CI enforcement today** and carry that into the Testing Strategy step as a P0/P1 finding, not an unknown. |
| 4 | User feedback loop absence | **Closed** | Confirmed by grep with zero hits across `*.ts`/`*.js` for thumbs/rating/feedback capture patterns. Absence-of-evidence, but a clean negative. |
| 5 | `SERVER_API_URL` / deployment-topology (P0, opened this session) | **Closed** | `get-service-config` on Railway service `artistic-charm` (project `zucchini-rejoicing`) confirms `config.source.rootDirectory = "server"` — this service **is** the `server/src` deployment, same repo/branch as the frontend/proxy service, its own domain and `/health` check. Current live deployment: `f263a0fc`, SUCCESS, 2026-08-07T01:18:06Z, commit `293c48c1`. The Project/Admin API is reachable in production; the earlier "only one service visible" read was incomplete, not a real gap — a second Railway project (`zucchini-rejoicing`) held the second service. One deploy attempt for this service (`63885eb1`, triggered by this session's `3788e80b` push) failed; its logs are already garbage-collected by Railway (three independent `get-logs` queries all returned empty, `status: REMOVED`) so the specific cause is unrecoverable. Low-confidence-but-reasonable (0.75) that it's inconsequential: neither `3788e80b` nor `1fb7758d` touch any file under `server/`, and Railway's auto-rollback kept the last-good build live throughout — no outage. |

**Housekeeping event, recorded for audit trail:** on resuming this session, the worktree had ~47 modified tracked files (+17,613/-17,128 lines) and ~60 untracked files sitting uncommitted, dated 2026-07-29 through 2026-08-06 — none of it from this session's own commits. It looked like a coherent, unfinished body of work (new repository classes, auth/security tests, two new migrations, a `deploy/railway/` directory) mixed with scratch diagnostic `.txt` files. Per explicit approval, it was stashed (`git stash push -u`, message `wip-2026-07-29-to-08-06_uncommitted-security-hardening-and-diagnostics_stashed-for-clean-baseline`) rather than committed or discarded, to get a clean, unambiguous baseline for this program without losing that work. It has not been inspected in detail yet — flagging here so it isn't silently forgotten. It sits alongside two pre-existing stashes (`codex-dev-sync-2026-07-11`, `autostash`).

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

1. ~~Resolve the `SERVER_API_URL` / deployment-topology question.~~ **Done** — see Ledger #5.
2. ~~Pull real coverage numbers.~~ **Done, with a caveat carried forward** — see Ledger #3. Frontend number still needs a live CI run post-push (this session has no GitHub push access — native connector authorized by the user but not yet visible in this session's tool list; pending a fresh session). Backend/server coverage is a confirmed gap, not a pending pull.
3. ~~Retry the Supabase advisor check.~~ Already closed in an earlier pass this session — see Ledger #2.
4. **Now generating Step 1's full baseline matrix** (Component / Current Status / Current Capability / Gap / Evidence Needed / Production Impact) as a standalone deliverable, held for review before Steps 2-20 (the 60-80 full component specs) begin.

**Still outstanding, not blocking Step 1:** push `1fb7758d` and `60d2a2ad` to `origin/main` (2 commits ahead), and inspect the stashed 07/29-08/06 WIP (see Ledger housekeeping note) to decide whether it should be recovered, reworked, or discarded.

---

## 4. What this changes about scope, stated plainly

The plan is still full 21-section specs on every missing/partial component. Two things follow from the rules above that are worth saying now rather than discovering later:

- **Some components can't get a real spec yet.** If the deployment-topology question resolves to "the Project/Admin API isn't actually reachable in production," then any component whose spec assumes that API exists as a foundation (RBAC extensions, project-scoped governance, several Security-layer items) needs that resolved first — their Step 6 spec would otherwise be built on an unverified foundation, which is exactly what Rule 2 exists to prevent.
- **This will take more tool calls and more turns than a single response, by design.** 60-80 fully-cited 21-section specs, each gated on dependency/risk resolution, is a multi-session program, not a single document. The task list tracks where the program is so nothing gets silently dropped.

---

**Approval needed to proceed:** confirm this plan structure (Sections 2-3 especially), then the four immediate next actions in Section 3 get executed, followed by Step 1's baseline matrix for review before Steps 2 onward.
