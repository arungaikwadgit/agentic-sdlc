# Session Compact — 2026-06-26
> Continuation reference for next chat session on the Agentic SDLC project.

---

## Project Context

- **App**: Agentic SDLC — `C:\Projects\SLDC - AI\agentic-sdlc\`
- **Stack**: React + TypeScript frontend, PostgreSQL backend, Railway + Vercel deploy target, Supabase Auth, RBAC
- **Bash note**: The bash sandbox mounts Windows files at `/sessions/.../mnt/SLDC - AI/` but the mount is stale/truncated. Always use the **Read tool** (Windows path) to inspect files, not `cat` in bash. TSC must be run locally from `frontend/`.

---

## What Was Completed This Session

### Bug 1 — Agent dependency retrieval (`get_agent_output` returns `found: false`)

**Root cause**: `PARALLEL_PHASES` caused all agents in a phase to start simultaneously. When `uxMockups` called `get_agent_output("interaction")`, `interaction` was still `status: 'running'` in the same phase — excluded from `priorOutputs` in `buildContext()`.

**Fix**: Split phases into dependency tiers so no agent starts before its dependency is `status: 'complete'`.

**Files changed**:

#### `frontend/src/types/agent.types.ts`
Added 4 new `PhaseId` values:
```typescript
export type PhaseId =
  | 'phase0' | 'phase1' | 'phase1b'
  | 'phase2'
  | 'phase2a'   // dataModel (depends on businessRules from phase2)
  | 'phase3'
  | 'phase3a'   // apiDesign + interaction (depend on phase3 outputs)
  | 'phase3c'   // uxMockups (depends on phase3a outputs)
  | 'phase3b'
  | 'phase4'
  | 'phase4a'   // codeReviewStandards + uiComponentLibrary + roadmapPlanner (depend on phase4)
  | 'phase5' | 'phase6' | 'phase7' | 'phase8';
```

#### `frontend/src/agents/constants.ts`
New `PHASE_ORDER`, `PARALLEL_PHASES`, `PHASE_AGENTS`, `REVIEW_GATES`, `PHASE_LABELS`, `PHASE_SDLC_STAGE`:

```typescript
// PHASE_ORDER (sequential)
['phase0','phase1','phase1b','phase2','phase2a','phase3','phase3a','phase3c','phase3b','phase4','phase4a','phase5','phase6','phase7','phase8']

// PARALLEL_PHASES
new Set(['phase2','phase3','phase3a','phase4','phase4a','phase7','phase8'])

// PHASE_AGENTS (key splits)
phase2:  ['businessRules','stakeholder','userStory','feasibility'],
phase2a: ['dataModel'],                              // after phase2
phase3:  ['architecture','uxResearch'],
phase3a: ['apiDesign','interaction'],                // after phase3
phase3c: ['uxMockups'],                              // after phase3a
phase3b: ['securityCompliance'],
phase4:  ['codeStructure','sprintPlanner','taskBreakdown','techDebt','codeSnippets'],
phase4a: ['codeReviewStandards','uiComponentLibrary','roadmapPlanner'],  // after phase4

// REVIEW_GATES
gate2: ['phase2','phase2a'] as PhaseId[],   // fires after phase2a completes
gate3: ['phase3','phase3a','phase3c','phase3b'] as PhaseId[],
```

#### `frontend/src/components/pipeline/ProjectWorkspace.tsx`
Updated `GATE_UNLOCKS_AFTER`:
```typescript
const GATE_UNLOCKS_AFTER: Record<string, string> = {
  gate1: 'phase1b',
  gate2: 'phase2a',   // was 'phase2'
  gate3: 'phase3b',
  gate5: 'phase5',
};
```
`gateToNext` values unchanged (`gate2: 'phase2'`, `gate3: 'phase3'` — these are resume-from phases, not gate-trigger phases).

`GATE_AFTER_PHASE_INDEX` in `pipelineEngine.ts` auto-updates because it uses `PHASE_ORDER.indexOf()` — no changes needed there.

---

### Bug 2 — Refresh Questions repeats old questions

**Root cause**: `suggestQuestions()` passed `[]` as the "already asked" list to `callLLMForQuestions`, so the LLM had no signal about what it had already generated.

**Fix**: Added `allShownQuestions` accumulator state. Every call to `suggestQuestions()` (Refresh) or `generateMoreQuestions()` appends to this accumulator and passes the full history to the LLM.

#### `frontend/src/components/pipeline/ReviewImprovePanel.tsx`

Added state:
```typescript
const [allShownQuestions, setAllShownQuestions] = useState<GapQuestion[]>([]);
```

Updated `suggestQuestions()`:
```typescript
async function suggestQuestions() {
  setGenerating(true);
  setError(null);
  setQuestions([]);
  try {
    // Pass ALL previously shown questions so the LLM generates a fresh set
    const parsed = await callLLMForQuestions(allShownQuestions);
    setQuestions(parsed);
    setAllShownQuestions((prev) => [...prev, ...parsed]);
  } catch (e) { setError(String(e)); }
  finally { setGenerating(false); }
}
```

Updated `generateMoreQuestions()`:
```typescript
async function generateMoreQuestions() {
  setGeneratingMore(true);
  setError(null);
  try {
    // Pass currently visible + all previously shown to avoid any repeats
    const seen = [...allShownQuestions, ...questions].filter(
      (q, idx, arr) => arr.findIndex((x) => x.id === q.id) === idx,
    );
    const more = await callLLMForQuestions(seen);
    setQuestions((prev) => [...prev, ...more]);
    setAllShownQuestions((prev) => [...prev, ...more]);
  } catch (e) { setError(String(e)); }
  finally { setGeneratingMore(false); }
}
```

The `callLLMForQuestions(existingQuestions)` function already builds an "Already asked" section from its argument — the fix just ensures `allShownQuestions` (full history) is passed, not `[]` or only the currently visible set.

---

### Bug 3 — C4Context Mermaid diagram crash

**Root cause**: Mermaid 11's C4Context renderer crashes with `Cannot read properties of undefined (reading 'x')` when a `Rel()` target is a `Boundary` ID. Boundaries are containers — not relatable nodes — so the layout engine finds no coordinates for them.

The `sanitize()` function was converting all `-->` arrows to `Rel()` without checking if either endpoint was a Boundary.

**Mermaid source that triggered the crash**:
```
C4Context
    Boundary(learnpath, "LearnPath LMS") {
        Person(student, "Student")
        ...
    }
    student --> learnpath : Uses    ← learnpath is a Boundary, not a node
```

**Fix**: Collect Boundary IDs first, then skip `-->` → `Rel()` conversion when either endpoint is a Boundary ID.

#### `frontend/src/components/documents/DiagramPreview.tsx`

In `sanitize()`, C4 block now:
```typescript
if (isC4) {
  // Collect Boundary IDs first
  const boundaryIds = new Set<string>();
  const C4_BOUNDARY_RE = /^\s*Boundary\s*\(\s*(\w+)\s*,/i;
  for (const line of lines) {
    const bm = line.match(C4_BOUNDARY_RE);
    if (bm) boundaryIds.add(bm[1]);
  }

  const C4_ARROW_RE = /^(\s*)(\w+)\s*-->\s*(\w+)(?:\s*:\s*"?([^"\n]*)"?)?\s*$/;
  for (const line of lines) {
    const arrowMatch = line.match(C4_ARROW_RE);
    if (arrowMatch) {
      const [, indent, from, to, label] = arrowMatch;
      // Skip if either endpoint is a Boundary — Mermaid can't layout to containers
      if (boundaryIds.has(from) || boundaryIds.has(to)) continue;
      const lbl = label ? label.trim() : '';
      out.push(`${indent}Rel(${from}, ${to}, "${lbl}")`);
      continue;
    }
    const split = line.replace(/(\.\s*")/g, '"').replace(C4_SPLIT_RE, ')\n');
    for (const sub of split.split('\n')) out.push(sub);
  }
  return out.join('\n');
}
```

---

## Files Changed This Session (complete list)

| File | Change |
|---|---|
| `frontend/src/types/agent.types.ts` | Added PhaseId values: phase2a, phase3a, phase3c, phase4a |
| `frontend/src/agents/constants.ts` | Restructured PHASE_ORDER, PARALLEL_PHASES, PHASE_AGENTS, REVIEW_GATES, PHASE_LABELS, PHASE_SDLC_STAGE |
| `frontend/src/components/pipeline/ProjectWorkspace.tsx` | Updated GATE_UNLOCKS_AFTER (gate2 → 'phase2a') |
| `frontend/src/components/pipeline/ReviewImprovePanel.tsx` | Added allShownQuestions state; updated suggestQuestions() and generateMoreQuestions() |
| `frontend/src/components/documents/DiagramPreview.tsx` | C4Context sanitizer: detect Boundary IDs, skip Rel() for boundary endpoints |

---

## Architecture: How Agent Dependencies Work

```
pipelineEngine.ts → buildContext() → snapshots project.agentRuns where status==='complete' → priorOutputs
L3 runtime → get_agent_output tool → reads ctx.priorOutputs[id]

If agent A and B are in the same PARALLEL phase:
  - Both start at the same time
  - Neither sees the other's output (not yet 'complete')
  - Solution: split into sequential sub-phases (A in phaseX, B in phaseX+1)
```

---

## Known Limitations / Next Steps

- **TSC verification**: Bash mount is stale. Run `cd frontend && npx tsc --noEmit` locally to confirm zero type errors.
- **GATE_AFTER_PHASE_INDEX** in `pipelineEngine.ts`: Uses `PHASE_ORDER.indexOf('phase3')` and `PHASE_ORDER.indexOf('phase4')` — these are stable index points, no changes needed.
- The `corrective check` for uxMockups in pipelineEngine.ts (from a prior session) checks whether all dependencies are complete before starting — this is still in place and works correctly with the new phase structure.

---

## Prior Session Work (pre-compaction, also complete)

- MockupPreview v2: tabs, style panel, dark mode, version picker (1–4 versions)
- Per-version distinct color themes for uxMockups agent
- Details tab with instructional empty state
- `quickRerunMockups` fixed to use `runSingleAgent` instead of `api.callAgent`
- Hardcoded "2" in pipelineEngine corrective check fixed to use `mockupVersionCount`
- Version count selector moved into MockupPreview toolbar (removed from RunAgentPanel)
