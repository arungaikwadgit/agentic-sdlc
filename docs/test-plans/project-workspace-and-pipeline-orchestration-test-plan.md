# Module 7 Test Plan: Project Workspace & Pipeline Orchestration

Covers `ProjectWorkspace.tsx`, `App.tsx`, `ResumeModal.tsx`, and the
gate-locking/gate-lookup helpers in `agents/constants.ts`. Per
`docs/architecture/project-workspace-and-pipeline-orchestration.md` §4,
this plan is organized into four test files split by concern.

---

## 1. Scope and approach

`ProjectWorkspace.tsx` is a 572-line monolithic screen component with four
largely independent concerns: gate-locking (pure functions), pipeline
run/stop controls, the per-agent re-run flow, and document/export rendering
(the last of which is already covered by
`tests/unit/ProjectWorkspace-github-push.test.tsx` and
`tests/unit/ExportMenu.test.tsx` from Module 5). This plan adds three new
component test files plus one for `ResumeModal`, and explicitly does **not**
duplicate gate-locking pure-function tests, which already exist.

`usePipeline.ts`, `useAgents.ts`, and `useProject.ts` are confirmed dead code
(zero imports anywhere in the codebase — Development Note 3.1 of the
architecture doc) and are **out of scope** for testing. `App.tsx`'s view
router and theme init are covered briefly inside
`ProjectWorkspace-controls.test.tsx` via a small dedicated describe block,
since `App.tsx` itself is a 20-line pass-through with no independent logic
worth a separate file.

---

## 2. Gate-locking logic — already covered, no new tests

`getLockedPhases` (identical implementation, duplicated from
`ProjectWorkspace.tsx` into the test file) is fully covered by the existing
`tests/unit/getLockedPhases.test.ts`:

- No gates approved → all phases after gate1's cutoff locked
- Approving gate1 unlocks phase2/phase3 but gate2_3 still locks phase4+
- All gates approved → no locked phases
- Multiple unapproved gates accumulate (union) their locked-phase sets
- Missing/undefined `reviewGates` handled gracefully

`gateForPhase` (the inverse lookup used by the re-run flow, §2.2 of the
architecture doc) is **not** covered by `getLockedPhases.test.ts` and is
added as a small pure-function describe block in
`tests/unit/ProjectWorkspace-gates.test.ts` (TS-170–TS-173 below), since it's
new logic specific to Module 7's re-run flow (architecture doc §2.2, §2.6).

---

## 3. Mocking strategy

All three new `ProjectWorkspace` test files reuse the mocking pattern
established by `tests/unit/ProjectWorkspace-github-push.test.tsx`:

| Module | Mock |
|---|---|
| `dexie-react-hooks` (`useLiveQuery`) | `vi.mock` returns a module-level `currentProject` variable synchronously (no async DB round trip) |
| `@/db/database` | `vi.mock` — `db.projects.get` stubbed as `vi.fn()` (never actually invoked since `useLiveQuery` is mocked) |
| `@/db/projectRepository` (`updateProject`, `updateAgentRun`) | `vi.mock` with `vi.fn()`; assert on call args for state-mutation scenarios |
| `@/services/pipelineEngine` (`PipelineEngine`) | `vi.mock` — constructor spy capturing the callbacks object passed in; instance exposes `run: vi.fn()` and `abort: vi.fn()` |
| `@/services/api` (`callAgent`, `extractText`, `enhancePrompt`) | `vi.mock` with `vi.fn()` — success/error per scenario |
| `@/agents/domains` (`DOMAINS`) | `vi.mock` — minimal fixture domain with `id`, `context` |
| `@/agents/definitions` (`AGENT_DEFINITIONS`) | **not mocked** — real definitions, so `phase`/`name`/`systemPrompt`/`outputLabel`/`buildUserPrompt` are realistic |
| `@/agents/constants` | **not mocked** — real `PHASE_ORDER`, `PHASE_AGENTS`, `PHASE_LABELS`, `REVIEW_GATES` |
| `@/components/documents/DocumentViewer`, `ExportMenu` | `vi.mock` → `<div data-testid="..."/>` stubs |
| `@/components/reviewGate/ReviewGateModal` | `vi.mock` → stub rendering `data-testid="review-gate-modal"`, with a spy capturing props (`onApprove`/`onReject`) for the re-run gate-reset scenario |
| `@/components/settings/ProjectSettings` (default + named `initials`) | `vi.mock` → stub component + real-ish `initials` helper |
| `@/components/documents/GithubPushModal` | `vi.mock` → stub (not exercised by these files; covered by `ProjectWorkspace-github-push.test.tsx`) |
| `@/services/traceability`, `@/services/exporters/documentExporter`, `@/services/exporters/excelExporter` | `vi.mock` with `vi.fn()` stubs |

A shared `baseProject(overrides)` fixture (same shape as in
`ProjectWorkspace-github-push.test.tsx`) is duplicated locally in each new
file per existing convention (no shared test-utils module in this codebase).

---

## 4. Test files and cases

### 4.1 `tests/unit/ProjectWorkspace-gates.test.ts`

Pure-function tests, no rendering.

| ID | Case |
|---|---|
| TS-170 | `gateForPhase('phase1b')` returns `'gate1'` (phase1b is in `REVIEW_GATES.gate1`) |
| TS-171 | `gateForPhase('phase3')` returns `'gate2_3'` |
| TS-172 | `gateForPhase('phase4')` returns `undefined` (phase4 has no covering gate) |
| TS-173 | `gateForPhase('phase8')` returns `undefined` (phase8 has no covering gate) |

### 4.2 `tests/unit/ProjectWorkspace-controls.test.tsx`

Run/Resume/Stop button states, team-required banner, App-level smoke checks.

| ID | Case |
|---|---|
| TS-174 | "Run Pipeline" label shown when `project.status === 'draft'` |
| TS-175 | "Resume Pipeline" label shown when `project.status === 'paused'` |
| TS-176 | "Complete ✓" label shown and button disabled when `project.status === 'complete'` |
| TS-177 | Run button disabled with tooltip when `teamMembers` is empty (`teamReady === false`), regardless of status |
| TS-178 | Team-required banner ("⚠ Add at least one team member...") renders when `teamMembers.length === 0`, and is absent when non-empty |
| TS-179 | Clicking "Run Pipeline" constructs a `PipelineEngine` with `projectId` and a callbacks object, then calls `engine.run(project.currentPhase)` |
| TS-180 | While `engineRunning` is true (simulated via `onAgentStart` callback firing after Run is clicked), "Stop" button replaces "Run Pipeline"/"Resume Pipeline" |
| TS-181 | Clicking "Stop" calls `engine.abort()`, and calls `updateProject` with a mutator that sets `status: 'paused'` |
| TS-182 | `onGateReached(gateId)` callback sets `engineRunning` false and renders `ReviewGateModal` (`data-testid="review-gate-modal"`) with `pendingGate` matching the gate id |
| TS-183 | Settings panel (`ProjectSettings` stub) auto-opens on first render when `teamMembers` is empty (R16 / `useEffect` keyed on `project?.id`) |
| TS-184 | Clicking "⚙ Settings" opens the `ProjectSettings` stub when team is non-empty |
| TS-185 | Clicking the Simple/Expert toggle calls `updateProject` with a mutator flipping `project.mode` |

### 4.3 `tests/unit/ProjectWorkspace-rerun.test.tsx`

Re-run panel: open, edit, save override, enhance, reset, confirm, gate reset.

| ID | Case |
|---|---|
| TS-186 | Opening re-run (via "↺ Re-run" on a completed agent with no saved override) pre-fills the textarea with `AGENT_DEFINITIONS[agentId].systemPrompt` |
| TS-187 | Opening re-run for an agent with a saved `promptOverrides` entry pre-fills the textarea with that entry's `fullPrompt`, and shows "✏ Using saved custom prompt for this agent." |
| TS-188 | Clicking "Reset to built-in default" calls `updateProject` to filter out the override for that agent, and resets the textarea to `AGENT_DEFINITIONS[agentId].systemPrompt` |
| TS-189 | Editing the textarea then clicking "💾 Save as project default" calls `updateProject` with a `promptOverrides` entry containing `{ agentId, patch: [], fullPrompt: <edited text> }`, and shows "✓ Saved as project default." |
| TS-190 | Clicking "✨ Enhance prompt" calls `api.enhancePrompt(currentPrompt, agentName)`; on success, the textarea updates to the returned text and `promptSaved` resets to false |
| TS-191 | "✨ Enhance prompt" failure: `api.enhancePrompt` rejects → shows `⚠ Enhance failed: <error>` and textarea is unchanged |
| TS-192 | Clicking "▶ Confirm Re-run" for an agent in a phase **without** a covering gate (e.g. `sprintPlanner`, phase4): calls `api.callAgent` with `{ systemPrompt: <edited prompt>, userPrompt: <built from def.buildUserPrompt> }`, then `updateAgentRun` with `status: 'complete'` and the returned output; does **not** call `updateProject` for gate reset; closes the re-run panel and selects the agent |
| TS-193 | "▶ Confirm Re-run" for an agent in a phase **with** a covering gate (e.g. `architecture`, phase3 → gate2_3): after `updateAgentRun`, calls `updateProject` with a mutator that sets `reviewGates.gate2_3.approved = false`, clears `approvedAt`/`approvedBy`, sets a `notes` string containing "Re-run of", sets `status: 'paused'` and `currentPhase: 'phase3'`; `pendingGate` becomes `'gate2_3'` and `ReviewGateModal` renders |
| TS-194 | `confirmRerun`'s built `ctx.priorOutputs` includes outputs from **all** currently-complete agent runs (including ones later in pipeline order than the re-run agent), per architecture doc §2.6 |
| TS-195 | `confirmRerun`'s `ctx.domainContext` prepends `project.domainKnowledge` + `\n\n---\n\n` + `domain.context` when `domainKnowledge` is set, and is just `domain.context` when it is not |
| TS-196 | `api.callAgent` rejecting sets `rerunError` to the stringified error and re-enables the "▶ Confirm Re-run" button (`rerunning` resets to false) |
| TS-197 | Clicking "Cancel" closes the re-run panel without calling `updateProject`/`updateAgentRun` |
| TS-198 | Selecting an agent with `status: 'error'` shows "Retry Pipeline" and "↺ Re-run with edited prompt" actions; clicking the latter opens the re-run panel for that agent |

### 4.4 `tests/unit/ResumeModal.test.tsx`

| ID | Case |
|---|---|
| TS-199 | Renders nothing (`null`) when no project has `status: 'running'` |
| TS-200 | When exactly one project has `status: 'running'`, renders the banner with that project's name, and calls `updateProject` to set its `status: 'paused'` |
| TS-201 | When multiple projects have `status: 'running'`, banner text shows "{N} pipelines were interrupted", and `updateProject` is called once per project to set `status: 'paused'` |
| TS-202 | Clicking "Dismiss" hides the banner (returns `null` on re-render) without further `updateProject` calls |
| TS-203 | Clicking "Resume →" calls `onResume` with the **first** running project's id (even when multiple exist), and dismisses the banner |

---

## 5. Out of scope / known gaps

- `usePipeline.ts`, `useAgents.ts`, `useProject.ts` — confirmed dead code, not tested (Development Note 3.1).
- `PromptOverride.patch` (JSON Patch array) — never populated by the UI (always `[]`); no test exercises patch-based partial overrides (Development Note 3.2).
- `ResumeModal`'s hardcoded `totalAgents: 22` (Development Note 3.5) is not asserted against `TOTAL_AGENTS` in any test, since `ResumeModal`'s rendered banner doesn't currently display a progress fraction — the discrepancy is inert and the architecture doc already documents it as a fix-when-touched item.
- `App.tsx`'s `useThemeInit` (DOM `data-theme` attribute write) is not covered by a dedicated test file; it's a one-shot `useEffect` with no conditional logic of note beyond the `'system'` vs explicit branch, which is straightforward enough that a full render+mock-`db.settings` test was judged lower value than the re-run/control coverage above. Flagged here rather than silently skipped.

---

## 6. Coverage expectations

Coverage thresholds in `frontend/vite.config.ts` (lines: 80, functions: 80,
branches: 75, statements: 80, v8 provider, `src/**/*.{ts,tsx}`) are
unchanged — not modified by this module. As with prior modules, this sandbox
cannot run `npm run test:coverage`; verify locally:

```
cd frontend
npm install
npm run test:coverage
```
