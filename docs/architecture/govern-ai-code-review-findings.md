# AI Governance MVP-0 — Code Review Findings (running list)

Source: `engineering:code-review` skill pass on commits `a132855f`, `2b2fb178`, `5278fa68` (already merged to `main` and deployed), 2026-07-22.

Status legend: 🔴 Open · 🟡 Fixed, unverified (code changed, tests not yet confirmed passing) · ✅ Fixed & verified

## Critical

| # | File | Issue | Status |
|---|------|-------|--------|
| 1 | `backend/src/routes/governance.js` | `POST /:projectId/decision` had no project-scoping check — any authenticated user could forge a decision for any project. | ✅ Fixed & verified — `authorizeGovernanceProjectAccess` added (any project role or admin). 98/98 tests passing, confirmed 2026-07-22. |
| 2 | `backend/src/routes/governance.js` | `GET /:projectId` and `/history` had no project-scoping check — any authenticated user could read any project's governance data. | ✅ Fixed & verified — same check added to both routes. 98/98 tests passing, confirmed 2026-07-22. |

## High

| # | File | Issue | Status |
|---|------|-------|--------|
| 3 | `backend/src/routes/governance.js` | `POST /:projectId/decision`'s multi-step write (decision insert, findings upsert, stale-finding resolution, backlog auto-create) ran as unwrapped sequential queries — a mid-sequence failure left inconsistent state. | ✅ Fixed & verified — wrapped in a transaction on a dedicated client (`BEGIN`/`COMMIT`/`ROLLBACK`). Rollback test confirmed passing 2026-07-22. |

## Suggestions

| # | File | Issue | Status |
|---|------|-------|--------|
| 4 | `backend/src/routes/governance.js` | `confidence` had no bounds/NaN validation before insert. | ✅ Fixed & verified — rejects non-finite or out-of-0–100-range values with a 400. Confirmed passing 2026-07-22. |
| 5 | `backend/src/routes/governance.js` | Per-finding upsert is one query per finding (N+1-shaped). Fine at current scale. | 🔴 Open — deferred, not addressed this pass. |
| 6 | `backend/migrations/013_ai_governance_mvp.sql` | `governance_finding.backlog_item_id` is a TEXT reference, not a real FK — no referential integrity. | 🔴 Open — deferred, acknowledged in the migration's own comment. |
| 7 | `frontend/src/components/admin/GovernanceTab.tsx` | Cross-project table uses an N+1 fetch pattern (one call per project). | 🔴 Open — deferred, self-documented as an accepted MVP-0 tradeoff. |
| 8 | `backend/src/proxy.js` | Kill-switch check in `authorizeAgentRun` fails open on a DB error (deliberate design choice). | 🔴 Open — not a bug, flagged for risk-owner confirmation only. |

## Verification note (2026-07-22)

Findings #1–4 are fixed and verified: `tsc --noEmit` in `backend/` clean (exit 0), and `npx jest governance.test.ts --verbose` run on the user's machine — 2 suites, 98/98 tests passing, including every new test added for these fixes. Confirmed 2026-07-22.

Remaining open items (#5–8) are deferred, not blocking — see table above for each.
