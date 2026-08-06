# Module 3 Test Plan: Review Gates

Covers `getLockedPhases` (existing tests, referenced not duplicated) and
`ReviewGateModal.tsx` (two new test files, split by concern).

---

## 1. Scope and approach

`ReviewGateModal.tsx` is 463 lines and has two largely independent
concerns:

1. **Core gate UI** — agent list, view/edit output, approve/reject,
   assignee badges, approver selection, close. This is what every reviewer
   uses on every gate.
2. **Prompt sandbox** — an admin/power-user feature that edits agent system
   prompts, runs a live dry-run via `services/api`, checks for prompt
   injection, and can reset gate approval state as a side effect.

These need different mocks (DocumentViewer/ExportMenu/projectRepository for
#1; services/api, promptDefaults, sanitize for #2), so — as flagged to the
user — this module splits them into two test files instead of one:

- `tests/unit/ReviewGateModal-core.test.tsx` (TS-60–TS-74)
- `tests/unit/ReviewGateModal-prompt-sandbox.test.tsx` (TS-75–TS-85)

`getLockedPhases` is already fully covered by the existing
`tests/unit/getLockedPhases.test.ts` (TS-1 through TS-9 in that file's own
numbering — see §4). No new tests are added for it; this plan documents why
it's considered complete.

---

## 2. Mocking strategy

### 2.1 `ReviewGateModal-core.test.tsx`

| Module | Mock |
|---|---|
| `@/components/documents/DocumentViewer` | `vi.mock` → renders `<div data-testid="document-viewer">{markdown}</div>` |
| `@/components/documents/ExportMenu` | `vi.mock` → renders `<div data-testid="export-menu" />` |
| `@/db/projectRepository` (`updateAgentRun`, `updateProject`) | `vi.mock` with `vi.fn()` resolving `undefined` / the input project |
| `@/agents/definitions` | **not mocked** — use real `AGENT_DEFINITIONS` so `outputLabel`/`name`/`phase` are realistic |
| `@/agents/constants` | **not mocked** — use real `REVIEW_GATES`, `PHASE_AGENTS`, `PHASE_LABELS`, `GATE_LABELS` |

### 2.2 `ReviewGateModal-prompt-sandbox.test.tsx`

| Module | Mock |
|---|---|
| `@/services/api` (`callAgent`, `extractText`, `enhancePrompt`) | `vi.mock` with `vi.fn()` — success and error cases per scenario |
| `@/agents/promptDefaults` (`getEffectivePromptDefault`) | `vi.mock` returning a fixed string, e.g. `'DEFAULT SYSTEM PROMPT'` |
| `@/utils/sanitize` (`checkPromptInjection`) | `vi.mock`, default `{ safe: true }`, overridden per test for the injection scenario |
| `@/db/projectRepository` (`updateAgentRun`, `updateProject`) | `vi.mock` with `vi.fn()`, asserted on for call args |
| `@/components/documents/DocumentViewer`, `ExportMenu` | mocked as in §2.1 (still rendered in 'view' mode after a dry run) |
| `window.confirm` | `vi.spyOn(window, 'confirm')` for the injection-confirm scenario |

### 2.3 Shared test fixtures

A `makeProject(overrides)` helper builds a minimal `Project` with:
- `teamMembers: [{ id: 'm1', name: 'Asha Patel', role: 'Product Manager', avatarColor: '#4f46e5' }, { id: 'm2', name: 'Raj Kumar', role: 'Engineering Lead', avatarColor: '#16a34a' }]`
- `agentAssignments` mapping at least one agent in the gate under test to `m1`
- `agentRuns` with one agent `status: 'complete'` (with `output`) and one `status: 'idle'` (no output), to exercise both ✓/○ icons and the disabled "Edit Output" tab
- `reviewGates: {}` (all gates unapproved by default)
- `promptOverrides: []`

`gateId = 'gate2_3'` is used as the default test gate (covers `phase2` +
`phase3`, 10 agents combined) since it gives the richest agent list without
being the largest (`phase4` isn't part of any gate).

---

## 3. Test scenarios — `ReviewGateModal-core.test.tsx`

| ID | Scenario | Assertion |
|---|---|---|
| TS-60 | Renders gate title and phase subtitle | `GATE_LABELS['gate2_3']` text and phase labels for phase2/phase3 are visible |
| TS-61 | Renders one button per agent in the gate's phases | All `PHASE_AGENTS.phase2` + `PHASE_AGENTS.phase3` agents appear by `outputLabel` |
| TS-62 | Completed agent shows ✓, incomplete shows ○ | Status icon differs for the `complete` vs `idle` fixture agents |
| TS-63 | Default selected agent is the first in the list | View panel shows that agent's content (mocked DocumentViewer) on initial render |
| TS-64 | View mode renders `DocumentViewer` with the agent's output when status is `complete` | `data-testid="document-viewer"` contains the fixture's `output` text |
| TS-65 | View mode shows "No output available for {name}" when status is not `complete` | Selecting the `idle` agent shows the empty-state text with that agent's `def.name` |
| TS-66 | "Edit Output" tab is disabled for an incomplete agent | `idle` agent selected → Edit Output button has `disabled` attribute |
| TS-67 | "Edit Output" tab is enabled for a complete agent, and switches to a textarea pre-filled with output | `complete` agent selected → click "Edit Output" → textarea value equals `run.output` |
| TS-68 | "Save Edits" calls `updateAgentRun` with the edited text and returns to view mode | Type new text, click "Save Edits" → `updateAgentRun` called with `(project.id, agentId, { output: <new text> })`; panel returns to View tab content |
| TS-69 | "Save Edits" is a no-op when the textarea is emptied | Clear textarea, click "Save Edits" → `updateAgentRun` NOT called |
| TS-70 | "Cancel" in edit mode discards changes and returns to view | Type new text, click "Cancel" → view mode shows original `run.output`, `updateAgentRun` not called |
| TS-71 | Assignee badges render for team members assigned to agents in this gate | Badge with initials "AP" (Asha Patel) is visible with `title="Asha Patel (Product Manager)"` |
| TS-72 | "Approving as..." select lists all team members | Options include "Asha Patel (Product Manager)" and "Raj Kumar (Engineering Lead)" |
| TS-73 | "Approve & Continue" calls `onApprove` with notes and selected approver id | Type notes, select "Raj Kumar...", click "Approve & Continue" → `onApprove('<notes text>', 'm2')` |
| TS-74 | "Reject & Stop" calls `onReject`; close button calls `onClose` | Click "Reject & Stop" → `onReject` called once, `onApprove` not called. Separately, click "✕" → `onClose` called once |

### 3.1 Edge cases folded into the above

- TS-73 also covers the case where no approver is selected:
  `onApprove(notes, undefined)` when `approvedById` stays at its default
  empty-string value (component passes `approvedById || undefined`).
- A project with `teamMembers: []` is covered by asserting the
  "Approving as..." select and assignee badges are absent (extends TS-71/72
  with a second render using an empty-team fixture).

---

## 4. Test scenarios — `ReviewGateModal-prompt-sandbox.test.tsx`

| ID | Scenario | Assertion |
|---|---|---|
| TS-75 | Switching to "Prompt Sandbox" loads the project's saved override when one exists | Fixture has `promptOverrides: [{ agentId: <agent>, fullPrompt: 'CUSTOM PROMPT', patch: [], updatedAt: ... }]` → textarea value is `'CUSTOM PROMPT'`; "saved custom prompt" note is visible |
| TS-76 | Switching to "Prompt Sandbox" falls back to the app default when no override exists | `promptOverrides: []`, `getEffectivePromptDefault` mock returns `'DEFAULT SYSTEM PROMPT'` → textarea value equals that string; "saved custom prompt" note absent |
| TS-77 | Editing the prompt runs injection detection | `checkPromptInjection` mocked to return `{ safe: false, matchedPattern: 'ignore previous instructions' }` for one specific input → typing that text shows the warning box containing the matched pattern |
| TS-78 | "Run & Update Output" with a clean prompt calls the agent API and updates output | `checkPromptInjection` returns `{ safe: true }`; `api.callAgent` resolves a mock response, `api.extractText` returns `'NEW OUTPUT'` → `updateAgentRun` called with `{ agentId, status: 'complete', output: 'NEW OUTPUT', ... }`; panel switches to View tab; result box shows "New output saved as artifact — see the View tab." |
| TS-79 | "Run & Update Output" with an injection warning prompts `confirm()` before proceeding | `checkPromptInjection` returns unsafe; `window.confirm` mocked to return `true` → dry run proceeds and calls `api.callAgent`. Repeat with `confirm` returning `false` → `api.callAgent` NOT called |
| TS-80 | Dry run resets the covering gate's approval and pauses the project | Fixture has `reviewGates.gate2_3 = { approved: true, approvedAt: <ts>, approvedBy: 'm1', notes: 'old' }`; selected agent belongs to phase2 or phase3 → after a successful dry run, `updateProject` is called with an updater that sets `reviewGates.gate2_3.approved = false`, clears `approvedAt`/`approvedBy`, sets a "re-approval required" note, and sets `project.status = 'paused'` |
| TS-81 | Dry run handles API errors without crashing | `api.callAgent` rejects → result box shows "Run failed:" header and the error text in a `<pre>`; `updateAgentRun`/`updateProject` NOT called |
| TS-82 | "✨ Enhance prompt" replaces the textarea content with the enhanced prompt | `api.enhancePrompt` mocked to resolve `'ENHANCED PROMPT'` → after clicking, textarea value is `'ENHANCED PROMPT'` |
| TS-83 | "✨ Enhance prompt" is disabled when the prompt textarea is empty | Clear the textarea → enhance button has `disabled` attribute |
| TS-84 | "💾 Save for this project" persists a `PromptOverride` and shows confirmation | Click save → `updateProject` called with an updater that pushes/updates `promptOverrides` entry `{ agentId, fullPrompt: <current text>, patch: [], updatedAt: <number> }`; "✓ Saved as project default..." text appears; button becomes disabled |
| TS-85 | Downstream-agent hint appears when another agent depends on the selected one | Select an agent that appears in another `AGENT_DEFINITIONS[...].dependsOn` → hint text names that downstream agent and recommends re-running it. Select an agent with no dependents → hint absent |

---

## 5. `getLockedPhases` — existing coverage (no new tests)

`tests/unit/getLockedPhases.test.ts` (117 lines, 11 tests) already covers:

- Single unapproved gate locks everything after its cutoff phase (`gate1`,
  `gate2_3` cases).
- All gates approved → empty locked set.
- Multiple unapproved gates → union of lock ranges.
- Missing/`undefined` `reviewGates` → treated as fully unapproved, no
  throw.
- `PHASE_ORDER` invariants (length ≥ 6, starts at `phase1`, no duplicates,
  all match `/^phase\d+$/`).

This is judged sufficient: the function is pure, has no React/DOM
dependencies, and every gate × approval-state combination relevant to the
lock computation is already exercised. No changes proposed.

---

## 6. Out of scope for Module 3

- `ProjectWorkspace.tsx`'s rendering of locked/unlocked phase cards and the
  "open review gate" button — this is pipeline-orchestration UI, not the
  review gate modal itself. Candidate for a future module if prioritized.
- `ExportMenu` internals (`exportMarkdown`/`exportDocx`) — Module 5
  (Document Export & GitHub Push).
- `DocumentViewer` Markdown/Mermaid rendering — out of scope; mocked here.
- `services/api.callAgent` / `enhancePrompt` implementations — backend/API
  layer, not this module.

---

## 7. Coverage expectation

`ReviewGateModal.tsx` is one of the larger components in the app. Combined,
TS-60–TS-85 exercise: both render branches of every panel mode, both
status-icon branches, the assignee/approver conditional blocks, all four
sandbox action buttons (including disabled states), the injection-warning
branch, the gate re-approval side effect, and both dry-run success/error
paths. Expect this component to land at or above the 80%
line/statement / 75% branch thresholds on its own.

As with Modules 1 and 2, the sandbox here cannot run
`npm run test:coverage` (`vitest: not found`). Run locally:

```bash
cd frontend
npm install
npm run test:coverage
```
