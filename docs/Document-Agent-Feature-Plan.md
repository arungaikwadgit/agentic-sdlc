# Document Agent — Feature Plan (Revised — Decisions Locked)

Prepared: 2026-07-07
Revised: 2026-07-07 (v2 — incorporates your decisions on storage, trigger model, Admin controls, and
codebase investigation findings)
Status: **Decisions locked. Section 9 is a concrete Phase 1 file list. No code written yet.**
Owner: Engineering & Architecture

---

## 1. What you asked for

> "Create a document agent that reads these md files, creates a separate project specific copy under
> the `<project>_docs` folder. Update these md files with the project context gained from the earlier
> agents as output. E.g. PRD gets context from Orchestrator and project context, etc."

Restated: take the 72-document "Enhanced Prompt" pack in `AppDocs/` (which today is a generic, reusable
template library — the same 72 prompts apply to any project) and turn it into a **per-project deliverable**:
for a specific project running through the pipeline, produce 72 filled-in, project-specific documents,
each grounded in the outputs of the pipeline agents that have already run for that project, organized under
a project-named folder.

This plan covers what that requires, what already exists in the codebase that we can reuse, what's
genuinely new work, the open decisions I need you to make before I write any code, and a phased rollout.

**No implementation has started.** This is the review document you asked for.

---

## 2. Important distinction (read this first)

There are **two separate document universes** in this repo and it's easy to conflate them:

1. **Platform self-documentation** — `docs/Agentic-SDLC-Architecture.docx` and similar files describe
   *the Agentic SDLC platform itself* (its own architecture, its own CI/CD, its own RBAC). This is what I
   updated earlier in this engagement.
2. **The AppDocs 72-document prompt pack** — describes *whatever project a user runs through the platform*.
   These are meant to be regenerated fresh, per customer project, using that project's own domain context
   and agent outputs. This is what this feature plan is about.

The Document Agent operates entirely in universe (2). It does not touch or regenerate universe (1).

**You confirmed this reading directly:** "this plan is for the project documentation and NOT for the
application level documents." Locked, no ambiguity left here.

---

## 2.1 New requirement: context absorption before first generation

You added a requirement not in the original draft: "before triggering documentation agent, make sure the
agent runs tools to absorb the project context like name, tech stack, documents, style guides etc."

This is a real gap in the original plan and you're right to flag it. The original Section 4.1 step 2 called
`get_agent_output`, `get_domain_context`, and `get_team_roster`, but those only return what the *pipeline
agents* produced — they don't independently pull in uploaded project documents, style guides, or the
project's declared tech stack as a standalone step. Fixing this:

Before the Document Pack Runner generates *anything* for a project (its very first invocation for that
project, not per-document), it runs a one-time **Context Absorption step**:

1. `get_domain_context()` — existing tool, returns project name, industry, methodology, team size.
2. Read `project.contextDocuments` (uploaded .pdf/.docx/.txt/.xlsx/.xls/.csv files, per the Architecture
   Document Section 3.2) — these are already parsed and stored on the project object today; the Document
   Pack Runner just needs to include their extracted text in its context payload, which nothing currently
   does automatically for a new agent.
3. `get_style_guide()` — existing tool (per `tools.ts`, listed in `RESEARCH_TOOLS`), pulls any style guide
   already registered for the project.
4. Tech stack: **correction to my own earlier claim.** I initially assumed no structured field existed here.
   Rechecked before writing code: it does. `Project.techStack?: string` (`project.types.ts:190`) is already
   a first-class field, already threaded into `AgentPromptContext.techStack` (`agent.types.ts:164`), and
   already available to every L3 agent. The Context Absorption step just reads it directly — no inference
   needed, no gap.

This context bundle gets cached once per project (not re-fetched per document) and passed into every
`DocumentSpec` generation alongside that document's specific `sourceAgents` output.

---

## 3. What already exists (so we don't rebuild it)

I checked the actual codebase before writing this plan rather than assuming. Relevant existing pieces:

| Capability | File | Status |
|---|---|---|
| 30-agent pipeline across 11 phase groups (`phase0`…`phase8`) | `frontend/src/agents/definitions.ts` | Implemented |
| `get_agent_output(agent_id)` tool — fetch another agent's finished output by ID | `frontend/src/agents/tools.ts:186` | **Already implemented.** This is the exact primitive we need for "PRD gets context from Orchestrator." |
| `get_domain_context` tool | `frontend/src/agents/tools.ts:163` | Already implemented |
| `get_team_roster` tool | `frontend/src/agents/tools.ts:138` | Already implemented |
| Per-document export to `.md` / `.docx` / `.pdf` | `frontend/src/services/exporters/documentExporter.ts` | Implemented |
| "Export All" as a single ZIP (`{ProjectShortName}_artifacts.zip`) via JSZip + file-saver | `documentExporter.ts:590` (`exportAllArtifactsZip`) | Implemented, **flat structure only** — no subfolders yet |
| L3 Plan-Act-Observe execution loop, reusable for any new agent | `frontend/src/services/l3Runtime.ts` | Implemented |
| `services/traceability.ts` | exists | Not yet inspected in detail — may already cover part of Requirements Traceability Matrix (doc #16). Needs a look before building that one. |

**Implication:** the hard infrastructure (fetching another agent's output, running an L3 loop, exporting a
zip) already exists. This is much more an *authoring/mapping* problem than a *plumbing* problem.

### 3.1 Sixteen of the 72 documents already have a direct source agent

Comparing the 72-document list against the 30 existing agents, these already exist as agent output today
and mostly need reformatting into the target document's structure, not fresh generation:

| # | AppDocs Document | Existing Agent (id) |
|---|---|---|
| 1 | Project Charter | `projectCharter` |
| 4 | Stakeholder Register | `stakeholder` (Stakeholder Analysis) |
| 9 | Business Requirements Document | `brd` |
| 10 | Product Requirements Document | `manager` (PRD Agent) |
| 14 | User Stories / Use Case Document | `userStory` |
| 17 | Domain Context Document | *(not an agent — the domain context is already a first-class field on every project, exposed via `get_domain_context`)* |
| 18 | Architecture Document | `architecture` |
| 23 | Data Model / ERD Document | `dataModel` |
| 24 | API Design Document | `apiDesign` |
| 26 | Security Architecture Document | `securityCompliance` |
| 27 | Infrastructure Architecture Document | `infraEngineer` |
| 31 | UX Research Document | `uxResearch` |
| 33 | Wireframes / Mockups Document | `uxMockups` |
| 37/39 | Coding Standards Document / Code Review Checklist | `codeReviewStandards` (one source, two framings) |
| 43 | Test Plan | `testPlan` |
| 44 | Test Case Document | `testCases` |
| 64 | Monitoring and Observability Document | `observabilityEngineer` |

**Correction caught during implementation:** the table below has 17 rows but lists 19 actual document
numbers (one row covers 2 documents sharing a source agent, and #16 was added after confirming
`traceability.ts` — see Section 5). The prose below originally said "sixteen"; the accurate count, and the
one `documentSpecs.ts` actually implements, is **19**.

The remaining **~53 documents have no single existing source agent** and require synthesizing across
multiple agents' outputs (see the full mapping in Section 6). A further **4 documents are only partially
answerable from what the platform currently captures**, because they need real execution/production data
the platform doesn't collect yet (flagged in Section 6.4) — I'm calling this out now rather than quietly
generating confident-sounding filler for them later.

---

## 3.2 New: Admin Panel controls per project

Your addition: "Add a feature on Admin secret page to control these md files per project." I checked
`frontend/src/components/admin/AdminPanel.tsx` to find where this actually fits rather than guessing at a
page name.

There's no page literally called "secret" — the closest match is the existing **Admin Panel's Danger
Zone**, which lives inside its `SettingsTab` (`AdminPanel.tsx:996`) as a `sectionHeader`, not a separate
page. But the better fit for *per-project* controls is the **Projects tab** (`ProjectsTab`, ~line 314):
selecting a project already opens a detail pane with `actionGroup` blocks — Override Status, Review Gates,
Pipeline, Delete Project (lines 381-417). A new "Documentation" `actionGroup` block slots in next to those
directly, following the exact structure already there.

Proposed contents of that block:

- **Enable/disable toggle** for the Document Agent on this project. New field `Project.documentAgentEnabled?:
  boolean` (default `true`) in `frontend/src/types/project.types.ts`, toggled via an `async function
  toggleDocAgent()` following the identical pattern already used for `disabledRoleIds` in
  `frontend/src/components/settings/ProjectSettings.tsx:441-449`. Both trigger hooks (Section 4.4) check
  this flag first and no-op if disabled.
- **Status summary**: "41/72 generated · 12 stale · 19 pending" computed from `project_documents` row count
  vs. `DOCUMENT_PACK` length, plus a stale count from hash comparison.
  - **Regenerate All** button for admins — a manual escape hatch that re-runs Hook 2's logic on demand,
  independent of a review gate.

If this needs to be a full standalone tab instead of a block inside `ProjectsTab`, that's a small change to
the `Tab` type (`'health'|'projects'|'agents'|'settings'|'backend'|'tests'|'backlog'`, line 62) — flagging
it as an easy pivot if the single-block version feels too buried once built, rather than treating it as a
now-or-never decision.

---

## 4. Proposed architecture

### 4.1 Not 72 independent LLM agents

Running 72 full LLM generations per project, on top of the existing 30-agent pipeline, is expensive and
slow, and most of the 72 prompts share near-identical scaffolding (same Identity/World Context, same Mermaid
safety rules, same current/target-state labeling, same quality-bar checklist — I confirmed this by reading
all 8 Discovery & Initiation prompts and one Architecture prompt; they're templated, not bespoke per doc).

Proposed approach: **one new "Document Pack" execution engine**, driven by data, not 72 separate
`AgentDefinition` objects:

```
DocumentSpec {
  id: string                 // e.g. "01_project_charter"
  title: string
  category: string            // e.g. "Discovery_Initiation" — matches AppDocs folder
  promptFile: string          // path to the corresponding AppDocs/*.md prompt
  sourceAgents: AgentId[]     // which get_agent_output() calls to make first
  outputFormat: 'docx' | 'md' // per each prompt file's own stated format
  dataDependent?: boolean      // true for the 4 docs needing real execution/production data
}

const DOCUMENT_PACK: DocumentSpec[] = [ ...72 entries, generated from Section 6's table... ]
```

A single **Document Pack Runner** iterates `DOCUMENT_PACK`, and for each entry:

1. Reads the AppDocs prompt file (already on disk, no change needed there).
2. Calls `get_agent_output()` for every agent listed in `sourceAgents`, plus always `get_domain_context()`
   and `get_team_roster()` (matching your PRD example: "Orchestrator and project context").
3. If a project-specific copy of this document already exists (see 4.2), reads it too and passes it in as
   "existing content to preserve/improve" — this reuses the merge instructions already written into every
   AppDocs prompt file, so no new merge logic needs to be invented.
4. Runs one L3 loop (reusing `l3Runtime.ts`) with a system prompt built from the AppDocs prompt file's
   content plus the fetched context, producing the filled document.
5. Saves the result (see 4.2) and marks that `DocumentSpec` complete for this project.

This reuses the existing L3 runtime, tool system, and rate-limit/concurrency handling (5 concurrent, 1.5s
stagger) rather than inventing a parallel execution model.

### 4.2 Where the project-specific copies live — locked to server-side persisted storage

You overrode my original recommendation (Option A, ZIP-only) and chose server-side persistence: "create
server side persisted folder per project," reinforced by your Phase 2 rollout answer, "actual word document
per project" (not a ZIP export). Before designing this I checked what actually exists in the backend rather
than assuming — here's what's true today, and it changes the design from what "server-side folder" might
first suggest:

**What I verified in the codebase:** there is no filesystem or object-storage precedent anywhere in this
app. The only `fs.writeFile` call in the whole backend is `proxy.js:1183`, and it rewrites the `.env` file
for the admin Settings panel — nothing writes per-entity files today. No `multer`, no S3/GCS SDK, no
Supabase Storage client in either `backend/package.json` or `server/package.json`. So "server-side persisted
folder" cannot be built by extending an existing pattern; it's new infrastructure either way. Given that,
the real decision isn't "zip vs. folder," it's **which kind of new infrastructure**: a real OS-level
directory (Railway volume) or object storage bucket, versus a database-backed store that behaves like a
folder from the app's perspective.

**Recommended design: a new Postgres table, not a real filesystem path.**

```sql
CREATE TABLE project_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_id             TEXT NOT NULL,        -- e.g. "01_project_charter"
  category           TEXT NOT NULL,        -- e.g. "Discovery_Initiation" — matches AppDocs folder name
  title              TEXT NOT NULL,
  format             TEXT NOT NULL,        -- 'docx' | 'md'
  content            BYTEA NOT NULL,       -- the actual generated Word/Markdown file bytes
  source_agent_ids   TEXT[] NOT NULL,      -- which agent outputs this generation was grounded in
  source_output_hash TEXT NOT NULL,        -- hash of concatenated source outputs, used to detect staleness
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  generation_trigger TEXT NOT NULL,        -- 'agent_complete' | 'gate_sync' | 'manual'
  version            INTEGER NOT NULL DEFAULT 1,
  UNIQUE (project_id, doc_id)
);
```

Why this and not a real filesystem folder:

1. **It follows a pattern already proven in this exact codebase.** `agent_runs` and `projects.data` (the
   JSONB column added in `migrations/005_secure_invite_links.sql:22-26`) already persist agent output
   server-side in Postgres, not on disk. This is the established idiom here, not an arbitrary new choice.
2. **The `docx` npm package already used client-side (`documentExporter.ts:6`, `Packer.toBlob` at line 537)
   also supports `Packer.toBuffer()`, which works in Node.** That means generation can keep happening
   client-side exactly as it does today (reusing `l3Runtime.ts`, `get_agent_output`, the existing docx
   builder), and the client just POSTs the resulting bytes to a new endpoint for persistence — the same
   "client computes, backend persists" shape already used for `updateProject`/`PATCH /api/projects/:id`. No
   new document-generation logic has to be written or ported to the backend.
3. **It sidesteps a real durability question I can't resolve from the codebase alone**: whether a Railway
   volume attached to `backend/` or `server/` survives redeploys in this project's actual Railway
   configuration is not something I can verify by reading source files, and getting it wrong means silently
   losing generated documents on a deploy. A Postgres table has no such ambiguity — it's exactly as durable
   as `projects` already is.
4. **"Folder" is realized as `category` + `doc_id` grouping, not a literal OS path**, exposed in the UI
   grouped by category (mirrors the `AppDocs/` folder taxonomy exactly), with a "Download as ZIP" action
   that pulls all rows for a project and rebuilds real subfolders using JSZip (extending
   `exportAllArtifactsZip`, which already supports folder-path keys, just isn't given any yet). So both your
   requirements land on the same store: persisted server-side (satisfies "server-side persisted folder")
   and downloadable as an actual folder structure on the user's machine when they want it.

**Confirmed — this is settled, not an assumption anymore.** You clarified: "server-side persisted folder
means create documents per agent per phase and make it available to be downloaded for that agent/phase.
include documentation as part of the zip folder download." This is exactly the DB-backed design above, with
two scope details now locked in that weren't fully spelled out before:

- **Download granularity is per agent/phase, not just whole-project.** The existing per-agent `ExportMenu.tsx`
  (Section 3, already implemented) needs a new button: alongside the current Markdown/Word/PDF options for
  that agent's own output, add "Download Documentation (.docx)" that pulls the `project_documents` row(s)
  where `source_agent_ids` includes this agent, scoped further by phase if more than one document maps to
  the same agent. No new UI surface needed — this extends the export menu that already exists per agent.
- **The project-level "Export All" ZIP includes generated documentation alongside agent artifacts.**
  `exportAllArtifactsZip` (Section 3, already implemented, currently flat-file) gets extended two ways in
  the same pass: add real subfolders (already planned), and add a second source of files — pull every row
  from `project_documents` for the project into the same zip, under its `category` folder, next to the raw
  agent-output artifacts already being zipped.

No open assumption remains on storage. Locked design: `project_documents` Postgres table (Section 4.2
schema above), downloadable per-agent (extended `ExportMenu.tsx`) and per-project-as-ZIP-with-subfolders
(extended `exportAllArtifactsZip`), never a literal OS-level directory.

### 4.3 Update behavior ("update these md files with project context")

Two sub-cases, both already implied by the AppDocs prompts' own "Merge Instructions" sections:

- **First generation**: no project-specific copy exists yet → generate fresh from the template + agent
  context.
- **Re-generation**: a project-specific copy already exists (e.g. because an upstream agent was re-run
  after feedback) → feed the existing document back in as prior content, same "preserve valid content,
  improve weak sections" instruction already written into every prompt file. This is exactly the pattern
  I used manually this session to update the platform's own Architecture document, so it's a proven
  approach, just needs to be automated. Whether a re-generation is actually *needed* is decided by
  comparing `source_output_hash` (Section 4.2) against a fresh hash of the current source agent outputs —
  if unchanged, skip the LLM call entirely rather than re-generating identical content on every trigger.

### 4.4 Trigger model — locked to parallel, per-agent-completion and gate-sync, no separate phase

You gave three directives that together fully specify this, replacing the "hybrid" option I'd proposed:

> "Fire documentation agent, after each agent is executed and artifact is created, make sure you are using
> the data captured from the agent."
> "Documentation agent should work in sync with the agent-runs for the project and at the review gate
> review and update the documents if necessary to keep the information current and relevant."
> "This documentation agent runs in parallel. no separate phase for the same."

One distinction worth being explicit about, since it's easy to conflate: "no separate phase" refers to
**runtime behavior** — there is no user-facing "Phase 9: Documentation" step or gate in the pipeline, ever.
It does not mean the *engineering rollout* in Section 7 can't be sequenced; building this in stages is still
the safer path. I'm proceeding on that reading.

Concrete design — two hooks into existing code, both fire-and-forget so a documentation failure can never
break the actual pipeline:

**Hook 1 — per-agent-completion**, in `frontend/src/services/pipelineEngine.ts`, right after the existing
`this.callbacks.onAgentComplete(agentId, output)` call (line ~281): call
`documentAgentService.onAgentComplete(projectId, agentId, output)`. This looks up every `DocumentSpec` whose
`sourceAgents` includes the agent that just finished, checks whether *all* of that spec's required agents
are now complete, and if so enqueues generation. Wrapped in try/catch; a document-generation failure is
logged, never thrown into the pipeline.

**Hook 2 — review-gate sync**, in `frontend/src/components/pipeline/ProjectWorkspace.tsx`, inside the
`onApprove` callback (line ~1411-1432), after the existing `updateProject(...)` call: call
`documentAgentService.onGateApproved(projectId, gateId)`. This re-checks every `DocumentSpec` whose
`sourceAgents` fall within phases up to and including the approved gate, compares `source_output_hash`
against current agent outputs, and regenerates anything stale. This is what keeps documents "current and
relevant" at each review checkpoint, per your instruction.

**Concurrency**: both hooks feed into the same 5-concurrent/1.5s-stagger limiter already governing agent
execution (confirmed in the Architecture Document, Section 2.2), so document generation competes fairly for
LLM capacity rather than adding an unbounded parallel load on top of the existing pipeline.

**Data-gap documents** (Section 6, rows marked Data-gap): your rollout answer for Phase 4 — "decision made
to go ahead with trigger mode working in parallel" — means these are *not* skipped. They run through the
same hooks and produce a best-effort draft, explicitly gap-flagged in the document body (same convention
used manually in AgenticSDLC_Docs #53, #70, #72), rather than being silently omitted from the per-project
pack.

---

## 5. Decisions locked (previously "open questions")

All five of the original open questions are now resolved:

1. **Storage model** — locked to the `project_documents` Postgres table design in Section 4.2 (not a
   literal filesystem folder), with one flagged assumption about what "server-side persisted" means — see
   the callout at the end of 4.2.
2. **Trigger model** — locked to the two-hook, parallel, no-separate-phase design in Section 4.4.
3. **Output format** — confirmed by your Phase 2 rollout answer ("actual word document per project"): each
   prompt file's own stated format, `.docx` for ~71 documents, `.md` for the one Architecture Document
   prompt that explicitly targets Markdown. Same convention already used for the AgenticSDLC_Docs pack.
4. **Data-gap documents** — confirmed via your Phase 4 rollout answer: generated anyway, gap-flagged in the
   body, not skipped. See Section 4.4.
5. **`services/traceability.ts`** — inspected. It already implements requirement-to-test traceability
   (parses `US-xxx`, `TC-xxx`, `FR-xxx` via regex and produces a CSV). Document #16 (Requirements
   Traceability Matrix) is a near-free wrapper around `generateTraceabilityMatrix(projectId)`, not new
   synthesis — updated to "Direct (non-agent)" in Section 6.2.

---

## 6. Full document-to-agent mapping (all 72)

Legend: **Direct** = existing agent output is the primary source, light reformatting only. **Synthesis** =
no single existing agent covers it; combine multiple agents' outputs into new content. **Data-gap** = the
platform doesn't currently capture the data this document needs.

### 6.1 Discovery & Initiation

| # | Document | Type | Source agent(s) |
|---|---|---|---|
| 1 | Project Charter | Direct | `projectCharter` |
| 2 | Business Case | Synthesis | `feasibility`, `sdlcOrchestrator` |
| 3 | Vision Document | Synthesis | `manager` (PRD), `roadmapPlanner`, `sdlcOrchestrator` |
| 4 | Stakeholder Register | Direct | `stakeholder` |
| 5 | Scope Statement | Synthesis | `projectCharter`, `brd` |
| 6 | Assumptions and Constraints Document | Synthesis | `feasibility`, `projectCharter`, `sdlcOrchestrator` |
| 7 | Risk Register | Synthesis | `sdlcOrchestrator`, `feasibility`, `techDebt` |
| 8 | Decision Log | Synthesis | `architecture` (ADRs), `sdlcOrchestrator` |

### 6.2 Requirements

| # | Document | Type | Source agent(s) |
|---|---|---|---|
| 9 | Business Requirements Document | Direct | `brd` |
| 10 | Product Requirements Document | Direct | `manager` |
| 11 | Functional Requirements Document | Synthesis | `userStory`, `businessRules` |
| 12 | Software Requirements Specification | Synthesis | `brd`, `manager`, `businessRules`, `architecture` |
| 13 | Non Functional Requirements Document | Synthesis | `architecture`, `securityCompliance` |
| 14 | User Stories / Use Case Document | Direct | `userStory` |
| 15 | Acceptance Criteria Document | Synthesis | `userStory`, `testCases` |
| 16 | Requirements Traceability Matrix | Direct (non-agent) | `generateTraceabilityMatrix(projectId)` in `services/traceability.ts` — confirmed implemented, near-free wrapper |
| 17 | Domain Context Document | Direct (non-agent) | `get_domain_context()` |

### 6.3 Architecture & Design

| # | Document | Type | Source agent(s) |
|---|---|---|---|
| 18 | Architecture Document (`.md` per its own prompt) | Direct | `architecture` |
| 19 | Solution Design Document | Synthesis | `architecture`, `apiDesign`, `dataModel` |
| 20 | High Level Design | Synthesis | `architecture` |
| 21 | Low Level Design | Synthesis | `codeStructure`, `codeSnippets`, `apiDesign` |
| 22 | Data Architecture Document | Synthesis | `dataModel`, `architecture` |
| 23 | Data Model / ERD Document | Direct | `dataModel` |
| 24 | API Design Document | Direct | `apiDesign` |
| 25 | Integration Design Document | Synthesis | `apiDesign`, `architecture`, `devopsEngineer` |
| 26 | Security Architecture Document | Direct | `securityCompliance` |
| 27 | Infrastructure Architecture Document | Direct | `infraEngineer` |
| 28 | Deployment Architecture Document | Synthesis | `devopsEngineer`, `infraEngineer` |
| 29 | Agentic Workflow Architecture Document | Synthesis | `sdlcOrchestrator`, pipeline/agent registry itself |
| 30 | AI Governance / AI Risk Design Document | Synthesis | `securityCompliance`, `sdlcOrchestrator` |

### 6.4 UX/UI

| # | Document | Type | Source agent(s) |
|---|---|---|---|
| 31 | UX Research Document | Direct | `uxResearch` |
| 32 | User Journey Map | Synthesis | `uxResearch`, `interaction` |
| 33 | Wireframes / Mockups Document | Direct | `uxMockups` |
| 34 | Design System Document | Synthesis | `uiComponentLibrary`, `uxMockups` |
| 35 | Accessibility Design Document | Synthesis | `uxMockups`, `workingPrototype`, `interaction` |

### 6.5 Development

| # | Document | Type | Source agent(s) |
|---|---|---|---|
| 36 | Development Plan | Synthesis | `sprintPlanner`, `taskBreakdown`, `roadmapPlanner` |
| 37 | Coding Standards Document | Direct | `codeReviewStandards` |
| 38 | Branching Strategy Document | Synthesis | `devopsEngineer`, `codeReviewStandards` |
| 39 | Code Review Checklist | Direct | `codeReviewStandards` |
| 40 | Configuration Management Document | Synthesis | `infraEngineer`, `devopsEngineer` |
| 41 | Environment Strategy Document | Synthesis | `infraEngineer`, `devopsEngineer` |

### 6.6 Testing & Quality

| # | Document | Type | Source agent(s) |
|---|---|---|---|
| 42 | Test Strategy | Synthesis | `testPlan` |
| 43 | Test Plan | Direct | `testPlan` |
| 44 | Test Case Document | Direct | `testCases` |
| 45 | Automation Test Plan | Synthesis | `testPlan`, `testCases`, `codeStructure` |
| 46 | E2E Test Plan | Synthesis | `testPlan`, `testCases`, `workingPrototype` |
| 47 | Performance Test Plan | Synthesis | `testPlan`, `infraEngineer` |
| 48 | Security Test Plan | Synthesis | `securityCompliance`, `testPlan` |
| 49 | Accessibility Test Plan | Synthesis | `uxMockups`/`interaction`, `testPlan` |
| 50 | UAT Plan | Synthesis | `testPlan`, `userStory` |
| 51 | UAT Sign Off Document | Synthesis (lightweight) | `testPlan`, `userStory` |
| 52 | Defect Management Plan | Synthesis | `testPlan`, `testCases` |
| 53 | Test Summary Report | **Data-gap** | needs actual test-execution results; not produced anywhere today |

### 6.7 DevOps & Release

| # | Document | Type | Source agent(s) |
|---|---|---|---|
| 54 | CI/CD Design Document | Direct/reframe | `devopsEngineer` |
| 55 | DevOps Runbook | Synthesis | `devopsEngineer`, `onCallEngineer` |
| 56 | Release Plan | Synthesis | `roadmapPlanner`, `devopsEngineer` |
| 57 | Deployment Plan | Synthesis | `devopsEngineer`, `infraEngineer` |
| 58 | Rollback Plan | Synthesis | `devopsEngineer`, `onCallEngineer` |
| 59 | Cutover Plan | Synthesis | `devopsEngineer`, `roadmapPlanner` |
| 60 | Production Readiness Checklist | Synthesis (broad) | `devopsEngineer`, `infraEngineer`, `securityCompliance`, `observabilityEngineer` |
| 61 | Go Live Checklist | Synthesis | `devopsEngineer`, `onCallEngineer` |
| 62 | Change Management Document | Synthesis | `sdlcOrchestrator`, `devopsEngineer` |

### 6.8 Operations & Support

| # | Document | Type | Source agent(s) |
|---|---|---|---|
| 63 | Operations Runbook | Synthesis | `onCallEngineer`, `observabilityEngineer` |
| 64 | Monitoring and Observability Document | Direct | `observabilityEngineer` |
| 65 | Incident Management Plan | Synthesis | `onCallEngineer`, `observabilityEngineer` |
| 66 | Support Handover Document | Synthesis | `onCallEngineer`, `codeStructure` |
| 67 | SLA / SLO Document | Synthesis | `observabilityEngineer`, `architecture` (NFR table) |
| 68 | Knowledge Transfer Document | Synthesis | `codeStructure`, `architecture`, `onCallEngineer` |
| 69 | Maintenance Plan | Synthesis | `techDebt`, `infraEngineer` |

### 6.9 Closure

| # | Document | Type | Source agent(s) |
|---|---|---|---|
| 70 | Lessons Learned Document | **Data-gap** | needs real retrospective input from the delivery team |
| 71 | Project Closure Report | **Data-gap (partial)** | `sdlcOrchestrator`, `roadmapPlanner` for planned scope; actual completion data not captured |
| 72 | Post Implementation Review | **Data-gap** | needs real production data (incidents, usage) the platform doesn't collect (see Architecture Document Section 15, Observability gap) |

---

## 7. Phased rollout — your decisions applied

Your answers: "1. ok 2. actual word document per project 3. ok 4. decision made to go ahead with trigger
mode working in parallel 5. Ok." Applied:

1. **Phase 1 — plumbing (confirmed as-is)**: `DocumentSpec` registry, the `project_documents` table
   (Section 4.2), the Context Absorption step (Section 2.1), and both trigger hooks (Section 4.4), wired to
   the 16 Direct-mapping documents only. Note this phase now includes the storage table and both hooks from
   day one, not deferred to Phase 2 — the "no separate phase, runs in parallel" requirement means the
   trigger model has to exist from the first shipped slice, not be bolted on later. See Section 9 for the
   concrete file list.
2. **Phase 2 — changed from ZIP export to real persisted Word documents per project**: this is now largely
   already covered by Phase 1's `project_documents` table (Section 4.2), since each row already stores real
   `.docx` bytes. What Phase 2 actually adds on top: the Admin Panel "Documentation" block (Section 3.2) to
   view/download/regenerate them, and the ZIP-with-subfolders export as a convenience action on top of the
   already-persisted rows.
3. **Phase 3 — synthesis documents (confirmed as-is)**: add the ~56 Synthesis-type `DocumentSpec` entries,
   category by category.
4. **Phase 4 — data-gap documents (confirmed, trigger mode applies)**: these run through the same parallel
   hooks as everything else, gap-flagged in the body rather than skipped (Section 4.4).
5. **Phase 5 — re-generation/merge behavior (confirmed as-is)**: the `source_output_hash` staleness check
   (Section 4.2/4.3) plus the "existing content as prior version" merge instruction already written into
   every AppDocs prompt file.

Each phase is still independently shippable; Phase 1 is now somewhat larger than originally scoped because
the trigger/storage requirements pulled forward into it, but it remains the smallest slice that proves the
whole design end to end.

---

## 8. Confidence level

Overall confidence: **0.92**, up from the original draft's 0.8, now that the open questions are resolved
and I've verified the storage design against actual backend code rather than assuming.

High confidence (0.9+) on: the existing-infrastructure inventory (Section 3), the 16 direct-mapping
documents (verified against actual agent IDs in `definitions.ts`), the two trigger hook locations (verified
exact line numbers in `pipelineEngine.ts` and `ProjectWorkspace.tsx`), the Admin Panel fit (verified actual
`ProjectsTab` structure and the existing toggle pattern in `ProjectSettings.tsx`), and the `docx` package's
Node-compatibility claim (`Packer.toBuffer` is documented, isomorphic behavior of the library, not an
assumption).

Medium confidence (0.7-0.8) on: the Synthesis mapping choices in Section 6 (best-fit recommendation, not
team-confirmed), and the tech-stack field gap noted in Section 2.1.

Explicitly flagged, not guessed: the one open assumption in Section 4.2 about what "server-side persisted"
means (in-app durable store vs. literal externally-readable filesystem path) — this is the single item most
likely to send the storage design back to the drawing board if I've read it wrong, so it's worth a fast
confirm before Phase 1 starts rather than after the table's built.

**I still have not written any implementation code for this feature.** Section 9 is the concrete file-by-file
plan for Phase 1; nothing in the codebase has been touched.

---

## 9. Phase 1 implementation plan (file by file)

New files:

- `backend/migrations/00X_project_documents.sql` — the `project_documents` table from Section 4.2.
- `backend/src/routes/documents.js` (or added to `proxy.js`) — `GET /api/projects/:id/documents`,
  `POST /api/projects/:id/documents` (upsert by `project_id, doc_id`), `GET
  /api/projects/:id/documents/:docId/download`.
- `frontend/src/agents/documentSpecs.ts` — the `DocumentSpec[]` registry, 16 entries for Phase 1 (Section
  3.1's table).
- `frontend/src/services/documentAgentService.ts` — Context Absorption step (2.1), `onAgentComplete`,
  `onGateApproved`, hash-based staleness check, calls into `l3Runtime.ts` for generation, POSTs results to
  the new backend route.
- `frontend/src/components/admin/DocumentAgentPanel.tsx` (or inline block in `AdminPanel.tsx`'s
  `ProjectsTab`) — the Section 3.2 UI.

Modified files:

- `frontend/src/types/project.types.ts` — add `documentAgentEnabled?: boolean`.
- `frontend/src/services/pipelineEngine.ts` — Hook 1, one line after the existing `onAgentComplete` call
  (~line 281).
- `frontend/src/components/pipeline/ProjectWorkspace.tsx` — Hook 2, inside the existing `onApprove` handler
  (~lines 1411-1432).
- `frontend/src/components/admin/AdminPanel.tsx` — new `actionGroup` block in `ProjectsTab`'s detail pane.
- `frontend/src/services/exporters/documentExporter.ts` — extend `exportAllArtifactsZip` to accept a
  category/subfolder path per entry (JSZip already supports folder-path keys), and to pull a second source
  of files from `project_documents` (the generated docs) into the same zip, not just live agent outputs.
- `frontend/src/components/documents/ExportMenu.tsx` — add a "Download Documentation (.docx)" option per
  agent, scoped to whichever `project_documents` rows list this agent in `source_agent_ids`.
- `backend/package.json` — add `docx` as a dependency if generation ever moves server-side; not needed if
  Phase 1 keeps generation client-side and only persists via POST, which is the recommended path.

Test/verification per this project's own standing bar (>95% coverage, tests run before any response claiming
completion): new Jest tests for the migration and the three new routes in `backend/`, new Vitest tests for
`documentAgentService.ts` (mock `l3Runtime`, verify hash-based skip logic, verify both hooks fire under the
right conditions and are no-ops when `documentAgentEnabled` is false), and a Playwright/E2E check (if this
repo's test suite has one) that the Admin Panel toggle actually suppresses generation.

**Not started.** This is the concrete scope for the next go-ahead, not a claim that any of it exists yet.
