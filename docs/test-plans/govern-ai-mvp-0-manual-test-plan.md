# GOVERN-AI MVP-0 — Manual Test Plan

Branch: `feature/govern-ai-mvp-0`
Companion doc: `docs/architecture/govern-ai-gap-assessment-and-implementation-plan.md`

## Before you start: read this

Your local `.env` points at the **same Postgres database as production** (confirmed 2026-07-21). That changes how you should run every step below:

- `admin_backlog_items` is a **global table**, shared by every project. Any governance-sourced backlog item you create while testing will sit in the real admin backlog everyone sees, mixed with real items, until you delete it.
- The **global** agent kill switch (`agent_global_settings`) is platform-wide. Toggling it disables that agent for every real project on this database, not just a test one.
- Governance decisions you POST will be visible to anyone who opens that project's Gate 0 modal or workspace header.

**Rule for this test pass:** create one throwaway project (e.g. "ZZZ Governance Test — delete me") and do all destructive/write testing against it. Never exercise the global kill switch against a real agent unless you're prepared for it to be disabled everywhere until you flip it back. Clean up test data at the end (§8).

---

## 0. Confirm you're on the right branch with the right files

```powershell
git branch --show-current
git status --short
```

Expect `feature/govern-ai-mvp-0` and these files staged/committed or present:

- `backend/migrations/013_ai_governance_mvp.sql`, `backend/migrations/014_governance_backlog_project_scope.sql`
- `backend/src/routes/governance.js`, `backend/src/routes/agentControls.js`
- `backend/src/routes/governance.test.ts`, `backend/src/routes/agentControls.test.ts`
- `backend/src/proxy.js` (modified — router mounts + `authorizeAgentRun` kill-switch check)
- `backend/src/proxy.agentAccess.integration.test.ts` (modified — 3 new kill-switch cases)
- `backend/src/routes/appState.js` (modified — `project_id` threaded through backlog CRUD)
- `frontend/src/agents/definitions.ts` (modified — `aiGovernance` section 12, `domainLine()`)
- `frontend/src/services/l3Runtime.ts` (modified — extraction/persistence)
- `frontend/src/services/governanceStatus.ts` (new — shared client)
- `frontend/src/components/reviewGate/ReviewGateModal.tsx` (modified — badge + override)
- `frontend/src/components/pipeline/ProjectWorkspace.tsx` (modified — header badge)
- `frontend/src/components/admin/GovernanceTab.tsx` (new), `AdminPanel.tsx` (modified — new tab)
- `frontend/src/components/admin/BacklogTab.tsx` (modified — governance tagging)
- `frontend/src/components/dashboard/NewProjectModal.tsx` (modified — secondary domain picker)
- `frontend/src/db/projectRepository.ts`, `frontend/src/types/project.types.ts`, `frontend/src/types/agent.types.ts`, `frontend/src/types/adminData.types.ts` (modified)
- `server/src/routes/projects.ts` (modified — `secondaryDomains` schema + insert/patch)
- `tests/unit/l3Runtime-governanceDecision.test.ts` (new)

If anything's missing, stop here — don't proceed to steps that assume it exists.

---

## 1. Static checks (fast, no DB, no server)

```powershell
node --check backend/src/routes/governance.js
node --check backend/src/routes/agentControls.js
node --check backend/src/proxy.js
node --check backend/src/routes/appState.js
```

Then a require smoke test (catches a bad import/wiring mistake immediately):

```powershell
node -e "require('./backend/src/proxy.js')"
```

If this throws, read the stack trace — it'll point at exactly which `require()` or top-level statement failed. Do not proceed until this passes.

TypeScript check (both halves):

```powershell
cd backend; npx tsc --noEmit; cd ..
cd frontend; npx tsc --noEmit; cd ..
cd server; npx tsc --noEmit; cd ..
```

Expect zero errors. Likely candidates if something's wrong: the `secondaryDomains` destructure in `server/src/routes/projects.ts`'s PATCH handler, or the `GovernanceStatus`/`DECISION_LABELS` imports in `ReviewGateModal.tsx` / `ProjectWorkspace.tsx` / `GovernanceTab.tsx`.

---

## 2. Automated tests

```powershell
cd backend
npm ci
npx jest governance.test.ts agentControls.test.ts
```

These two don't need a real database — they mock `getDb`. Expect all green.

```powershell
npx jest proxy.agentAccess.integration.test.ts
```

This one **does** need a real Postgres and will otherwise print a skip warning and pass trivially (0 tests actually run). If you want the 3 new kill-switch cases to actually execute, set `POSTGRES_URL_TEST` to a database you're comfortable writing test rows to (see the shared-DB warning above — if `POSTGRES_URL_TEST` isn't set it falls back to `POSTGRES_URL`, i.e. your real DB). The test cleans up after itself (`agent_global_settings`/`project_agent_overrides` rows for a fake `killSwitchTestAgent` id, plus the `projects` row), but only on success — if a test fails mid-run, check for a stray `killSwitchTestAgent` row afterward.

```powershell
npx jest
```

Full backend suite — confirm nothing else regressed, especially around `authorizeAgentRun`/`agentDispatchRoutes`.

Frontend:

```powershell
cd ../frontend
npm ci
npx vitest run ../tests/unit/l3Runtime-governanceDecision.test.ts
npx vitest run ../tests/unit/l3Runtime-outputGovernance.test.ts   # confirm no regression to the sibling suite
npx vitest run
```

---

## 3. Apply migration 014

Migration 013 should already be applied (it predates this branch). Apply 014:

```powershell
psql "$env:POSTGRES_URL" -f backend/migrations/014_governance_backlog_project_scope.sql
```

Verify:

```powershell
psql "$env:POSTGRES_URL" -c "\d admin_backlog_items"
```

Confirm a nullable `project_id` column exists and existing rows are untouched (`SELECT count(*) FROM admin_backlog_items WHERE project_id IS NOT NULL;` should return 0 at this point).

---

## 4. Boot the app locally

```powershell
npm run dev:backend   # or however you normally start backend/src/proxy.js
npm run dev:frontend
```

Confirm the console shows both new routers mounted without error (no "Cannot find module" for `./routes/governance` or `./routes/agentControls`).

---

## 5. Create your throwaway test project

In the UI: **New Project** → give it a name like `ZZZ Governance Test`, pick a primary domain (e.g. `fintech`), and select 1–2 **secondary domains** in the new picker under the Domain field (cap is 3 — try clicking a 4th to confirm it's disabled). Save.

Verify in the DB:

```powershell
psql "$env:POSTGRES_URL" -c "SELECT id, name, domain, secondary_domains FROM projects WHERE name = 'ZZZ Governance Test';"
```

Confirm `secondary_domains` is a real array matching what you picked. Copy the project's `id` — you'll need it below (call it `<PROJECT_ID>`).

---

## 6. Run `aiGovernance` and check the whole pipeline

Run the pipeline (or just the `aiGovernance` agent specifically) for your test project through the normal UI flow. When it completes:

1. **Check the report renders clean** — open its output. It should NOT show a raw `GOVERNANCE_DECISION_JSON` blob at the end; the document should end cleanly after section 11 (Lifecycle Invocation Plan).
2. **Check the DB got the structured decision:**
   ```powershell
   psql "$env:POSTGRES_URL" -c "SELECT decision, risk_tier, confidence, decision_reason FROM governance_decision WHERE project_id = '<PROJECT_ID>' ORDER BY created_at DESC LIMIT 1;"
   psql "$env:POSTGRES_URL" -c "SELECT control_id, severity, status FROM governance_finding WHERE project_id = '<PROJECT_ID>';"
   ```
3. **Check the workspace header badge** — reload the project workspace. You should see an "AI Gov: <decision>" badge next to the mode badge, with an open-findings count if any Medium+ findings exist.
4. **Check the backlog auto-creation** — open Admin Panel → Backlog tab. Any Medium+ severity finding should appear as a new item tagged 🛡 governance, with a second pill showing your test project's name (not a raw UUID). Low-severity findings should NOT appear here.
5. **Re-run `aiGovernance`** on the same project (if a finding got resolved or changed). Confirm:
   - A finding that no longer appears flips to `resolved` in `governance_finding` and its linked backlog item flips to `done` (not left stale/open).
   - A finding that persists gets its `last_seen_at` updated, not duplicated.

---

## 7. Gate 0 enforcement (the actual point of this feature)

**Correction:** `aiGovernance` is marked `visibility: 'internal'` in its agent definition (same as `tokenOptimizer`/`sdlcOrchestrator`) — `isInternalAgent()` filters it out of every agent list in the UI, including the gate0 modal's own tab list (`ReviewGateModal.tsx` explicitly excludes internal agents when building `agents`). There is no Prompt Sandbox tab for it, for anyone. It runs automatically as part of "Run Pipeline" (phase0b); it's just never manually selectable. This is pre-existing app behavior this feature didn't change.

Since which decision the LLM actually produces isn't reliably reproducible, test the enforcement path deterministically by POSTing straight to the real endpoint instead — this exercises the actual `governance.js` logic, not a hand-edited output:

```powershell
$body = @{
  decision = "blocked"
  riskTier = "high"
  confidence = 82
  decisionReason = "Test: missing PII redaction evidence."
  findings = @(
    @{ controlId = "test-missing-redaction"; severity = "high"; gap = "No redaction pipeline documented."; recommendation = "Add a redaction step."; ownerRole = "Data Owner" }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:3001/api/governance/<PROJECT_ID>/decision" `
  -Method POST -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer admin-local-bypass-token" } `
  -Body $body
```

`admin-local-bypass-token` only works when `NODE_ENV !== 'production'` (see `proxy.js`'s `checkToken`) — this is a local-dev-only shortcut, not something reachable in production. Swap `<PROJECT_ID>` and the port for your actual values. Then:

1. Open the **Gate 0** review modal for your test project.
2. Confirm the decision badge shows **Blocked** in red, with risk tier, confidence, and up to 5 findings listed as a checklist.
3. Confirm the **Approve** button is disabled with a tooltip explaining why.
4. Try the override: enter a reason, click **Override & Enable Approve**. Confirm:
   - As a non-owner/non-admin, this should 403 (test with a team member account if you have one).
   - As the project owner or an app admin, it should succeed, and the Approve button should become enabled with an "✓ Overridden by ..." note appearing.
5. Check the DB:
   ```powershell
   psql "$env:POSTGRES_URL" -c "SELECT actor_email, actor_role, reason FROM governance_override WHERE project_id = '<PROJECT_ID>';"
   ```
6. Confirm a **non-Blocked** decision (Approved with Conditions / Human Review Required) shows the findings as a plain checklist and does NOT block Approve.

---

## 8. Admin Governance tab + kill switch

Admin Panel → **Governance** tab:

1. Confirm your test project appears in the cross-project table with its domain (and a `(+N)` if you set secondary domains), risk tier, decision, and open-findings count.
2. Click **Details** — confirm the drill-in shows the decision rationale, override info (if any), and findings list.
3. **Kill switch — per-project only for this test pass.** Select your test project in the dropdown, click an agent's "This Project" button to disable it, then try running that agent for your test project — confirm it fails with a clear 403 ("...disabled for this project..."), not a silent no-op. Click again to re-enable, confirm it runs again.
4. **Do not toggle the Global column** unless you accept that agent being disabled platform-wide until you toggle it back.

---

## 9. Clean up

Since this ran against the shared database:

```powershell
psql "$env:POSTGRES_URL" -c "DELETE FROM governance_override WHERE project_id = '<PROJECT_ID>';"
psql "$env:POSTGRES_URL" -c "DELETE FROM governance_finding WHERE project_id = '<PROJECT_ID>';"
psql "$env:POSTGRES_URL" -c "DELETE FROM governance_decision WHERE project_id = '<PROJECT_ID>';"
psql "$env:POSTGRES_URL" -c "DELETE FROM admin_backlog_items WHERE project_id = '<PROJECT_ID>';"
psql "$env:POSTGRES_URL" -c "DELETE FROM project_agent_overrides WHERE project_id = '<PROJECT_ID>';"
```

Then archive or delete the `ZZZ Governance Test` project itself through the normal UI/admin flow (soft-delete via the Dashboard's delete confirmation, or the Admin Panel's Projects tab).

Double-check nothing was left disabled globally:

```powershell
psql "$env:POSTGRES_URL" -c "SELECT * FROM agent_global_settings WHERE disabled = TRUE;"
```

If anything unexpected shows up here, that's a real agent disabled for every project — fix it before moving on.

---

## What "done" looks like

All of §1–2 green, migration applied cleanly (§3), and every checkbox in §6–8 confirmed against your throwaway project, with §9's cleanup run afterward. If anything in §6–8 doesn't behave as described, that's a bug in this branch, not a test-plan error — come back with what broke and I'll fix it.
