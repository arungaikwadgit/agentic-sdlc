# Module 3: Review Gates

Covers the review-gate approval workflow: `ReviewGateModal.tsx`, the
gate-locking logic in `ProjectWorkspace.tsx` (`getLockedPhases`), and the
`ReviewGate` data model in `types/project.types.ts`.

---

## 1. Requirements

### 1.1 Purpose

The pipeline runs through six phases of AI agents (Phase 1 through Phase 6).
Rather than letting the pipeline run end-to-end unattended, the app pauses
at four checkpoints — review gates — where a human reviews the agent
outputs produced so far, optionally edits them or tweaks the prompts that
generated them, and then approves or rejects before the pipeline continues.

### 1.2 Functional Requirements

| # | Requirement |
|---|---|
| R1 | The pipeline defines four review gates (`gate1`, `gate2_3`, `gate5`, `gate6`), each covering one or more phases (`REVIEW_GATES` in `agents/constants.ts`). |
| R2 | A gate is "locked" — and all phases after the phase(s) it covers are locked — until that gate's `approved` flag is `true`. `getLockedPhases()` computes the full set of locked phases for a project by unioning the lock ranges of every unapproved gate. |
| R3 | `ReviewGateModal` lists every agent belonging to the gate's phase(s), shows a completion indicator (✓/○) per agent, and lets the reviewer select any agent to inspect its output. |
| R4 | For the selected agent, the modal supports three panel modes: **View** (rendered Markdown output via `DocumentViewer`), **Edit Output** (raw textarea, saved via `updateAgentRun`), and **Prompt Sandbox** (edit the agent's system prompt, dry-run it, and optionally save it as the project's default for that agent). |
| R5 | "Edit Output" is disabled until the agent's run status is `complete`. |
| R6 | The modal shows assignee badges (initials, colored by `avatarColor`) for any team members assigned to an agent in this gate's phases, and an "Approving as..." dropdown listing all team members. |
| R7 | "Approve & Continue" calls `onApprove(notes, approvedById)` with the optional review notes and the selected approver's member id. "Reject & Stop" calls `onReject()`. The "✕" close button calls `onClose()` without recording approval or rejection — the pipeline stays paused. |
| R8 | In Prompt Sandbox mode, the textarea is pre-filled from the project's saved `promptOverrides` entry for that agent (`fullPrompt`), falling back to the app-level default (`getEffectivePromptDefault`, App Settings → Agent Prompts), then the agent's hardcoded `systemPrompt`. |
| R9 | Every prompt edit is checked for prompt-injection patterns (`checkPromptInjection`); a match shows an inline warning and requires confirmation before "Run & Update Output" proceeds. |
| R10 | "Run & Update Output" calls `api.callAgent` with the edited system prompt and the agent's normal user prompt (built from `priorOutputs`, domain context, and `buildTeamRoster`), saves the result as the agent's new output via `updateAgentRun`, and — if the agent's phase is covered by a review gate — resets that gate's `approved` flag to `false` and sets the project status to `paused` so the change requires re-review. |
| R11 | "✨ Enhance prompt" calls `api.enhancePrompt` to AI-rewrite the current prompt text in place. |
| R12 | "💾 Save for this project" persists the edited prompt as a `PromptOverride` (`fullPrompt`, `patch: []`, `updatedAt`) for the selected agent, via `updateProject`. |
| R13 | If any other agent declares the selected agent in its `dependsOn`, the prompt sandbox shows a hint naming those downstream agents and recommending they be re-run. |

### 1.3 Non-Functional Requirements

| # | Requirement |
|---|---|
| NFR1 | Gate state changes (approve/reject, dry-run re-approval reset) go through `updateProject`/`updateAgentRun` in `db/projectRepository.ts` — the same Dexie-backed persistence layer covered in Module 1. No new tables or migrations. |
| NFR2 | `getLockedPhases` must treat missing or `undefined` `reviewGates` as "everything unapproved" without throwing — projects created before a gate existed, or with partial state, must still render correctly. |

---

## 2. Design

### 2.1 Data model

`types/project.types.ts`:

```ts
export type ReviewGateId = 'gate1' | 'gate2_3' | 'gate5' | 'gate6';

export interface ReviewGate {
  id: ReviewGateId;
  /** Phase(s) that precede this gate */
  afterPhases: PhaseId[];
  approved: boolean;
  approvedAt?: number;
  approvedBy?: string;  // TeamMember.id
  notes?: string;
}

export interface PromptOverride {
  agentId: AgentId;
  /** JSON Patch operations (RFC 6902) against the default prompt */
  patch: object[];
  /** Full replacement prompt string (takes precedence over patch when set) */
  fullPrompt?: string;
  updatedAt: number;
}

export interface Project {
  // ...
  agentRuns: Partial<Record<AgentId, AgentRun>>;
  reviewGates: Partial<Record<ReviewGateId, ReviewGate>>;
  promptOverrides: PromptOverride[];
  // ...
}
```

`types/agent.types.ts`:

```ts
export interface AgentRun {
  agentId: AgentId;
  status: AgentStatus;        // 'idle' | 'running' | 'complete' | 'error' (etc.)
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  tokensUsed?: number;
}
```

`agents/constants.ts`:

```ts
export const REVIEW_GATES = {
  gate1:   ['phase1', 'phase1b'] as PhaseId[],
  gate2_3: ['phase2', 'phase3']  as PhaseId[],
  gate5:   ['phase5']            as PhaseId[],
  gate6:   ['phase6']            as PhaseId[],
};

export const PHASE_AGENTS: Record<PhaseId, AgentId[]> = {
  phase1:  ['manager'],
  phase1b: ['projectCharter', 'brd'],
  phase2:  ['stakeholder', 'userStory', 'businessRules', 'feasibility', 'dataModel'],
  phase3:  ['architecture', 'apiDesign', 'uxResearch', 'interaction', 'uxMockups'],
  phase4:  ['sprintPlanner', 'taskBreakdown', 'techDebt', 'codeStructure', 'codeSnippets', 'uiComponentLibrary'],
  // ... phase5, phase6
};
```

`REVIEW_GATES` is the source of truth for which phases each gate covers.
`ReviewGateModal` derives the agent list for a gate via
`phases.flatMap(p => PHASE_AGENTS[p])`.

### 2.2 Gate-locking logic (`getLockedPhases`)

This pure function lives inline in `ProjectWorkspace.tsx` (and is
re-implemented verbatim in `tests/unit/getLockedPhases.test.ts` for unit
testing, since it isn't exported):

```ts
const GATE_UNLOCKS_AFTER: Record<string, string> = {
  gate1: 'phase1',
  gate2_3: 'phase3',
  gate5: 'phase5',
  gate6: 'phase6',
};

function getLockedPhases(project: Pick<Project, 'reviewGates'>): Set<string> {
  const locked = new Set<string>();
  const phaseIndex = Object.fromEntries(PHASE_ORDER.map((p, i) => [p, i]));
  for (const [gateId, lastCoveredPhase] of Object.entries(GATE_UNLOCKS_AFTER)) {
    const gate = project.reviewGates?.[gateId as keyof Project['reviewGates']];
    if (!gate?.approved) {
      const cutoff = phaseIndex[lastCoveredPhase] ?? -1;
      PHASE_ORDER.forEach((ph, i) => { if (i > cutoff) locked.add(ph); });
    }
  }
  return locked;
}
```

For each of the four gates, if it isn't approved, every phase *after* the
last phase that gate covers gets added to the locked set. The result is a
union across all unapproved gates — so an unapproved `gate1` (which covers
through `phase1`/`phase1b`) locks everything from `phase2` onward, even if
`gate2_3` happens to be marked approved (a state that shouldn't normally
occur, but the function degrades safely).

`ProjectWorkspace.tsx` uses this set to grey out / disable phase cards for
locked phases, and to determine `isActiveGate` for the "open review gate"
button shown after a phase's agents complete.

### 2.3 `gateForPhase` (inverse lookup)

Both `ProjectWorkspace.tsx` and `ReviewGateModal.tsx` independently define
the same helper:

```ts
function gateForPhase(phase: PhaseId): ReviewGateId | undefined {
  return (Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][])
    .find(([, phases]) => phases.includes(phase))?.[0];
}
```

Used by `runDryRun` (in `ReviewGateModal`) to find which gate covers the
edited agent's phase, so that gate can be reset to unapproved after a
prompt-sandbox run changes that agent's output. This is a duplicated
helper — see Development Notes §3.

### 2.4 `ReviewGateModal.tsx` — structure and state

Props:

```ts
interface Props {
  gateId: ReviewGateId;
  project: Project;
  onApprove: (notes: string, approvedById?: string) => void;
  onReject: () => void;
  onClose: () => void;
}
```

State:

| State | Purpose |
|---|---|
| `selectedAgent` | Which agent's output is shown in the document panel. Defaults to `agents[0]`. |
| `notes` | Free-text review notes, passed to `onApprove`. |
| `panelMode` | `'view' \| 'edit' \| 'prompt'` — which document-panel tab is active. |
| `approvedById` | Selected team member id from the "Approving as..." dropdown. |
| `editedOutput`, `savingEdit` | Edit-mode textarea content and save-in-flight flag. |
| `editedPrompt`, `dryRunResult`, `dryRunning`, `injectionWarning`, `promptSaved`, `savingPrompt`, `enhancing` | Prompt-sandbox state. |

Switching `selectedAgent` (`handleSelectAgent`) resets `panelMode` back to
`'view'` and clears all edit/prompt-sandbox transient state — each agent
gets a fresh slate.

#### 2.4.1 Header

- Title: `GATE_LABELS[gateId]` (e.g. "Phase 2 & 3 Review Gate").
- Subtitle lists the phases this gate covers via `PHASE_LABELS`.
- "✕" close button (`aria-label="Close"`) — calls `onClose`, no state change.
- Assignee badges: for each team member assigned to any agent in this
  gate's phases (`getGateAssignees`), a colored circle with initials and a
  `title` tooltip of `"{name} ({role})"`.
- "Approving as..." `<select>` — only rendered if `project.teamMembers` is
  non-empty. Options are `"{name} ({role})"`, value = member id.
- "Reject & Stop" button (`btn-danger`) → `onReject()`.
- "Approve & Continue ›" button (`btn-primary`) → `onApprove(notes, approvedById || undefined)`.

#### 2.4.2 Agent list (left column)

One button per agent in the gate's phases. Each shows a ✓ (green, if
`run.status === 'complete'`) or ○ (muted) status icon plus
`AGENT_DEFINITIONS[agentId].outputLabel`. Clicking selects that agent.

#### 2.4.3 Document panel (right column) — panel tabs

Three tabs, always visible:

- **View** — always enabled.
- **Edit Output** — `disabled={run?.status !== 'complete'}`. Clicking calls
  `startEdit()`, which seeds `editedOutput` from `run.output`.
- **Prompt Sandbox** — always enabled. Clicking calls `startPromptEdit()`
  (async — loads the prompt per R8 before switching `panelMode`).

If the selected agent's run is complete and has output, an `ExportMenu` is
rendered at the right edge of the tab bar (Module 5 territory — mocked out
in this module's tests).

#### 2.4.4 View mode

```tsx
{panelMode === 'view' && (
  run?.status === 'complete' && run.output
    ? <DocumentViewer markdown={run.output} />
    : <div className={styles.noOutput}>No output available for {def?.name}</div>
)}
```

#### 2.4.5 Edit mode

A hint paragraph, a full-width textarea bound to `editedOutput`, and
"Cancel" (back to view, discarding changes) / "Save Edits" (calls
`saveEdit()`, which calls `updateAgentRun(project.id, selectedAgent, { output: editedOutput })`
then returns to view mode). "Save Edits" is disabled while `savingEdit` is
true and shows "Saving..." text.

`saveEdit()` is a no-op if `editedOutput.trim()` is empty (early return
before `setSavingEdit(true)`).

#### 2.4.6 Prompt sandbox mode

The most complex panel. In order:

1. Hint paragraph explaining what "Run & Update Output" and "Save for this
   project" do.
2. If `project.promptOverrides` has an entry for `selectedAgent` and
   `!promptSaved`, an "✏ This agent has a saved custom prompt for this
   project." note.
3. If `injectionWarning` is set, a warning box showing the matched pattern.
4. A textarea bound to `editedPrompt` via `handlePromptChange`, which
   updates `injectionWarning` on every keystroke via `checkPromptInjection`.
5. If `promptSaved`, a "✓ Saved as project default..." confirmation line.
6. If `downstreamAgents.length > 0`, an info hint naming the agents whose
   `dependsOn` includes `selectedAgent`.
7. Action buttons:
   - **"▷ Run & Update Output"** (`runDryRun`) — disabled while `dryRunning`.
   - **"✨ Enhance prompt"** (`enhancePromptInSandbox`) — disabled while
     `enhancing` or when `editedPrompt` is empty/whitespace.
   - **"💾 Save for this project"** (`savePromptForProject`) — disabled
     while `savingPrompt`, or `promptSaved`, or `editedPrompt` is empty.
8. If `dryRunResult` is set, a result box. Header text is "Run failed:" if
   the result starts with `"Error:"`, otherwise "New output saved as
   artifact — see the View tab."; body is `<pre>{dryRunResult}</pre>`.

#### 2.4.7 `runDryRun()` flow (R10)

```
1. If injectionWarning is set, confirm() — abort if declined.
2. setDryRunning(true), clear dryRunResult.
3. Build context: domain (from project.domain), priorOutputs (every
   agentRun with status === 'complete' and an output), domainContext
   (project.domainKnowledge prepended to domain.context if set),
   teamRoster (buildTeamRoster(project)).
4. userPrompt = def.buildUserPrompt(ctx)
5. resp = api.callAgent({ systemPrompt: editedPrompt, userPrompt })
6. output = api.extractText(resp)
7. setDryRunResult(output)
8. updateAgentRun(project.id, selectedAgent, {
     agentId: selectedAgent, status: 'complete', output,
     tokensUsed: resp.usage?.total_tokens ?? 0, completedAt: Date.now(),
   })
9. agentPhase = def.phase; coveringGate = gateForPhase(agentPhase)
10. If coveringGate exists, updateProject(...) sets
    reviewGates[coveringGate] = { ...existing, approved: false,
    approvedAt: undefined, approvedBy: undefined,
    notes: 'Prompt sandbox run of {name} — re-approval required' },
    AND sets project.status = 'paused', project.currentPhase = agentPhase.
11. setPanelMode('view') — so the new output is immediately visible.
12. On any thrown error: dryRunResult = `Error: ${String(e)}`.
13. finally: setDryRunning(false).
```

Step 10 is the key cross-cutting effect: editing and re-running an agent's
prompt from inside a review gate can **re-lock a gate that was already
approved**, forcing re-review of that gate's outputs. This applies even if
the edited agent belongs to a *different* gate than the one currently open
(e.g. editing a Phase 2 agent's prompt while gate `gate5` is open would
reset `gate2_3`, not `gate5`).

### 2.5 Notes bar

A simple `<textarea>` at the bottom of the modal, bound to `notes`, with
placeholder "Add notes or feedback for this review gate...". Its value is
passed to `onApprove` but is **not** sent with `onReject()` — rejection
notes are not currently captured.

### 2.6 `ProjectWorkspace.tsx` — gate wiring

`ProjectWorkspace` owns `pendingGate: ReviewGateId | null`. When a phase's
agents all complete and a gate covers that phase, a button sets
`pendingGate` to that gate's id, which renders `ReviewGateModal`:

```tsx
<ReviewGateModal
  gateId={pendingGate}
  project={project}
  onApprove={async (notes, approvedById) => {
    await updateProject(project.id, (p) => {
      p.reviewGates[pendingGate] = {
        ...(p.reviewGates[pendingGate] ?? { id: pendingGate, afterPhases: [...] }),
        approved: true,
        approvedAt: Date.now(),
        approvedBy: approvedById,
        notes,
      };
    });
    setPendingGate(null);
    // pipeline resumes
  }}
  onReject={() => {
    // pauses/stops the pipeline; gate stays unapproved
    setPendingGate(null);
  }}
  onClose={() => setPendingGate(null)}
/>
```

(Exact reject behavior and surrounding pipeline-resume logic belong to the
pipeline orchestration covered in Module 1; this doc focuses on the gate
modal and lock computation.)

---

## 3. Development notes

- **Duplicated `gateForPhase` helper**: both `ProjectWorkspace.tsx` and
  `ReviewGateModal.tsx` define an identical `gateForPhase` function. A
  shared `agents/constants.ts` export (or a small `agents/gates.ts` helper
  module) would remove the duplication. Low priority — the function is
  pure, ~3 lines, and derived directly from the also-duplicated `REVIEW_GATES`
  constant (which *is* shared), so drift risk is low but not zero.

- **`getLockedPhases` is not exported**: `tests/unit/getLockedPhases.test.ts`
  re-implements the function verbatim rather than importing it, because
  it's a private helper inside `ProjectWorkspace.tsx`. This is a copy that
  must be kept in sync manually if the real implementation changes. A
  worthwhile fast-follow: extract `getLockedPhases` and `GATE_UNLOCKS_AFTER`
  into `agents/constants.ts` (next to `REVIEW_GATES`, which they're derived
  from) and import the real function in the test.

- **Reject doesn't capture notes**: `onReject()` takes no arguments, so
  any text typed into the "Review Notes" textarea is discarded if the
  reviewer rejects rather than approves. This may be intentional (notes are
  framed as "feedback for this review gate" on approval) but is worth
  confirming with product — a rejected gate with no recorded reason could
  make it harder to understand why the pipeline paused.

- **Re-approval reset can target a gate other than the open one**: as noted
  in §2.4.7, running the prompt sandbox for an agent resets *that agent's
  own* covering gate, which may not be `gateId` (the gate currently open in
  the modal). A reviewer approving `gate5` who detours into editing a
  Phase 2 agent's prompt will silently re-lock `gate2_3` without obvious
  on-screen feedback beyond the dry-run result box. Acceptable for an admin
  power-user flow, but worth a UX pass if this becomes a common path.

- **Prompt sandbox makes a real API call**: `runDryRun` and
  `enhancePromptInSandbox` both call `api.callAgent` /
  `api.enhancePrompt`, which hit the OpenAI-backed `/api/...` backend
  endpoints. This is the only place in the reviewed UI where a modal
  triggers a live LLM call as a side effect of "testing" a prompt — it's a
  real, billable run whose result *replaces* the agent's saved output.
  There's no separate "preview only, don't save" option.

---

## 4. Test plan summary

See `docs/test-plans/review-gates-test-plan.md` for full scenario list.
Summary:

| Area | Test file | Approach |
|---|---|---|
| `getLockedPhases` (gate-lock computation) | `tests/unit/getLockedPhases.test.ts` (existing) | Pure-function unit tests, already complete — re-reviewed, no changes needed. |
| `ReviewGateModal` — view/edit/approve/reject | `tests/unit/ReviewGateModal-core.test.tsx` (new) | RTL render with mocked `DocumentViewer`/`ExportMenu`/`db/projectRepository`. |
| `ReviewGateModal` — prompt sandbox | `tests/unit/ReviewGateModal-prompt-sandbox.test.tsx` (new) | RTL render with mocked `services/api`, `agents/promptDefaults`, `utils/sanitize`. |

---

## 5. Deployment & maintenance notes

No schema changes, no new dependencies, no backend changes. Coverage
thresholds in `frontend/vite.config.ts` (`lines: 80, functions: 80,
branches: 75, statements: 80`, v8 provider, `src/**/*.{ts,tsx}`) are
unchanged. As with Modules 1 and 2, this sandbox cannot run
`npm run test:coverage` — verify locally:

```bash
cd frontend
npm install
npm run test:coverage
```

`ReviewGateModal.tsx` (463 lines) is large; the two new test files together
should cover the large majority of its render branches (view/edit/prompt
modes, assignee badges, approver select, injection warning, dry-run success
and error paths). The `enhancePromptInSandbox` and `savePromptForProject`
paths add modest additional coverage. `ProjectWorkspace.tsx` itself is out
of scope beyond the already-tested `getLockedPhases` logic — its broader
pipeline-orchestration UI belongs to a future module if prioritized.
