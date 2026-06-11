# Module 7: Project Workspace & Pipeline Orchestration

> Scope: the project workspace screen — the agent sidebar, document viewer area, pipeline run/stop/resume controls, the per-agent re-run + custom prompt flow, gate-locking logic, and the top-level view router and resume-on-load banner. Covers the orchestration UI layer that sits on top of `PipelineEngine` (data/engine internals are documented in Module 1 — Pipeline & Persistence). Review gate approval/rejection UI itself is documented in Module 3 — Review Gates; export/GitHub push UI is documented in Module 5.

**Source files covered:**

- `frontend/src/components/pipeline/ProjectWorkspace.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/common/ResumeModal.tsx`
- `frontend/src/hooks/useAgents.ts`
- `frontend/src/hooks/usePipeline.ts`
- `frontend/src/hooks/useProject.ts`
- `frontend/src/agents/constants.ts`

---

## 1. Requirements

### 1.1 Purpose

The Project Workspace is where a user runs the 26-agent SDLC pipeline for a project, watches its progress phase by phase, reviews and exports each agent's generated document, and intervenes when something needs a human decision: approving a review gate, re-running an agent with an edited prompt, or resuming an interrupted run. `App.tsx` is the thin top-level router that switches between the Dashboard and the Workspace, and `ResumeModal` is a floating banner that appears on app load if a pipeline was interrupted mid-run.

### 1.2 Functional Requirements

| ID | Requirement |
|---|---|
| R1 | `App` renders either `Dashboard` (default) or `ProjectWorkspace`, switching via local `view` state (`{ page: 'dashboard' }` or `{ page: 'project', projectId }`); there is no URL-based routing. |
| R2 | On mount, `App` reads the stored theme preference (`app:theme` setting: `'dark'`, `'light'`, or `'system'`) and applies it to `<html data-theme="...">`, resolving `'system'` via `window.matchMedia('(prefers-color-scheme: dark)')`. |
| R3 | `ResumeModal` queries for any project with `status === 'running'` on load. If one or more exist, it immediately marks each as `status: 'paused'` (a `'running'` status surviving an app restart is necessarily stale) and shows a dismissible banner offering to resume the first one. |
| R4 | The Workspace sidebar lists all 9 phases (`PHASE_ORDER`) with their agents (`PHASE_AGENTS`), each agent showing a status icon (idle/running/complete/error/skipped), the agent's display name, an optional "custom prompt" badge, and up to 3 assigned-team-member avatars (+N overflow). |
| R5 | A phase is "gate-locked" if any unapproved review gate covers an earlier phase boundary (see §2.2 `getLockedPhases`). Locked phases show a 🔒 icon, a "locked" hint, and their agent rows are disabled and unclickable. |
| R6 | After the last phase covered by a gate, a gate indicator renders below that phase's agent list: pending (🔒 Review gate), active/waiting (⏸ Waiting for your approval, clickable to reopen `ReviewGateModal`), or approved (✓ Approved · {approver name}). |
| R7 | Clicking "Run Pipeline" / "Resume Pipeline" starts a `PipelineEngine` from `project.currentPhase`. The button is disabled if `project.status === 'complete'` or if the project has no team members (`teamReady === false`), with a tooltip explaining the team requirement. |
| R8 | While the engine runs, the "Run Pipeline" button is replaced by "Stop", which calls `engine.abort()`, sets local `engineRunning = false`, and marks `project.status = 'paused'`. |
| R9 | If the team has zero members, a banner ("⚠ Add at least one team member before running the pipeline.") appears above the body with a "Set Up Team →" button that opens `ProjectSettings`. |
| R10 | Clicking a non-locked agent row selects it (`selectedAgent`), and the main content area renders based on that agent's run status: complete → `DocumentViewer` + export/re-run/GitHub-push controls; running (or a re-run in flight) → spinner placeholder; error → error message with "Retry Pipeline" and "Re-run with edited prompt" actions; otherwise → an idle placeholder prompting the user to run the pipeline or select an agent. |
| R11 | "↺ Re-run" opens an inline re-run panel for the selected agent, pre-filled with the agent's saved `promptOverride.fullPrompt` if one exists, otherwise the built-in `AGENT_DEFINITIONS[agentId].systemPrompt`. |
| R12 | The re-run panel offers: editing the prompt textarea; "▶ Confirm Re-run" (executes the agent once with the edited prompt, see §2.4); "💾 Save as project default" (persists the edited prompt as a `PromptOverride` for future pipeline runs of that agent, without running it); "✨ Enhance prompt" (calls `api.enhancePrompt` to AI-rewrite the current prompt); "Cancel" (closes the panel, discarding unsaved edits). |
| R13 | If a saved `PromptOverride` exists for the agent being re-run, the panel shows "✏ Using saved custom prompt for this agent." with a "Reset to built-in default" action that deletes the override and reloads the panel with `AGENT_DEFINITIONS[agentId].systemPrompt`. |
| R14 | If the re-run agent's phase is covered by a review gate, completing the re-run resets that gate to unapproved (with a note "Re-run of {agent name} — re-approval required"), sets `project.status = 'paused'` and `project.currentPhase` back to that agent's phase, and immediately reopens `ReviewGateModal` for that gate. |
| R15 | The header provides: Run/Resume/Stop, "Metrics XLSX" (`exportPipelineMetricsXlsx`), "Traceability CSV" (`exportTraceabilityCSV`), "Download All Artifacts" (zips every completed agent's output via `exportAllArtifactsZip`, or alerts "No completed artifacts to download yet." if none are complete), "⚙ Settings" (opens `ProjectSettings`/team panel), and a Simple/Expert mode toggle that flips `project.mode`. |
| R16 | "⚙ Settings" / the team panel auto-opens on first visit to a project with zero team members (`useEffect` keyed on `project?.id`). |
| R17 | "⇪ Push to GitHub" only appears when the selected agent is `sprintPlanner` or `taskBreakdown`, the current user is an admin (`isAdmin`), and `project.githubIntegrationId` is set. |

### 1.3 Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR1 | `project` is read via `useLiveQuery(() => db.projects.get(projectId), [projectId])`, so all UI (sidebar status icons, gate indicators, document viewer) updates reactively as `PipelineEngine` writes agent run results to IndexedDB — no polling or manual refresh. |
| NFR2 | Re-running an agent (§2.4) reconstructs the same `AgentPromptContext` shape the pipeline engine itself builds (domain, domain knowledge, prior outputs, team roster), so a re-run with an edited prompt produces output consistent with what an in-pipeline run of that agent would receive as context. |
| NFR3 | `PipelineEngine` instances are held in a `useRef`, not state, so starting/stopping the engine doesn't trigger unrelated re-renders; engine lifecycle callbacks (`onAgentStart`, `onGateReached`, etc.) drive the small set of local UI states (`selectedAgent`, `engineRunning`, `pendingGate`) that do need re-renders. |
| NFR4 | `ResumeModal` is rendered unconditionally inside `App`'s dashboard branch and returns `null` when there's nothing to resume, so it has no visual footprint on a clean app load. |

---

## 2. Design

### 2.1 App.tsx — top-level view router

```tsx
export type View = { page: 'dashboard' } | { page: 'project'; projectId: string };

function useThemeInit() {
  useEffect(() => {
    db.settings.get('app:theme').then((stored) => {
      const t = (stored?.value as string) ?? 'dark';
      if (t === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', t);
      }
    });
  }, []);
}

export default function App() {
  useThemeInit();
  const [view, setView] = useState<View>({ page: 'dashboard' });

  if (view.page === 'project') {
    return (
      <ProjectWorkspace
        projectId={view.projectId}
        onBack={() => setView({ page: 'dashboard' })}
      />
    );
  }

  return (
    <>
      <Dashboard onOpenProject={(id) => setView({ page: 'project', projectId: id })} />
      <ResumeModal onResume={(id) => setView({ page: 'project', projectId: id })} />
    </>
  );
}
```

`View` is a closed union with exactly two states. There is no browser history integration — navigating "back" from the workspace to the dashboard does not change the URL or respond to the browser back button; it's purely an in-memory state transition. The theme preference is applied once on mount via a direct DOM attribute write (`data-theme`), which the app's CSS is presumably keyed off of; `useThemeInit` does not subscribe to live changes, so a theme change made elsewhere (e.g. in `AppSettingsModal`) while the app is already running would need its own immediate `data-theme` write to take effect without a reload.

### 2.2 Gate-locking logic

```tsx
const GATE_UNLOCKS_AFTER: Record<string, string> = {
  gate1: 'phase1',
  gate2_3: 'phase3',
  gate5: 'phase5',
  gate6: 'phase6',
};

function getLockedPhases(project: Project): Set<string> {
  const locked = new Set<string>();
  const phaseIndex = Object.fromEntries(PHASE_ORDER.map((p, i) => [p, i]));
  for (const [gateId, lastCoveredPhase] of Object.entries(GATE_UNLOCKS_AFTER)) {
    const gate = project.reviewGates?.[gateId as ReviewGateId];
    if (!gate?.approved) {
      const cutoff = phaseIndex[lastCoveredPhase] ?? -1;
      PHASE_ORDER.forEach((ph, i) => { if (i > cutoff) locked.add(ph); });
    }
  }
  return locked;
}

function gateForPhase(phase: PhaseId): ReviewGateId | undefined {
  return (Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][])
    .find(([, phases]) => phases.includes(phase))?.[0];
}
```

`GATE_UNLOCKS_AFTER` is a second, hand-maintained mapping alongside `REVIEW_GATES` (from `agents/constants.ts`, §2.7) — it records, for each gate, the *last phase that gate's approval unlocks access beyond*. `getLockedPhases` is deliberately conservative: for every unapproved gate, it locks **every phase after that gate's cutoff**, regardless of whether a later gate has already been approved. In practice, because gates are approved in pipeline order, this produces the expected "locked from the first unapproved gate onward" behavior, but the function itself does not enforce or assume gate ordering — two unapproved gates simply union their locked-phase sets (idempotent, since both lock everything after their respective cutoffs anyway).

`gateForPhase` is the inverse lookup: given a phase, which gate (if any) has that phase in its `REVIEW_GATES` phase list. This is used by the re-run flow (§2.4) to determine whether re-running an agent should reset a gate.

### 2.3 ProjectWorkspace.tsx — top-level structure

```tsx
export default function ProjectWorkspace({ projectId, onBack }: Props) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [pendingGate, setPendingGate] = useState<ReviewGateId | null>(null);
  const [engineRunning, setEngineRunning] = useState(false);
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [downloadingArtifacts, setDownloadingArtifacts] = useState(false);
  const [showGithubPush, setShowGithubPush] = useState(false);
  const engineRef = useRef<PipelineEngine | null>(null);

  // Re-run state
  const [rerunAgent, setRerunAgent] = useState<AgentId | null>(null);
  const [rerunPrompt, setRerunPrompt] = useState('');
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [promptSaved, setPromptSaved] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  useEffect(() => {
    if (project && (project.teamMembers ?? []).length === 0) setShowTeamPanel(true);
  }, [project?.id]);

  // ... startPipeline, handleStop, openRerun, savePromptOverride,
  //     enhanceRerunPrompt, resetPromptOverride, confirmRerun, downloadAllArtifacts
}
```

Thirteen pieces of local state in a single component — this is a large, monolithic "screen" component rather than a composition of smaller hooks/components. There is no `usePipeline`/`useAgents`/`useProject` hook usage (those exist in `hooks/` but are unused — see §3.1); all engine wiring, gate logic, and re-run logic live directly in `ProjectWorkspace`.

### 2.4 startPipeline / handleStop

```tsx
const startPipeline = useCallback(async (fromPhase?: PhaseId) => {
  if (!project) return;
  setEngineRunning(true);
  const engine = new PipelineEngine(projectId, {
    onAgentStart: (agentId) => { setSelectedAgent(agentId); },
    onAgentComplete: (agentId) => { setSelectedAgent(agentId); },
    onAgentError: (_agentId, _err) => {},
    onPhaseComplete: (_phase) => {},
    onGateReached: (gateId) => { setEngineRunning(false); setPendingGate(gateId); },
    onPipelineComplete: () => { setEngineRunning(false); },
    onPipelineError: (_err) => { setEngineRunning(false); },
  });
  engineRef.current = engine;
  await engine.run(fromPhase);
}, [project, projectId]);

const handleStop = () => {
  engineRef.current?.abort();
  setEngineRunning(false);
  updateProject(projectId, (p) => { p.status = 'paused'; });
};
```

`startPipeline` always selects whichever agent the engine is currently working on, so the document viewer auto-follows pipeline progress (the user sees each document populate as it's generated). `onAgentError` and `onPhaseComplete` are no-ops here — error surfacing happens passively, via the `selectedRun?.status === 'error'` branch in the render (§2.6), once `selectedAgent` happens to be the errored agent (which it will be, since `onAgentStart` selected it before it errored). `onGateReached` is the only callback that stops the engine and surfaces UI (`pendingGate`), which causes `ReviewGateModal` to render (§2.6). `handleStop` aborts the engine and persists `status: 'paused'` so the project survives a reload in a resumable state (picked up by `ResumeModal`, §2.8, only if status were `'running'` — see Development Note 3.3).

### 2.5 Re-run flow

```tsx
function openRerun(agentId: AgentId) {
  const def = AGENT_DEFINITIONS[agentId];
  const savedOverride = project?.promptOverrides?.find((o) => o.agentId === agentId);
  setRerunAgent(agentId);
  setRerunPrompt(savedOverride?.fullPrompt ?? def?.systemPrompt ?? '');
  setRerunError(null);
  setPromptSaved(false);
}

async function savePromptOverride() {
  if (!rerunAgent || !project) return;
  await updateProject(projectId, (p) => {
    const existing = p.promptOverrides.findIndex((o) => o.agentId === rerunAgent);
    const entry = { agentId: rerunAgent, patch: [], fullPrompt: rerunPrompt, updatedAt: Date.now() };
    if (existing >= 0) p.promptOverrides[existing] = entry;
    else p.promptOverrides.push(entry);
  });
  setPromptSaved(true);
}

async function enhanceRerunPrompt() {
  if (!rerunAgent) return;
  setEnhancing(true);
  setRerunError(null);
  try {
    const improved = await api.enhancePrompt(rerunPrompt, AGENT_DEFINITIONS[rerunAgent]?.name);
    if (improved) { setRerunPrompt(improved); setPromptSaved(false); }
  } catch (e) {
    setRerunError(`Enhance failed: ${String(e)}`);
  } finally {
    setEnhancing(false);
  }
}

async function resetPromptOverride(agentId: AgentId) {
  await updateProject(projectId, (p) => {
    p.promptOverrides = p.promptOverrides.filter((o) => o.agentId !== agentId);
  });
  if (rerunAgent === agentId) {
    const def = AGENT_DEFINITIONS[agentId];
    setRerunPrompt(def?.systemPrompt ?? '');
    setPromptSaved(false);
  }
}
```

`PromptOverride.patch` (an RFC 6902 JSON Patch array per the type definition) is never populated by this UI — `savePromptOverride` always writes `patch: []` and relies on `fullPrompt` to carry the entire replacement prompt. `fullPrompt` is documented (in `project.types.ts`) as taking precedence over `patch` when both are set, so this is consistent, but it means the JSON-Patch mechanism is currently dead weight in the type — see Development Note 3.2. `enhanceRerunPrompt` mutates only local state (`rerunPrompt`); the AI-improved prompt is not persisted until the user separately clicks "Save as project default" (R12) or runs `confirmRerun` (which doesn't persist the prompt either — only `savePromptOverride` does).

### 2.6 confirmRerun — context reconstruction and gate reset

```tsx
async function confirmRerun() {
  if (!rerunAgent || !project) return;
  const def = AGENT_DEFINITIONS[rerunAgent];
  if (!def) return;
  setRerunning(true);
  setRerunError(null);

  try {
    const { DOMAINS } = await import('@/agents/domains');
    const domain = DOMAINS[project.domain];
    const members = project.teamMembers ?? [];
    const assignments = project.agentAssignments ?? [];
    const priorOutputs: Partial<Record<AgentId, string>> = {};
    for (const [id, run] of Object.entries(project.agentRuns)) {
      if (run?.status === 'complete' && run.output) priorOutputs[id as AgentId] = run.output;
    }
    const teamRoster = members.map((m) => ({
      name: m.name, role: m.role,
      agents: assignments.filter((a) => a.memberIds.includes(m.id)).map((a) => a.agentId),
    }));
    const domainContext = project.domainKnowledge
      ? `${project.domainKnowledge}\n\n---\n\n${domain.context}`
      : domain.context;
    const ctx = {
      projectName: project.name, projectDescription: project.description,
      domain: domain.id, domainContext, priorOutputs, teamRoster,
    };

    const userPrompt = def.buildUserPrompt(ctx);
    const resp = await api.callAgent({ systemPrompt: rerunPrompt, userPrompt });
    const output = api.extractText(resp);

    await updateAgentRun(projectId, rerunAgent, {
      agentId: rerunAgent, status: 'complete', output,
      tokensUsed: resp.usage?.total_tokens ?? 0, completedAt: Date.now(),
    });

    const agentPhase = def.phase as PhaseId;
    const coveringGate = gateForPhase(agentPhase);
    if (coveringGate) {
      await updateProject(projectId, (p) => {
        if (p.reviewGates[coveringGate]) {
          p.reviewGates[coveringGate] = {
            ...p.reviewGates[coveringGate]!,
            approved: false, approvedAt: undefined, approvedBy: undefined,
            notes: `Re-run of ${def.name} — re-approval required`,
          };
          p.status = 'paused';
          p.currentPhase = agentPhase;
        }
      });
      setPendingGate(coveringGate);
    }

    setSelectedAgent(rerunAgent);
    setRerunAgent(null);
  } catch (e) {
    setRerunError(String(e));
  } finally {
    setRerunning(false);
  }
}
```

The comment "Build context same as pipeline engine" is the load-bearing design intent: this function hand-duplicates the `AgentPromptContext` construction that `PipelineEngine` performs internally (Module 1), including the same domain-knowledge prepending rule (`project.domainKnowledge` + `\n\n---\n\n` + `domain.context`, identical to what Module 6 documents for the wizard). `priorOutputs` is rebuilt from **all** currently-complete agent runs (not just those that ran before this agent in pipeline order) — so a re-run can see outputs from agents later in the pipeline if they happened to already run, which the original pipeline run of this agent would not have seen. `DOMAINS` is dynamically imported (`await import('@/agents/domains')`) rather than statically imported at the top of the file — likely to avoid a circular import or to defer loading the (large) domain registry until a re-run actually happens, but it has no other functional effect since the import is awaited before use.

If the re-run agent's phase is covered by a review gate (`gateForPhase`), the gate is unconditionally reset to unapproved — even if the gate had nothing to do with *this specific agent's* output (a gate can cover multiple phases/agents). `project.currentPhase` is rewound to the re-run agent's phase and `pendingGate` is set, which reopens `ReviewGateModal` (§2.6 of Module 3) for re-approval. If the agent's phase has **no** covering gate, the re-run's output is saved and selected with no further side effects — the pipeline's `currentPhase`/`status` are untouched.

### 2.7 Sidebar rendering

```tsx
{PHASE_ORDER.map((phase) => {
  const agents = PHASE_AGENTS[phase];
  const allComplete = agents.every((a) => project.agentRuns[a]?.status === 'complete');
  const isPhaseGateLocked = lockedPhases.has(phase);

  const gateAfterThisPhase = (Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][])
    .find(([, phases]) => phases[phases.length - 1] === phase)?.[0];
  const gateBeforeThisPhase = (Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][])
    .find(([gateId]) => {
      const cutoffPhase = GATE_UNLOCKS_AFTER[gateId];
      const cutoffIdx = PHASE_ORDER.indexOf(cutoffPhase as PhaseId);
      const phaseIdx = PHASE_ORDER.indexOf(phase as PhaseId);
      return phaseIdx === cutoffIdx + 1;
    })?.[0];
  // ... renders phase header, agent rows, gate indicator
})}
```

For each phase, the sidebar computes: whether all its agents are complete (✓ shown next to the phase label); whether a gate's *last covered phase* is this phase (`gateAfterThisPhase` — the gate indicator renders below this phase's agent list); and whether this phase is the *first phase after* some gate's cutoff (`gateBeforeThisPhase` — used only for the locked-phase hint text, to decide whether to say "approve the review gate above" vs. "approve preceding gate"). Each agent row computes its status icon/color (`STATUS_ICON`/`STATUS_COLOR` maps keyed by `idle | running | complete | error | skipped`), whether it has a saved prompt override (✏ badge), and up to 3 assigned-member avatars rendered via the `initials()` helper imported from `ProjectSettings.tsx` (a cross-module utility import — see Development Note 3.4).

### 2.8 ResumeModal.tsx

```tsx
export default function ResumeModal({ onResume }: Props) {
  const [dismissed, setDismissed] = useState(false);

  const runningProjects = useLiveQuery(
    () => db.projects.where('status').equals('running').toArray()
      .then((ps) => ps.map((p): ProjectSummary => ({
        id: p.id, name: p.name, domain: p.domain, status: p.status,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
        completedAgents: Object.values(p.agentRuns).filter((r) => r?.status === 'complete').length,
        totalAgents: 22,
      }))),
    []
  ) ?? [];

  useEffect(() => {
    runningProjects.forEach((p) => {
      updateProject(p.id, (proj) => { proj.status = 'paused'; });
    });
  }, [runningProjects.length]);

  if (dismissed || runningProjects.length === 0) return null;
  // ... renders fixed-position banner with Dismiss / Resume → buttons
}
```

`ResumeModal` is the "B14 — Pipeline Resume on App Load" feature: any project left in `status: 'running'` (which can only happen if the app was closed/crashed mid-pipeline-run, since a clean stop always sets `'paused'`) is immediately flipped to `'paused'` and surfaced in a dismissible bottom-right banner. Clicking "Resume →" calls `onResume(runningProjects[0].id)` — note this **always targets the first** running project in the array, even if multiple are interrupted (the banner text does say "{N} pipelines were interrupted" for N > 1, but only offers to resume one). `ProjectSummary.totalAgents` is hardcoded to `22` here, while `db/projectRepository.ts`'s `listProjects()` (Module 6) computes the same field from `TOTAL_AGENTS = 26` (`agents/constants.ts`) — see Development Note 3.5. This component does not itself navigate to the resumed project's pipeline state; resuming just switches `App`'s view to `ProjectWorkspace`, which then shows "Resume Pipeline" (since `project.status === 'paused'`) for the user to click.

### 2.9 agents/constants.ts — phase/gate registry

```ts
export const TOTAL_AGENTS = 26;

export const PHASE_ORDER: PhaseId[] = [
  'phase1', 'phase1b', 'phase2', 'phase3', 'phase4', 'phase5', 'phase6', 'phase7', 'phase8',
];

export const PARALLEL_PHASES: Set<PhaseId> = new Set([
  'phase2', 'phase3', 'phase4', 'phase7', 'phase8',
]);

export const PHASE_AGENTS: Record<PhaseId, AgentId[]> = {
  phase1: ['manager'],
  phase1b: ['projectCharter', 'brd'],
  phase2: ['stakeholder', 'userStory', 'businessRules', 'feasibility', 'dataModel'],
  phase3: ['architecture', 'apiDesign', 'uxResearch', 'interaction', 'uxMockups'],
  phase4: ['sprintPlanner', 'taskBreakdown', 'techDebt', 'codeStructure', 'codeSnippets', 'uiComponentLibrary'],
  phase5: ['testPlan', 'testCases'],
  phase6: ['securityCompliance'],
  phase7: ['devopsEngineer', 'infraEngineer'],
  phase8: ['observabilityEngineer', 'onCallEngineer'],
};

export const REVIEW_GATES = {
  gate1: ['phase1', 'phase1b'] as PhaseId[],
  gate2_3: ['phase2', 'phase3'] as PhaseId[],
  gate5: ['phase5'] as PhaseId[],
  gate6: ['phase6'] as PhaseId[],
};

export const PHASE_LABELS: Record<PhaseId, string> = { /* ... */ };
```

`TOTAL_AGENTS` (26) is the sum of all `PHASE_AGENTS[*]` array lengths (1+2+5+5+6+2+1+2+2 = 26) — confirmed by counting. `PARALLEL_PHASES` is exported and presumably consumed by `PipelineEngine` (Module 1) to decide whether a phase's agents run concurrently or sequentially; `ProjectWorkspace` itself does not read `PARALLEL_PHASES`. Phases `phase4` (Dev Planning) and `phase8` (Operations) have no covering `REVIEW_GATES` entry and are therefore never gate-locked by `getLockedPhases` — they unlock as soon as the preceding gated phase is approved.

---

## 3. Development Notes

### 3.1 `usePipeline`, `useAgents`, and `useProject` are unused dead code

`frontend/src/hooks/usePipeline.ts`, `useAgents.ts`, and `useProject.ts` each implement a clean, reusable abstraction over exactly the concerns `ProjectWorkspace` needs (engine lifecycle + gate state, per-phase agent status grouping, and project read/save/delete respectively) — but none of the three is imported anywhere in the codebase. `ProjectWorkspace` reimplements all of this logic inline using its own `useState`/`useRef`/`useLiveQuery` calls. These hooks appear to be an earlier or parallel design that was superseded without being removed. They add no runtime cost (dead code is tree-shaken or simply unreferenced) but represent a maintenance trap: a future change to gate-handling or agent-status logic made only in `ProjectWorkspace` will silently diverge from these hooks, and a developer searching for "where is pipeline state managed" may reasonably start in `usePipeline.ts` and be misled.

### 3.2 `PromptOverride.patch` (JSON Patch) is defined but never populated

The `PromptOverride` type carries both `patch: object[]` (RFC 6902 JSON Patch ops) and `fullPrompt?: string`, with `fullPrompt` documented as taking precedence. The only writer of `PromptOverride` records, `savePromptOverride` (§2.5), always sets `patch: []` and always sets `fullPrompt`. `frontend/src/utils/jsonPatch.ts` exists in the codebase (suggesting JSON-Patch tooling was built for this), but `ProjectWorkspace` doesn't use it. Either the patch-based partial-override mechanism was planned but not wired into the UI, or it was wired in and later replaced by the simpler full-prompt-replacement flow without removing the unused field/type.

### 3.3 `ResumeModal` only fires for `status === 'running'`, but `handleStop` sets `'paused'`

The only way a project ends up with `status: 'running'` persisted to IndexedDB appears to be if the app is closed (or crashes) while `PipelineEngine.run()` is mid-flight, without `handleStop`/`onPipelineComplete`/`onGateReached` ever firing to flip status to `'paused'` or leave it `'complete'`. This is exactly the "interrupted pipeline" scenario `ResumeModal` is designed to catch (per its "B14" comment). However, it means a user who closes the app while a *re-run* (`confirmRerun`, §2.6) is in flight — which does not go through `PipelineEngine` and does not write `status: 'running'` at all — would not trigger `ResumeModal`, and the agent's run would simply remain in whatever status it was last persisted as (likely still `'running'` from before the re-run started, or `'complete'` from its prior run, depending on whether `updateAgentRun` had been called yet).

### 3.4 `initials()` is imported from `ProjectSettings.tsx`, not a shared utility

`ProjectWorkspace` imports both the default export and a named `initials` helper from `'../settings/ProjectSettings'`:

```tsx
import ProjectSettings from '../settings/ProjectSettings';
import { initials } from '../settings/ProjectSettings';
```

`initials` (used to render team-member avatar initials in the sidebar, §2.7) is a small, presumably pure string-formatting utility with no obvious dependency on `ProjectSettings`'s component logic. Importing a named helper from a component file (rather than a shared `utils/` module) couples `ProjectWorkspace` to `ProjectSettings`'s module graph — any change to `ProjectSettings.tsx` that introduces a new top-level side effect or heavy import would be pulled into `ProjectWorkspace` as well.

### 3.5 `ResumeModal`'s hardcoded `totalAgents: 22` vs. `TOTAL_AGENTS = 26`

`ResumeModal` constructs its own `ProjectSummary` objects (rather than calling `listProjects()` from `db/projectRepository.ts`, which Module 6 documents as the canonical summary-projection function) and hardcodes `totalAgents: 22`. `agents/constants.ts` defines `TOTAL_AGENTS = 26`, and `listProjects()` uses that constant. This means `ResumeModal`'s `ProjectSummary.totalAgents` is stale by 4 — though in practice `ResumeModal` doesn't currently render a progress bar or percentage from `totalAgents`/`completedAgents` (the banner text only shows project name and count of interrupted projects), so the discrepancy is currently inert. If `ResumeModal`'s UI is ever extended to show progress, this hardcoded value would need to be corrected to `TOTAL_AGENTS` (or the whole summary construction replaced with a call to `listProjects()`).

---

## 4. Test Plan Summary

| Area | Test file | Coverage |
|---|---|---|
| Gate-locking logic (`getLockedPhases`, `gateForPhase`) | `tests/unit/ProjectWorkspace-gates.test.ts` | Pure-function tests: no gates approved → all phases after gate1's cutoff locked; approving gate1 unlocks phase2/phase3 but gate2_3 still locks phase4+; approving all gates → no locked phases; `gateForPhase` returns the correct gate id for phases inside `REVIEW_GATES`, and `undefined` for phases (phase4, phase8) with no covering gate. |
| Pipeline run/stop controls | `tests/unit/ProjectWorkspace-controls.test.tsx` | "Run Pipeline" label varies by `project.status` (draft/paused/complete); button disabled when `status === 'complete'` or no team members (with tooltip); clicking Run constructs and runs a `PipelineEngine`; "Stop" appears while running, calls `engine.abort()` and sets `status: 'paused'`; team-required banner renders/hides based on `teamMembers.length`. |
| Re-run flow | `tests/unit/ProjectWorkspace-rerun.test.tsx` | Opening re-run pre-fills from saved override or `AGENT_DEFINITIONS` default; "Reset to built-in default" clears the override; "Save as project default" persists `fullPrompt` with `patch: []`; "Confirm Re-run" calls `api.callAgent` with the edited prompt and a context object built from `project.domainKnowledge`+domain context, prior complete outputs, and team roster; on success, a covering gate is reset to unapproved and `pendingGate` is set; agents in non-gated phases (phase4/phase8) complete without resetting any gate. |
| ResumeModal | `tests/unit/ResumeModal.test.tsx` | Renders nothing when no project has `status: 'running'`; renders the banner and flips status to `'paused'` for each running project found; "Dismiss" hides the banner without further side effects; "Resume →" calls `onResume` with the first running project's id even when multiple exist. |

---

## 5. Deployment & Maintenance Notes

- No new environment variables, integrations, or backend routes — this module is pure frontend orchestration over IndexedDB (`db.projects`, `db.settings`) and the existing `api.callAgent`/`api.enhancePrompt` calls (Module 1's backend proxy).
- Theme application (`useThemeInit`) is a one-time-on-mount DOM write; if live theme switching while the app is running is ever required, this effect would need to subscribe to `db.settings` changes for the `app:theme` key (e.g. via `useLiveQuery`) instead of a one-shot `.then()`.
- If `PHASE_AGENTS` gains or loses an agent in any phase, `TOTAL_AGENTS` in `agents/constants.ts` must be updated to match — and `ResumeModal`'s hardcoded `22` (Development Note 3.5) should be corrected or replaced with `TOTAL_AGENTS` at the same time to avoid further drift.
- The unused `usePipeline`/`useAgents`/`useProject` hooks (Development Note 3.1) are candidates for removal in a future cleanup pass, or for an intentional refactor of `ProjectWorkspace` to actually use them — either direction reduces the current divergence risk.
- Coverage thresholds in `frontend/vite.config.ts` (lines: 80, functions: 80, branches: 75, statements: 80, v8 provider, `src/**/*.{ts,tsx}`) are unchanged. As with prior modules, this sandbox cannot run `npm run test:coverage` — verify locally:

```
cd frontend
npm install
npm run test:coverage
```
