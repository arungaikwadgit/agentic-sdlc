# Execution Status — 2026-08-24

Continues `docs/architecture/execution-status-2026-08-23.md` (same convention: update this record as items close rather than re-deriving status from git log or memory each session). Today added a "Learnings" section that the prior file didn't have — running list of process lessons, not just item status, per explicit user request.

---

## 0. Summary — completed vs. remaining

**Completed today (7):**

1. Restored `proxy.js` after it was silently taken down (incident response)
2. Runtime-service split — `agentic-sdlc-runtime` provisioned for `index.ts`, matching ADR-006
3. `#5 Phase 2` (GitHub half) — `get_github_activity` chat tool, live and verified
4. `#23` Jira credential connect/test/disconnect UI (scoped — chat tool + issue push deferred)
5. Production smoke-test CI (`production-smoke-test.yml`) — closes the post-deploy verification gap
6. Continuous uptime monitoring — 4 UptimeRobot monitors, user-configured — closes the between-deploys gap
7. `docs/ARCHITECTURE.md` + this ledger updated with before/after comparisons for all three gaps above

**Remaining (10, none started or scheduled by the user yet — see Section 3 for full detail):**

| # | Item | Why it's still open |
|---|---|---|
| #8 | Background lifecycle worker decision | Flagged unclear last pass — not independently re-verified. **Picking this up next, below.** |
| #7 | CI coverage gap, backend + server | Not started |
| #12 | Supabase backup/PITR posture decision | Not started — it's a decision, not code |
| #13 | RLS policy per-table review | Not started |
| #15 | Integration provider scoping | Unblocked (was waiting on #14), not started |
| #16 | Eval scorers, heuristic → LLM-judge | Not started |
| #17 | Load/performance testing expansion | Not started |
| #21 | UI component structural inventory | Not started |
| #5 Phases 4-6 | RAG grounding, remaining phases | Not started |
| Jira full scope | Chat tool + issue-creation parity with GitHub | Explicitly deferred per your decision — logged as its own future item |

## 1. Gap → fix → benefit (today's three architecture gaps)

| Gap | How it was fixed | Benefit |
|---|---|---|
| **Runtime API unreachable in production.** `proxy.js` and `index.ts` shared one Railway service that can only run one process. Whichever deployed last silently killed the other — true since `index.ts` was first deployed, over two months before caught. `#4` (pgvector) and `#5 Phase 3` (Token Optimizer citations) had been "done and tested" for weeks without ever being reachable. | Provisioned a dedicated second Railway service, `agentic-sdlc-runtime`, for `index.ts` — matching ADR-006's original (never-implemented) two-service design. No code changes; pure infra. Verified live via direct curl on both services, not just deploy status. | pgvector search and Token Optimizer citations are now actually reachable, not just built. The two services can no longer compete for one process slot, so a future `index.ts` deploy can't silently take down `proxy.js` (or vice versa) again. |
| **No post-deploy verification.** `ci.yml` only typechecks and runs unit tests — it never calls a live URL, so it structurally could not have caught the incident above. Railway deploys on every push to `main` regardless of CI result. | Added `scripts/smokeTestProduction.js` + `.github/workflows/production-smoke-test.yml`, running after every push to `main`. 5 checks assert on actual response *shape* (not just HTTP 200) across all 3 backend services — including the exact `model`-field check that would have caught today's incident in ~1 minute instead of ~90. Auto-files a `production-incident` GitHub Issue on failure, auto-closes it on recovery. | A bad deploy is now surfaced automatically within minutes, with a tracked issue and no manual "did anyone check?" step. Can't block a bad deploy (Railway deploys independently of CI), but it catches one fast. |
| **No monitoring between deploys.** A service could go down hours or days after a clean deploy — dependency outage, resource limits, unrelated infra failure — with zero automated signal. This is the exact gap that let `#4`/`#5 Phase 3` sit broken for weeks with no pushes in that window. | 4 UptimeRobot monitors, user-configured: frontend (Vercel) + all 3 backend services (`agentic-sdlc` `/api/health`, `agentic-sdlc-runtime` `/ready`, `artistic-charm` `/health`). Runs independent of git activity. | Closes the one blind spot the smoke test structurally can't cover — drift with no corresponding push. Together, the two form a two-layer safety net: push-triggered shape check + always-on external monitor. |

---

## 2. Completed today — detail

| Item | What | Commit(s) | Status |
|---|---|---|---|
| #5 Phase 2 (GitHub half) | `get_github_activity` chat tool — read-only issues/PRs for a project's connected GitHub repo | `92212630` | Done, verified live (deploy `2c05e6c0`, 16:34 UTC). App-admin gated (see commit message for the access-control reasoning). Jira half deferred — see Section 3. |
| Incident response | Restored `proxy.js` as `agentic-sdlc`'s live process after an earlier fix silently took it down | `6e7a80996` | Done, verified live (deploy `982e0a2d`, 14:40 UTC). See Section 2 for full detail — this is the most important thing in this file. |
| Memory hygiene | Saved two feedback memories + updated the `agentic-sdlc-project` memory with current worktree path, service topology, and the two-entrypoint gap | — (memory files, not repo commits) | Done. See Section 4. |
| Runtime-service split | Provisioned `agentic-sdlc-runtime`, a dedicated Railway service for `index.ts`, matching ADR-006 | `d718efe1` (config file) + Railway MCP (service creation/wiring, no commit) | Done, verified live. See Section 2. |
| #23 (Jira, scoped) | Jira credential connect/test/disconnect UI — no chat tool, no issue push (deferred, see Section 3) | `9ae5adf6` | Done, verified via tests (11/11, `jiraIntegration.test.ts`) and a regression run of `ProjectSettings-team.test.tsx` (15/15). Not yet verified against a real Jira Cloud instance — the `/rest/api/3/*` calls are correct per Atlassian's documented API shape but untested against production Jira. |

All commits authored as `arungaikwadgit <arun.gaikwad@outlook.com>`.

---

## 3. Production architecture — before / after

### Before today (and, it turns out, before this whole remediation program — see ADR-006, dated 2026-06-22)

The **documented and originally-intended** architecture (`docs/ARCHITECTURE.md`, ADR-006) is three separate backend services:

```
Frontend (Vercel)
  ├──> proxy.js         (port 3001 locally / Railway service "agentic-sdlc")
  │      chat, LLM proxy, GitHub push, app-state, governance, feedback, invites
  ├──> server/src        (Railway service "artistic-charm")
  │      authenticated project/admin API, team_members RBAC
  └──> index.ts          (port 4000 locally / intended as its own Railway service)
         agent-runs, agent-jobs, memory-records, pgvector similarity search,
         action-proposals, rollback-logs, /health, /ready
```

**What was actually deployed, discovered today:** `proxy.js` and `index.ts` were both pointed at the *same single* Railway service (`agentic-sdlc`), which can only run one `startCommand` at a time. Nobody had provisioned the second service ADR-006 calls for. This means:

- Whichever one deployed most recently is the only one reachable — the other silently 404s.
- This wasn't a new bug from today's session — it's been true since whenever `index.ts` was first deployed to this service (unclear exactly when; ADR-006 is dated 2026-06-22, over two months before this was caught). Item #4 (pgvector) and item #5 Phase 3 (Token Optimizer citations) were built, tested, and marked "done" earlier in this program without anyone verifying they were reachable in production — because they weren't.
- Earlier today, fixing that specific problem (pointing the service's Railway Config File at `backend/railway.json` with `startCommand: npm run runtime:start`) made `index.ts` reachable for the first time — and silently took `proxy.js` down instead, breaking chat, LLM proxying, GitHub push, app-state, governance, and feedback capture for roughly 90 minutes before it was caught (again, not via monitoring — via the user asking an unrelated question that prompted a direct check).
- Rolled back the same day (`6e7a80996`, verified live) — `proxy.js` is the live process again. `index.ts`'s entire route surface (`/ready`, `/api/v1/agent-runs`, `/api/v1/memory-records/similar`, etc.) is unreachable again as of this writing, confirmed via direct curl at 2026-08-24T16:4x UTC.

### After (target, in progress — task in this session)

Provision a genuinely separate Railway service for `index.ts`, matching ADR-006's original design:

```
Frontend (Vercel)
  ├──> proxy.js          Railway service "agentic-sdlc"    (unchanged, restored)
  ├──> server/src         Railway service "artistic-charm"  (unchanged)
  └──> index.ts           Railway service "agentic-sdlc-runtime" (NEW)
         Same build (runtime:build) / start (runtime:start) / healthcheck (/ready)
         values currently sitting in backend/railway.json, now on their own service
         instead of competing with proxy.js for agentic-sdlc's one process slot.
```

No code changes to either app — this was purely an infrastructure fix.

**Status: Done, verified live.** New Railway service `agentic-sdlc-runtime` (`agentic-sdlc-runtime-production.up.railway.app`), backed by `backend/railway.runtime.json` (separate file from `agentic-sdlc`'s `backend/railway.json` — see execution notes in that file's commit message for why). Verified via direct curl, not just deploy status: `/ready` → `{"status":"ready","db":"connected"}`, `/api/v1/agent-runs` → `401 Unauthorized` (route exists, auth middleware working — not a 404). Re-verified `agentic-sdlc` (proxy.js) was still unaffected immediately after (`/api/health` 200, `/api/chat/respond` still its own 401, not index.ts's generic 404) — applying the lesson from Section 4 item 1 to this exact fix.

Wired `RUNTIME_API_URL` to the new service's URL on both `agentic-sdlc` (`proxy.js`'s lifecycle-event forwarding — was dormant, this var was never set) and `artistic-charm` (`semanticMemory.ts`'s `fetchSemanticEvidence()` — this is what makes pgvector-grounded Token Optimizer citations actually fire in production instead of silently falling back). `RUNTIME_API_TOKEN_INTERNAL` set on `artistic-charm` via Railway's `${{agentic-sdlc.RUNTIME_API_TOKEN_INTERNAL}}` reference syntax, and on the new service the same way — never saw the actual secret value. Both dependent services (`agentic-sdlc`, `artistic-charm`) redeployed cleanly and re-verified healthy after the variable change.

Not done / explicitly out of scope for this pass: frontend migration to call `index.ts`'s routes directly (ADR-006's "Task #35") — was already on hold pending a live-Postgres smoke test the team hadn't done; this fix finally makes that smoke test possible, but doesn't do it. `docs/ARCHITECTURE.md` updated to reflect this as the actual (not aspirational) deployed state.

### Deploy verification & monitoring — before / after

Same before/after treatment, now also covering the two gaps found downstream of the runtime-service fix above (how would we have caught this sooner, and how do we catch the next one). Full comparison table lives in `docs/ARCHITECTURE.md` under "Deploy Verification & Monitoring — Before / After (2026-08-24)" since that's the permanent architecture record; summarized here for the day's ledger:

- **Post-deploy verification:** before, none (`ci.yml` never touches a live URL) → after, `scripts/smokeTestProduction.js` + `.github/workflows/production-smoke-test.yml` (`fa4e7281`), checks real response shape on every push to `main`, auto-files/closes a `production-incident` GitHub Issue.
- **Continuous monitoring:** before, none → after, 4 UptimeRobot monitors (frontend + 3 backends), independent of git pushes. See Section 3 below for the exact monitor list.

---

## 4. Backlog — reconciled against `step6-prioritization-matrix-draft.md`'s 14 items

That doc scored 14 remaining items as of its own writing (after Wave 1 closed 8). Status now:

| Item | Description | Status |
|---|---|---|
| #4 | Vector search / embeddings (pgvector) | Code done, but **production-unreachable** until the runtime-service split above lands — see Section 2 |
| #5 | RAG grounding for 32 pipeline agents | Phase 1 done, Phase 3 (Token Optimizer pilot) done, Phase 2 GitHub half done today, Phase 2 Jira half **rescoped to credential-UI-only, deferred chat tool** (see below), Phases 4-6 not started |
| #7 | CI coverage gap, backend + server | Not started |
| #8 | Background lifecycle worker decision | **Status unclear — not verified this pass.** `BACKGROUND_WORKER_ENABLED` env var exists and `index.ts` calls `startLifecycleWorker`/`startScheduledLifecycleReviews`, suggesting a decision was made and implemented, but not independently re-confirmed here. Verify before assuming resolved. |
| #12 | Supabase backup/PITR posture decision | Not started (it's a decision, not code) |
| #13 | RLS policy per-table review | Not started |
| #14 | Integration credential storage duplication | Done (this program, prior session) |
| #15 | Integration provider scoping | Not started — was blocked on #14, now unblocked |
| #16 | Eval scorers, heuristic → LLM-judge | Not started |
| #17 | Load/performance testing expansion | Not started |
| #18 | User feedback capture | Done |
| #20 | Sidebar "already run" status re-check | Done (closed as already-fixed) |
| #21 | UI component structural inventory | Not started |
| #22 | Agent count correction, 30→32 | Done |

**New items discovered this program, not on the original 14:**

- **Runtime-service split** (Section 2) — not originally scored since nobody knew about the gap until today. Given it's the reason two other "done" items (#4, #5 Phase 3) aren't actually live, this should probably be scored **High value / Low-Medium effort** once the matrix gets revisited — it's pure infra provisioning, no design risk, and it unblocks real user-facing value that's already built.
- **Jira integration — full scope** (extensive: chat tool mirroring `get_github_activity` + issue-creation parity with GitHub's push feature) — explicitly logged as its own future backlog item per today's decision. Credential connect/test/disconnect UI shipped today (`9ae5adf6`); the read/write feature layer on top of it is what's deferred.
- **CI/deploy verification gap — closed.** `scripts/smokeTestProduction.js` + `.github/workflows/production-smoke-test.yml` (`fa4e7281`), runs after every push to main. Checks all 3 production Railway services' actual live response shape (not just deploy status) — the `agentic-sdlc` check specifically asserts on the `model` field that distinguishes proxy.js from index.ts, the exact signal that would have caught today's first incident within a minute instead of ~90. On failure, opens (or comments on, if one's already open) a GitHub Issue labeled `production-incident`; auto-closes it on the next passing run. Can't block a bad deploy (Railway deploys independent of this workflow's result) — detects, doesn't prevent. Continuous monitoring between deploys (UptimeRobot) is a separate, user-driven follow-up — see below.
- **Continuous uptime monitoring — done (user-configured).** UptimeRobot, 4 monitors set up by the user: "Agentic SDLC App" (frontend/Vercel — a useful addition beyond what I'd scoped, covers the actual user-facing surface, not just the 3 backends), "Agentic SDLC Railway API Health" (`agentic-sdlc` /api/health), "Agentic SDLC Railway ArtisticCharm Health" (`artistic-charm` /health), "Agentic SDLC Railway App Ready" (`agentic-sdlc-runtime` /ready). Exact URLs/monitor IDs not independently verified here (configured directly in UptimeRobot's UI, outside what I can inspect) — recorded from the names as given. This closes the "catches drift between deploys" gap the smoke test above structurally can't cover — the actual failure mode behind item #4/#5 Phase 3 sitting broken for weeks with zero pushes in that window.

---

## 5. Learnings (running list)

Full detail lives in the memory system (`railway-multi-entrypoint-verification.md`, `check-file-exists-before-write.md`) so these persist across sessions. Summarized here so they're visible in-repo too:

1. **Before changing what process/entrypoint a service runs, inventory everything the CURRENT process serves, and verify all of it — not just the target fix — after the change deploys.** A green healthcheck only proves the new process boots; it proves nothing about what stopped running. This is what caused today's proxy.js outage.
2. **Before using Write on a path that could plausibly already exist, check the exact filename first (Glob or Read), not a broader pattern that might miss it.** A `.test.js` search missed a real `.test.ts` file, and Write silently overwrote 183 lines of real test coverage without erroring. Caught via `git status` showing "modified" instead of "untracked" — check that after any Write to a path you weren't 100% sure was new.
3. **"Done" and "tests pass" don't mean "reachable in production."** Item #4 and #5 Phase 3 were both marked done and test-verified weeks ago, but were never actually reachable at their production URL because of the entrypoint-split gap above. Verification steps for infra-touching work should include hitting the actual production URL, not just running the test suite.
4. **When a decision record already exists (ADR-*, prior architecture docs), check it before proposing a fix from first principles.** My first instinct for the entrypoint problem was "merge the two processes into one" — a bigger, riskier change that would have gone against ADR-006's already-documented (and never-implemented) two-service design. Reading the ADR first led to a smaller, lower-risk, architecturally-correct fix.

---

## 6. Next step

All items started today are done, including both follow-on gaps (CI/deploy verification, continuous monitoring) that were discovered mid-session rather than planned upfront. Picking up **#8 (background lifecycle worker decision)** next — it's the one remaining item flagged "unclear" rather than confirmed, and it's a direct extension of today's theme (things marked "done" that were never independently re-verified against what's actually running in production). Investigation only for now: confirming whether `BACKGROUND_WORKER_ENABLED` is actually set on the runtime service in production and whether the worker is running, not making a design decision. Will report back with findings before touching any code.
