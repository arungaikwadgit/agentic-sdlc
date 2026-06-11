# Module 1 Test Plan: Pipeline & Persistence

Companion to `docs/architecture/pipeline-persistence.md`. Covers
`projectRepository.ts`, `crypto.ts`, and `pipelineEngine.ts`.

---

## 1. Scope and approach

| File | Test file | Approach | Rationale |
|---|---|---|---|
| `db/projectRepository.ts` | `tests/unit/projectRepository.test.ts` | Mock `db` (Dexie) module — `db.projects` backed by an in-memory `Map`, `db.transaction` calls the callback directly. | No `fake-indexeddb` dependency available. Mocking lets us test repository *logic* (versioning, mapping, validation, error paths) deterministically. Decided 2026-06-11: mock-based for Module 1; `fake-indexeddb` + real-Dexie migration tests deferred as a fast-follow. |
| `utils/crypto.ts` | `tests/unit/crypto.test.ts` | Real Web Crypto API (Node 20+/jsdom both expose `crypto.subtle`). No mocking. | Crypto primitives should be tested against the real implementation — mocking them would test nothing. |
| `services/pipelineEngine.ts` | `tests/unit/pipelineEngine-orchestration.test.ts` | Mock `db/projectRepository` (getProject/updateProject/updateAgentRun) and `services/api` (callAgent/extractText). | Isolates orchestration logic (phase order, gates, abort, error handling) from persistence and network. Filename avoids collision with the existing `pipelineEngine.test.ts`, which tests `services/api.ts`. |

**Out of scope for Module 1** (documented as known gaps):
- `db/database.ts` schema migration tests (v1→v4) — needs `fake-indexeddb`.
- `hooks/useIntegrations.ts` — React hook, would need `@testing-library/react-hooks`-style rendering; deferred to a UI-focused module or Module 1 fast-follow if prioritized.

---

## 2. Test scenarios

### 2.1 `projectRepository.ts`

| # | Scenario | Type |
|---|---|---|
| TS-1 | Create a project with valid data | Happy path |
| TS-2 | Created project has correct defaults (`version: 1`, empty `agentRuns`/`reviewGates`/etc.) | Happy path |
| TS-3 | Get an existing project by id | Happy path |
| TS-4 | Get a non-existent project returns `undefined` | Edge case |
| TS-5 | List projects returns summaries ordered by `updatedAt` descending | Happy path |
| TS-6 | `listProjects` correctly computes `completedAgents` from `agentRuns` | Happy path |
| TS-7 | `listProjects` includes archive fields when present | Happy path |
| TS-8 | Update a project increments `version` and updates `updatedAt` | Happy path |
| TS-9 | Update a non-existent project throws | Error handling |
| TS-10 | `updateAgentRun` merges into existing run, preserving other fields | Happy path |
| TS-11 | `updateAgentRun` defaults to `{ agentId, status: 'idle' }` when no prior run exists | Edge case |
| TS-12 | Delete a project removes it permanently | Happy path |
| TS-13 | `restoreProject` clears all four archive fields | Happy path |
| TS-14 | `exportAllProjects` produces valid JSON with `version`, `exportedAt`, `projects` | Happy path |
| TS-15 | `importProjects` with valid backup bulk-inserts and returns count | Happy path |
| TS-16 | `importProjects` with malformed JSON (`projects` not an array) throws `'Invalid backup format'` | Error handling |

### 2.2 `crypto.ts`

| # | Scenario | Type |
|---|---|---|
| TS-17 | Encrypt then decrypt returns original plaintext | Happy path (round trip) |
| TS-18 | Encrypted payload contains `ciphertext`, `iv`, `salt` as non-empty base64 strings | Happy path |
| TS-19 | Two encryptions of the same plaintext with the same password produce different ciphertext (random salt/IV) | Security property |
| TS-20 | Decrypting with the wrong password throws | Error handling |
| TS-21 | Decrypting with a tampered ciphertext throws (GCM auth tag failure) | Error handling |
| TS-22 | Round trip works for empty string and for unicode/multi-byte content | Edge case |

### 2.3 `pipelineEngine.ts`

| # | Scenario | Type |
|---|---|---|
| TS-23 | `run()` on a project with no review gates approved stops at `gate1` (after phase1b) and sets `status: 'paused'`, `currentPhase: 'phase2'` | Happy path / gate behavior |
| TS-24 | `run()` with all gates pre-approved runs through to `status: 'complete'` and calls `onPipelineComplete` | Happy path |
| TS-25 | `run()` skips agents whose `agentRuns[id].status === 'complete'` (resume support) | Resume |
| TS-26 | `run(startFromPhase)` begins at the given phase, not phase1 | Resume |
| TS-27 | A required gate that *is* approved does not block phase entry | Gate behavior |
| TS-28 | An agent error: run status set to `error` with message, `onAgentError` called, error re-thrown and caught by `run()`'s try/catch → project `status: 'error'`, `onPipelineError` called | Error handling |
| TS-29 | `abort()` stops a sequential phase from starting further agents | Abort |
| TS-30 | `getProject` returning `undefined` (project not found) calls `onPipelineError('Project not found')` and returns without throwing | Error handling |
| TS-31 | Parallel phase (e.g. phase2) runs all its agents via the queue and waits for `onIdle()` before proceeding | Concurrency |

---

## 3. Test cases (selected — full detail in test files)

Below are illustrative test cases; the actual `*.test.ts` files contain the
complete implementation.

### TC-1 (covers TS-8, TS-9) — `updateProject`

```
Given a project exists with version: 1, updatedAt: T0
When updateProject(id, p => { p.status = 'running' }) is called
Then the returned project has version: 2, status: 'running', updatedAt > T0

Given no project exists with id "missing"
When updateProject("missing", p => p) is called
Then it rejects with Error("Project not found: missing")
```

### TC-2 (covers TS-16) — `importProjects` validation

```
Given json = '{"foo": "bar"}'
When importProjects(json) is called
Then it rejects with Error("Invalid backup format")
```

### TC-3 (covers TS-17, TS-19, TS-20) — crypto round trip & failure modes

```
Given plaintext = "super-secret-token", password = "correct-horse"
When encrypted = encrypt(plaintext, password)
And decrypted = decrypt(encrypted, password)
Then decrypted === plaintext

Given the same plaintext and password
When encrypted twice
Then encrypted1.ciphertext !== encrypted2.ciphertext (different salt/IV)

Given encrypted with password "correct-horse"
When decrypt(encrypted, "wrong-password") is called
Then it rejects (OperationError from Web Crypto)
```

### TC-4 (covers TS-23) — gate1 pause behavior

```
Given a project in domain X with status 'draft', no reviewGates approved,
  and AGENT_DEFINITIONS / api.callAgent mocked to resolve immediately
When engine.run() is called (starting at phase1)
Then:
  - phase1 (manager) and phase1b (projectCharter, brd) agents run and complete
  - onPhaseComplete fires for phase1 and phase1b
  - gate1 is detected as required before phase2 is NOT the trigger here —
    instead gate1 fires AFTER phase1b (GATE_BEFORE_PHASE['phase1b'] = 'gate1')
  - onGateReached('gate1') fires
  - updateProject sets status: 'paused', currentPhase: 'phase2'
  - run() returns without processing phase2+
```

### TC-5 (covers TS-25) — resume skips completed agents

```
Given a project where agentRuns.manager = { status: 'complete', output: '...' }
  and gate1 is approved
When engine.run() is called
Then runAgent('manager') returns immediately without calling api.callAgent
  or emitting onAgentStart/onAgentComplete for 'manager'
```

### TC-6 (covers TS-28) — agent error propagation

```
Given api.callAgent is mocked to reject with Error("rate limited")
When engine.run() reaches an agent in a sequential phase
Then:
  - updateAgentRun is called with { status: 'error', error: 'rate limited', completedAt: <ts> }
  - onAgentError('manager', 'rate limited') fires
  - the error propagates out of runPhase/run's try block
  - updateProject sets status: 'error'
  - onPipelineError('rate limited') fires
```

---

## 4. E2E considerations

The existing `tests/e2e/create-and-run.spec.ts` and
`tests/e2e/accessibility.spec.ts` already exercise project creation and
pipeline-running through the UI (Playwright, serial execution to avoid
IndexedDB conflicts). Module 1's persistence/orchestration logic is
exercised indirectly by these.

**No new E2E tests are added for Module 1** — the unit tests above give
faster, more isolated feedback for this layer. If gate-pause/resume UI
behavior regresses, that would surface in `create-and-run.spec.ts` (which
should be checked when reviewing pipeline engine changes).

---

## 5. Coverage expectations

`frontend/vite.config.ts` thresholds (unchanged): `lines: 80, functions: 80,
branches: 75, statements: 80`, v8 provider, scope `src/**/*.{ts,tsx}`.

The sandbox used to write these tests has an incomplete `vitest` install
(binary missing from `node_modules/.bin`), so **coverage could not be run
here**. To get the actual project-wide and per-file numbers:

```bash
cd frontend
npm install   # repairs node_modules if vitest binary is missing
npm run test:coverage
```

Expected outcome of adding this module's three test files: `db/database.ts`
remains at 0% (migrations untested, as documented above);
`db/projectRepository.ts`, `utils/crypto.ts`, and
`services/pipelineEngine.ts` should each move from 0% to a high percentage
(repository and crypto are fully covered by the scenarios above; the engine
covers the main run/gate/abort/error paths but not every phase's specific
agent list).
