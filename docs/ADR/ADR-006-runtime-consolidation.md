# ADR-006: Resolving the Two-Backend Split (Finding #10)

**Status:** Partially resolved — all 5 routes built; frontend migration pending (Task #35, on hold)
**Date:** 2026-06-22
**Updated:** 2026-06-22
**Related:** ADR-001 (backend framework), ADR-002 (migration tooling), ADR-003 (database), ADR-004 (memory architecture), ADR-005 (action-type taxonomy)

## Context

The codebase currently runs two separate backend services:

- `backend/src/proxy.js` — the legacy Express/JS proxy (port 3001). Handles LLM calls, Figma/GitHub integrations, invites, and settings. This is the only backend the frontend actually talks to — confirmed by reading `frontend/src/services/api.ts` and `AppSettingsModal.tsx`, both of which default `API_URL` to `/api` (proxied to port 3001) with zero references anywhere in `frontend/src` to port 4000 or to `/api/v1/agent-runs` / `/api/v1/agent-jobs`.
- `backend/src/index.ts` + `routes/` + `repositories/` — the new TypeScript "Agent Runtime" (port 4000), backed by Postgres. This is the subject of ADR-001 through ADR-005.

This isn't just a "frontend hasn't been updated yet" gap. Reading the new runtime's own code shows it's also only partially built:

| Repository (data layer) | Lines | Exposed via a route? |
|---|---|---|
| `AgentRunRepository` | 109 | Yes — `/api/v1/agent-runs` |
| `AgentJobRepository` | 123 | Yes — `/api/v1/agent-jobs` |
| `ActionProposalRepository` | 103 | **Yes** — `/api/v1/action-proposals` (built 2026-06-22) |
| `MemoryRecordRepository` | 116 | **Yes** — `/api/v1/memory-records` (built 2026-06-22) |
| `RollbackLogRepository` | 55 | **Yes** — `/api/v1/rollback-logs` (built 2026-06-22) |

**Updated status (2026-06-22):** All 5 repositories now have routes, auth-gated with the same `requireApiToken` middleware. The runtime's API surface is complete. The remaining gap is the frontend migration: `frontend/src/services/api.ts` and all agent-run/job callers still point to port 3001 (proxy.js). This is tracked as Task #35 (on hold pending live Postgres smoke-test by the team).

## Options

**Option A — Migrate the frontend to the new runtime now.**
Point `api.ts` at port 4000 for agent-run/job concerns, keep `proxy.js` for what it's good at (LLM calls, Figma/GitHub, invites — none of which the new runtime has any code for at all). Pro: starts retiring the duplication immediately. Con: there's no memory/action-proposal/rollback API yet, so this only covers the smallest, least architecturally interesting slice of what the ADRs describe. You'd be integrating the part that matters least and leaving the part that matters most (governance, memory) un-started.

**Option B — Finish the runtime's API surface first, then migrate.**
Build routes for `ActionProposalRepository`, `MemoryRecordRepository`, `RollbackLogRepository` (matching the existing `agentRuns`/`agentJobs` route pattern, same auth middleware), then do the frontend migration in one pass once there's something architecturally complete to migrate to. Pro: avoids a half-migration that still requires a second migration later. Con: real new-feature work, not a "fix the finding" amount of effort — this is roughly 3 more route files plus whatever frontend UI would consume them (which doesn't exist yet either, since the frontend has no concept of "review an action proposal" or "view agent memory" today).

**Option C — Formally shelve the new runtime for now, document why.**
If the autonomous-agent governance model isn't on the near-term roadmap, the honest move is to say so in an ADR rather than let it sit half-built indefinitely, looking active. Pro: removes the "looks like 2 backends" confusion without committing more engineering time right now. Con: feels like giving up on real architectural thinking that's already been done (the ADRs are genuinely good).

## Recommendation

I'd lean toward **Option A for the slice that's actually finished, paired with explicitly deferring the rest** — i.e., migrate `agent-runs`/`agent-jobs` to the new runtime now (it's a small, mechanical frontend change and the routes already work and are now auth-gated), but don't present that as "Finding #10 resolved." The memory/action-proposal/rollback gap is a real, separate scope decision, not a bug to fix — and I don't think I should pick Option B vs. C on your behalf, since that's a call about whether the autonomous-agent governance work is still a near-term priority, which is a product/roadmap question, not a code question.

## Current Status (2026-06-22)

**Option B was implemented:** All three missing route files (`actionProposals.ts`, `memoryRecords.ts`, `rollbackLogs.ts`) have been built and mounted in `index.ts`. The runtime API surface is now complete across all 5 planned capabilities.

The next action is the frontend migration (Task #35): point `api.ts` at port 4000 for agent-run/job/action-proposal/memory-record/rollback-log concerns. This is on hold until the team has confirmed the new routes work against live Postgres in their environment. Once smoke-tested, Task #35 can proceed as a mechanical frontend change — no further architectural decisions required.
