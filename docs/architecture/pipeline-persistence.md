# Module 1: Pipeline & Persistence Layer

> Part of the Agentic SDLC documentation set. This module covers the core data
> persistence layer (Dexie/IndexedDB), the pipeline orchestration engine, and
> encrypted credential storage for third-party integrations.

**Source files covered:**

- `frontend/src/db/database.ts`
- `frontend/src/db/projectRepository.ts`
- `frontend/src/services/pipelineEngine.ts`
- `frontend/src/hooks/useIntegrations.ts`
- `frontend/src/utils/crypto.ts`

---

## 1. Requirements

### 1.1 Purpose

The pipeline/persistence layer is the foundation the rest of the app builds
on. It is responsible for:

- Storing all project data (agent runs, review gates, team, settings) locally
  in the browser via IndexedDB, with no backend database.
- Running the 30-agent, 11-phase SDLC pipeline in the correct order, with
  parallel execution where the phase allows it.
- Pausing the pipeline at review gates until a human approves.
- Supporting resume after a pause or browser refresh (agent runs marked
  `complete` are skipped on re-run).
- Storing third-party integration credentials (GitHub, Jira, etc.)
  encrypted at rest, since they live in IndexedDB on the user's machine.

### 1.2 Functional requirements

| ID | Requirement |
|----|-------------|
| R1 | All project state must persist across page reloads (IndexedDB, not memory). |
| R2 | The pipeline must execute phases in a fixed order (`PHASE_ORDER`), running agents within a phase either sequentially or in parallel (max concurrency 3) per `PARALLEL_PHASES`. |
| R3 | The pipeline must stop and emit a "gate reached" event when a review gate is not yet approved, persisting `status: 'paused'` and the phase to resume from. |
| R4 | Re-running the pipeline must skip agents whose run status is already `complete`. |
| R5 | Each `updateProject` call must increment `version` and update `updatedAt` (optimistic concurrency stamp). |
| R6 | Integration credentials must never be stored in plaintext in IndexedDB. |
| R7 | The database schema must support non-destructive upgrades (existing projects must not lose data when the schema changes). |

### 1.3 Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR1 | Encryption must use a standard, audited primitive (Web Crypto AES-GCM + PBKDF2), not a custom cipher. |
| NFR2 | Pipeline parallel phases must cap concurrency to avoid hammering the LLM API (`p-queue`, concurrency=3). |
| NFR3 | A failed agent must not silently stop the whole pipeline without recording the error on that agent's run. |

---

## 2. Design

### 2.1 Data model

`frontend/src/types/project.types.ts` defines the core shapes.

**`Project`** (full record, stored in `db.projects`):

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | UUID, primary key |
| `name`, `description` | `string` | |
| `domain` | `DomainId` | e.g. fintech, healthcare — drives agent context |
| `status` | `'draft' \| 'running' \| 'paused' \| 'complete' \| 'error'` | |
| `version` | `number` | incremented on every `updateProject` |
| `createdAt`, `updatedAt` | `number` (epoch ms) | |
| `currentPhase` | `PhaseId?` | phase to resume from |
| `agentRuns` | `Partial<Record<AgentId, AgentRun>>` | per-agent execution state |
| `reviewGates` | `Partial<Record<ReviewGateId, ReviewGate>>` | approval state per gate |
| `promptOverrides` | `PromptOverride[]` | per-project prompt customizations |
| `mode` | `'simple' \| 'expert'` | gates whether JSON-Patch prompt overrides apply |
| `teamMembers`, `agentAssignments` | array | team roster |
| `archived`, `archivedReason`, `archivedAt`, `archivedBy` | optional | soft-delete fields (added in schema v2-equivalent migration, see §2.3) |
| `githubIntegrationId` | `string?` | FK into `db.integrations` |
| `domainKnowledge`, `brandingGuidelines` | `string?` | free-text context prepended to agent prompts |
| `disabledRoleIds` | `string[]?` | role templates hidden from pickers |

**`ProjectSummary`** — lightweight projection used by dashboard/settings
lists (`listProjects()`), derived from `Project` plus a computed
`completedAgents` / `totalAgents` count.

**`AgentRun`** (`types/agent.types.ts`):

```ts
interface AgentRun {
  agentId: AgentId;
  status: 'idle' | 'running' | 'complete' | 'error' | 'skipped';
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  tokensUsed?: number;
}
```

**`IntegrationCredential`** (`types/integration.types.ts`), stored in
`db.integrations`:

```ts
interface IntegrationCredential {
  id: string;
  provider: 'jira' | 'confluence' | 'github' | 'gitlab' | 'slack';
  label: string;
  encryptedData: string; // JSON-stringified { ciphertext, salt } (both base64)
  iv: string;            // base64 IV, stored alongside (not inside encryptedData)
  createdAt: number;
}
```

### 2.2 Component / module map

```
                ┌───────────────────────┐
                │   UI components        │
                │ (Dashboard, Workspace,  │
                │  Settings, etc.)        │
                └───────────┬─────────────┘
                             │ useLiveQuery / hooks
                             ▼
   ┌─────────────────────────────────────────────┐
   │  hooks/useIntegrations.ts                     │
   │  hooks/useProject.ts, hooks/usePipeline.ts    │
   └───────────────┬───────────────┬──────────────┘
                    │               │
                    ▼               ▼
   ┌──────────────────────┐   ┌──────────────────────────┐
   │ db/projectRepository  │   │ utils/crypto.ts            │
   │  (CRUD + version stamp│   │  (AES-GCM encrypt/decrypt) │
   └───────────┬────────────┘   └──────────────────────────┘
               │
               ▼
   ┌──────────────────────┐
   │ db/database.ts         │
   │  Dexie (IndexedDB)      │
   │  tables: projects,      │
   │  integrations, settings │
   └──────────────────────┘

   ┌──────────────────────────────────────────────┐
   │ services/pipelineEngine.ts (PipelineEngine)    │
   │  - reads/writes via projectRepository          │
   │  - calls services/api.ts (LLM calls)           │
   │  - reads agents/constants, agents/definitions  │
   └──────────────────────────────────────────────┘
```

### 2.3 Database schema (`db/database.ts`)

Dexie database `AgenticSDLC`, three tables:

| Table | Indexes | Purpose |
|---|---|---|
| `projects` | `id, domain, status, createdAt, updatedAt` | full `Project` records |
| `integrations` | `id, provider` | encrypted `IntegrationCredential` records |
| `settings` | `key` | app-level key/value settings (e.g. prompt defaults) |

**Migration history** (Dexie versioned schemas — index definitions
unchanged across versions; only `.upgrade()` data-shape migrations):

| Version | Change |
|---|---|
| v1 | Initial schema. |
| v2 | Adds `teamMembers: []` and `agentAssignments: []` to existing projects that lack them. |
| v3 | Adds `isAdmin` to existing team members (first member becomes admin by default); migrates legacy single `memberId` on agent assignments to `memberIds: string[]`. |
| v4 | Adds `domainKnowledge: null` to projects missing the field. |

Each migration uses `tx.table('projects').toCollection().modify(...)`, which
is non-destructive — it only fills in missing fields on existing records.

> **Maintenance note:** any future schema change must add a new
> `this.version(N).stores({...}).upgrade(...)` block rather than editing an
> existing version in place — Dexie applies migrations sequentially based on
> a user's currently-stored version number, so editing history breaks
> upgrades for existing users.

### 2.4 Persistence API (`db/projectRepository.ts`)

| Function | Signature | Behavior |
|---|---|---|
| `createProject` | `(data) => Promise<Project>` | Generates a UUID, sets `version: 1`, initializes `agentRuns/reviewGates/promptOverrides/teamMembers/agentAssignments` to empty, inserts via `db.projects.add`. |
| `getProject` | `(id) => Promise<Project \| undefined>` | Direct `db.projects.get`. |
| `listProjects` | `() => Promise<ProjectSummary[]>` | All projects ordered by `updatedAt` desc, mapped to `ProjectSummary` with `completedAgents` computed by counting `agentRuns` with `status === 'complete'`. `totalAgents` is the constant `TOTAL_AGENTS` (26). |
| `updateProject` | `(id, updater) => Promise<Project>` | Runs in a Dexie `'rw'` transaction. Loads the project, applies `updater` (mutate in place or return a new object), increments `version`, sets `updatedAt = Date.now()`, writes back via `db.projects.put`. Throws if the project doesn't exist. |
| `updateAgentRun` | `(projectId, agentId, run) => Promise<void>` | Convenience wrapper around `updateProject` that merges `run` into `agentRuns[agentId]`, defaulting to `{ agentId, status: 'idle' }` if no prior run exists. |
| `deleteProject` | `(id) => Promise<void>` | Hard delete via `db.projects.delete`. **Irreversible** — used by the "Permanently delete" actions in Dashboard and App Settings → Projects. |
| `restoreProject` | `(id) => Promise<void>` | Clears `archived`, `archivedReason`, `archivedAt`, `archivedBy` via `updateProject`. |
| `exportAllProjects` | `() => Promise<string>` | JSON-stringifies `{ version: 1, exportedAt, projects: [...] }` (pretty-printed). |
| `importProjects` | `(json) => Promise<number>` | Parses JSON, validates `data.projects` is an array, `bulkPut`s all projects, returns count. Throws `'Invalid backup format'` if the shape doesn't match. |

**Key design decision:** `updateProject` is the single write path for all
project mutations. This is what guarantees `version`/`updatedAt` are always
correct, and it's the seam every other module (pipeline engine, UI forms)
goes through.

### 2.5 Encryption (`utils/crypto.ts`)

AES-256-GCM via the Web Crypto API, key derived with PBKDF2 (SHA-256,
100,000 iterations).

```ts
encrypt(plaintext: string, password: string): Promise<{ ciphertext, iv, salt }> // all base64
decrypt(payload: { ciphertext, iv, salt }, password: string): Promise<string>
```

- A fresh random salt (16 bytes) and IV (12 bytes) are generated **per
  encrypt call** — even encrypting the same plaintext twice produces
  different ciphertext.
- `deriveKey` re-derives the AES key from `password` + `salt` each time;
  the key itself is never persisted.

### 2.6 Integration credential storage (`hooks/useIntegrations.ts`)

- The "password" for `crypto.ts` is a **device-scoped passphrase**: a random
  UUID generated once and stored in `localStorage` under
  `sdlc_enc_passphrase`. This is *not* a user-chosen password — it exists so
  ciphertext in IndexedDB isn't trivially readable, but anyone with access to
  the same browser profile (and thus `localStorage`) can decrypt it.
- `saveCredential(provider, label, credentials, id?)`: JSON-stringifies the
  credentials object, encrypts it, and stores
  `{ id, provider, label, encryptedData: JSON.stringify({ciphertext, salt}), iv, createdAt }`
  in `db.integrations`. Note `iv` is stored as a top-level field on the
  record, *outside* `encryptedData` (which holds only `ciphertext` + `salt`).
- `loadCredential<T>(id)`: reverses the above — parses `encryptedData` to get
  `ciphertext`/`salt`, recombines with the record's top-level `iv`, decrypts,
  and `JSON.parse`s the result as `T`.
- `removeCredential(id)`: `db.integrations.delete(id)`.
- `integrations` is a live, reactive array via `useLiveQuery(() =>
  db.integrations.toArray(), [])`.

> **Security note for the docs:** because the passphrase lives in
> `localStorage` on the same device, this scheme protects against casual
> inspection of the IndexedDB store (e.g. via browser devtools "Application"
> tab showing raw values) but **not** against an attacker with full access to
> the browser profile. This should be called out explicitly if/when this app
> is positioned for use with real production credentials.

### 2.7 Pipeline orchestration (`services/pipelineEngine.ts`)

`PipelineEngine` is constructed per-project with a `projectId` and a
`PipelineCallbacks` object (UI hooks for start/complete/error/gate/done
events).

**Phase/gate model**, derived from `agents/constants.ts`:

- `PHASE_ORDER`: `phase0, phase1, phase1b, phase2, phase3, phase3b, phase4, phase5, phase6, phase7, phase8` (11 phases, 30 agents total via `PHASE_AGENTS`).
- `PARALLEL_PHASES`: `phase2, phase3, phase4, phase7, phase8` run their agents concurrently (via a shared `PQueue` with `concurrency: 3`); all other phases run agents sequentially.
- `REVIEW_GATES`: `gate1` (after phase1 + phase1b), `gate2` (after phase2), `gate3` (after phase3 + phase3b), `gate5` (after phase5), `gate6` (exploratory — no phases required, no approval gate).
- Two derived lookup tables are built at module load:
  - `GATE_BEFORE_PHASE`: maps the *last phase before a gate* → gate id (used to detect "did we just finish a phase that a gate sits after").
  - `GATE_AFTER_PHASE_INDEX`: maps gate id → index of the *first phase after* the gate (used to detect "is there an unapproved gate blocking the phase we're about to start").

**`run(startFromPhase?)`** — main loop:

1. Loads the project; errors out via `onPipelineError` if not found.
2. Sets `status: 'running'`.
3. Iterates `PHASE_ORDER` from `startFromPhase` (or index 0):
   - If a gate is required *before* this phase index and it isn't approved: emit `onGateReached`, set `status: 'paused'`, `currentPhase = <this phase>`, and **return** (pipeline stops here).
   - Otherwise set `currentPhase = <this phase>`, run the phase (`runPhase`), emit `onPhaseComplete`.
   - If a gate fires *after* this phase and isn't approved: emit `onGateReached`, set `status: 'paused'`, `currentPhase = <next phase>` (so resume starts at the *next* phase, not re-running this one), and **return**.
4. If the loop completes without abort: set `status: 'complete'`, emit `onPipelineComplete`.
5. Any thrown error: set `status: 'error'`, emit `onPipelineError(message)`.

**`runPhase(phase)`**:
- Looks up `PHASE_AGENTS[phase]`.
- If `PARALLEL_PHASES.has(phase)`: enqueues all agents onto the shared `PQueue` (`Promise.all` + `queue.onIdle()`).
- Else: runs agents one at a time, checking `this.aborted` before each.

**`runAgent(agentId)`**:
1. Looks up `AGENT_DEFINITIONS[agentId]`; throws if missing.
2. Loads the project; throws if it disappeared.
3. **Resume support**: if `agentRuns[agentId].status === 'complete'`, returns immediately (no re-run, no callback).
4. Emits `onAgentStart`, sets run status to `running` with `startedAt`.
5. Builds prompt context (`buildContext`).
6. Resolves the system prompt in two steps — first a base value, then an optional project-level override on top of it:
   - **Base value**: `getPromptDefaults()[agentId]` (App Settings → Agent Prompts) if set, else `AGENT_DEFINITIONS[agentId].systemPrompt` (hardcoded fallback).
   - **Override** (`project.promptOverrides[]` for this agent), highest priority first:
     1. `fullPrompt` set — replaces the base value entirely.
     2. Else if `patch.length > 0` **and** `project.mode === 'expert'` — applies a JSON Patch (RFC 6902, via `fast-json-patch`) **on top of the base value** (so a patch can modify either the app-level default or the hardcoded prompt, whichever applied).
     3. No matching override — base value is used as-is.
7. Calls `api.callAgent({ systemPrompt, userPrompt })`, extracts text and token usage.
8. On success: `updateAgentRun` to `status: 'complete'` with `output`, `tokensUsed`, `completedAt`; emits `onAgentComplete`.
9. On error: `updateAgentRun` to `status: 'error'` with `error` message and `completedAt`; emits `onAgentError`; **re-throws** so the phase runner can decide whether to halt.

**`buildContext(project)`** — builds the `AgentPromptContext` passed to
`def.buildUserPrompt(ctx)`:
- `priorOutputs`: map of `agentId → output` for all agents with `status === 'complete'` and a non-empty `output`.
- `teamRoster`: via `buildTeamRoster(project)` (data/roleTemplates.ts).
- `domainContext`: project's `domainKnowledge` (if set) prepended to the domain's built-in `context` string, separated by `---`.
- Passes through `projectName`, `projectDescription`, `domain.id`, `brandingGuidelines`.

**`abort()`**: sets `aborted = true` and clears the queue. Checked at the top of `runPhase`'s sequential loop and `runAgent`. Note: agents already dispatched into the parallel `PQueue` before `abort()` is called are **not** interrupted mid-flight — only queued-but-not-started work is dropped.

---

## 3. Development notes

- **Single source of truth for writes**: any code that mutates a `Project` should go through `updateProject` (or its `updateAgentRun`/`restoreProject` wrappers) — never `db.projects.put` directly — to keep `version`/`updatedAt` consistent.
- **`pipelineEngine.ts` has a naming collision risk**: the existing test file `tests/unit/pipelineEngine.test.ts` actually tests `services/api.ts` (it imports `api.callAgent`/`api.extractText`), not this file. New tests for `PipelineEngine` itself should use a different filename (e.g. `pipelineEngine-orchestration.test.ts`) to avoid confusion — see `docs/test-plans/pipeline-persistence-test-plan.md`.
- **Dynamic import of `fast-json-patch`**: only loaded when an `expert`-mode project has a JSON-Patch-style `promptOverride` with `patch.length > 0`. Most projects (simple mode, or full-prompt overrides) never trigger this import.
- **Concurrency model**: `PipelineEngine` creates its own `PQueue(concurrency: 3)` per instance. If multiple `PipelineEngine` instances ran concurrently for the same project (not currently expected by the UI, which runs one pipeline per open project), there's no cross-instance coordination — this is a latent assumption worth keeping in mind if multi-tab support is ever added.

---

## 4. Test plan summary

See `docs/test-plans/pipeline-persistence-test-plan.md` for full scenarios
and cases. Summary of what's covered by new tests added alongside this doc:

| Area | Test file | Approach |
|---|---|---|
| `projectRepository.ts` CRUD + versioning | `tests/unit/projectRepository.test.ts` | Mocks `db.projects` as an in-memory Map (no real IndexedDB — see note below). |
| `crypto.ts` encrypt/decrypt | `tests/unit/crypto.test.ts` | Real Web Crypto (available in jsdom/Node), no mocking needed. |
| `pipelineEngine.ts` orchestration | `tests/unit/pipelineEngine-orchestration.test.ts` | Mocks `projectRepository` and `services/api`; tests phase sequencing, gate pause/resume, abort, error propagation. |

**Known gap**: `database.ts` schema migrations (v1→v4) are **not** covered by
the mock-based approach above, since mocking `db.projects` bypasses Dexie
entirely. Real migration testing requires `fake-indexeddb` (not currently a
project dependency). Recommended as a fast-follow — see Maintenance section.

---

## 5. Deployment & maintenance notes

- **No backend involvement**: this entire module runs client-side. Deploying
  a new version of the frontend does not require any database migration step
  on a server — each user's browser runs the Dexie `.upgrade()` chain the
  next time they load the app with a newer schema version.
- **Coverage thresholds**: `frontend/vite.config.ts` enforces `lines: 80,
  functions: 80, branches: 75, statements: 80` project-wide (v8 provider).
  These thresholds are intentionally **not modified** by this module's tests
  — new tests should move the project's actual coverage toward (not redefine)
  these targets.
- **Recommended fast-follow**: add `fake-indexeddb` as a devDependency and add
  `tests/unit/database.test.ts` to cover the v1→v4 migration chain against a
  real (in-memory) IndexedDB implementation. This was scoped out of Module 1
  per explicit decision (mock-based approach chosen to avoid introducing an
  unverified dependency in this pass).
- **Backup/restore**: `exportAllProjects`/`importProjects` are the only
  backup mechanism — there's no automatic backup. If `importProjects` is
  called with a backup from a newer schema version than the running app, the
  Dexie `.upgrade()` chain runs against the imported records the next time
  the relevant table is read, same as for any other record.
