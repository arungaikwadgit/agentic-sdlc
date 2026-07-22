# AI Governance MVP-0 — Code Review Findings (running list)

Source: `engineering:code-review` skill pass on commits `a132855f`, `2b2fb178`, `5278fa68` (already merged to `main` and deployed), 2026-07-22.

Status legend: 🔴 Open · 🟡 Fixed, unverified (code changed, tests not yet confirmed passing) · ✅ Fixed & verified

## Critical

| # | File | Issue | Status |
|---|------|-------|--------|
| 1 | `backend/src/routes/governance.js` | `POST /:projectId/decision` had no project-scoping check — any authenticated user could forge a decision for any project. | ✅ Fixed & verified — `authorizeGovernanceProjectAccess` added (any project role or admin). 98/98 tests passing, confirmed 2026-07-22. |
| 2 | `backend/src/routes/governance.js` | `GET /:projectId` and `/history` had no project-scoping check — any authenticated user could read any project's governance data. | ✅ Fixed & verified — same check added to both routes. 98/98 tests passing, confirmed 2026-07-22. |
| 9 | `backend/src/routes/promptGovernance.js` | `GET /effective`, `/versions`, and `/audit` had no project-scoping check — any authenticated user could read another project's active prompt content, full version history, or audit log by passing an arbitrary `projectId`. Found in the broader architecture/system-design/code-review pass, same bug class as #1/#2. | ✅ Fixed & verified — `authorizePromptReadAccess` added (admin or any project role required when `projectId` is given; global scope with no `projectId` stays open to any authenticated user, matching pre-existing test expectations). Backend `tsc --noEmit` clean (exit 0). 85/85 tests passing (1 suite), including 15 new project-scoped read-access cases across all three routes. Confirmed via user-run terminal output 2026-07-22. |

## High

| # | File | Issue | Status |
|---|------|-------|--------|
| 3 | `backend/src/routes/governance.js` | `POST /:projectId/decision`'s multi-step write (decision insert, findings upsert, stale-finding resolution, backlog auto-create) ran as unwrapped sequential queries — a mid-sequence failure left inconsistent state. | ✅ Fixed & verified — wrapped in a transaction on a dedicated client (`BEGIN`/`COMMIT`/`ROLLBACK`). Rollback test confirmed passing 2026-07-22. |

## Suggestions

| # | File | Issue | Status |
|---|------|-------|--------|
| 4 | `backend/src/routes/governance.js` | `confidence` had no bounds/NaN validation before insert. | ✅ Fixed & verified — rejects non-finite or out-of-0–100-range values with a 400. Confirmed passing 2026-07-22. |
| 5 | `backend/src/routes/governance.js` | Per-finding upsert is one query per finding (N+1-shaped). | ✅ Fixed & verified — batched into a single UNNEST-based upsert + de-dup by controlId. 105/105 tests passing, confirmed 2026-07-22. |
| 6 | `backend/migrations/013_ai_governance_mvp.sql` | `governance_finding.backlog_item_id` is a TEXT reference, not a real FK — no referential integrity. | ✅ Fixed & verified — `migrations/015_governance_finding_backlog_fk.sql` applied via Supabase SQL editor, confirmed 2026-07-22. Orphaned references nulled defensively, real FK now in place with `ON DELETE SET NULL`. |
| 7 | `frontend/src/components/admin/GovernanceTab.tsx` | Cross-project table uses an N+1 fetch pattern (one call per project). | ✅ Fixed & verified — new admin-only `GET /governance/aggregate?projectIds=...` route (3 queries total regardless of project count), `GovernanceTab.tsx` updated to use it. Backend tests 105/105 passing, frontend `tsc --noEmit` exit 0, both confirmed 2026-07-22. |
| 8 | `backend/src/proxy.js` | Kill-switch check in `authorizeAgentRun` fails open on a DB error (deliberate design choice). | 🔴 Open — not a bug, flagged for risk-owner confirmation only, not touched this pass. |

## Verification note (2026-07-22)

Findings #1–7 are all fixed and verified: backend `tsc --noEmit` clean, frontend `tsc --noEmit` clean, `npx jest governance.test.ts --verbose` — 2 suites, 105/105 tests passing (up from 98, +7 new tests across the aggregate route, batched upsert, and de-dup behavior) — and migration 015 applied successfully via the Supabase SQL editor. All confirmed 2026-07-22.

Finding #9 (promptGovernance.js, found in a later, broader security pass) is also fixed and verified: backend `tsc --noEmit` clean, `npx jest promptGovernance.test.ts --verbose` — 1 suite, 85/85 tests passing. Confirmed 2026-07-22.

Only #8 remains open, and it's not a bug — a deliberate fail-open design choice flagged for risk-owner confirmation, not code that needs changing.
