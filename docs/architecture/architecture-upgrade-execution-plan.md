# Architecture Upgrade — Step-by-Step Execution Plan

Last updated: 2026-07-19
Companion to: `code-quality-and-solid-review-2026-07-19.md` (the ADR this plan executes).
Status: **plan only — no extraction has started.** Every step below is written so it can be picked up and run later, by me or by anyone else, without re-deriving the reasoning.

This plan exists because "upgrade the architecture without impacting existing behavior" is really two separate promises that both have to hold at every single step, not just at the end:

1. **Behavior promise** — every request, every UI interaction, every test that passes today must still pass identically after each step. Not "after the whole migration" — after *each individual step*.
2. **Safety promise** — because this sandbox cannot run a full `npx tsc` pass or `vitest` locally, and because a second session is concurrently committing to this exact repo, every step has to be small enough to verify by other means, and isolated enough that it can't silently absorb someone else's unrelated work into the same commit (this happened twice today — see Section 0.4).

---

## 0. Ground Rules (apply to every step, every phase)

### 0.1 The extraction discipline: move, never rewrite

For every function, route handler, or block of JSX being relocated:

- **Copy the code verbatim first.** Paste it into the new file unchanged — same variable names, same comments, same formatting. Do not "clean it up while I'm in there." Cleanup is a separate, later, explicitly-labeled commit if wanted at all.
- **Only after the verbatim copy compiles and the old call site is deleted**, consider it done. If it doesn't compile verbatim in the new location, the problem is almost always a missing import or a dependency that needs to be passed in as a parameter — fix the wiring, not the logic.
- **Preserve exact middleware/decorator order.** For Express routes specifically: if the original was `app.post('/x', checkToken, authorizeAgentRun, handler)`, the extracted version must apply `checkToken` and `authorizeAgentRun` in the same order, not "equivalent" auth via a different mechanism. Auth-order bugs are invisible until exploited.
- **Preserve exact response shapes and status codes**, including error paths. If a route returns `res.status(400).json({error: '...'})` on a specific validation failure today, the extracted version returns exactly that, not a "better" error format.

### 0.2 The verification ladder (use the cheapest check that would actually catch a mistake, then go up)

Since a full project-wide `npx tsc --noEmit` cannot complete in this sandbox (confirmed multiple times this session — it exceeds the 45s tool ceiling even scoped to 11 files), verification for each step happens in layers:

1. **Syntax check** — `node -c <file>` for `.js` files (instant, catches parse errors). For `.ts`/`.tsx`, a `ts.createSourceFile()` parser-only check (catches syntax, not types — already the fallback method used earlier this session).
2. **Import audit** — grep the whole repo for every symbol being moved (`grep -rn "functionName" frontend/src backend/src`) to confirm no other file imports it from its old location. This is the single most common way an "invisible" extraction breaks something — a helper that looked private but had one other caller somewhere.
3. **Existing test trace** — read the existing test file for the code being touched line by line against the new structure, the same hand-verification method used for `requiresDiagram`/`iterationTokens` this session. Not a substitute for running the tests, but catches most logic drift.
4. **Real verification (required before calling a step "done", not just "drafted")** — you run `npx tsc` and the relevant test file(s) on your own machine, or the Vercel/Railway build itself, since this sandbox cannot complete either. **No step in this plan should be marked complete on my say-so alone** — that's exactly how the `diagramUtils.ts` incident happened two sessions ago (implemented, hand-verified, never actually confirmed against a real compile, broke two consecutive deploys).

### 0.3 One extraction = one commit = one revert unit

Every step below produces exactly one commit, scoped to exactly the files that step touches. Never bundle "while I'm here" fixes into an extraction commit — if something else needs fixing, that's a separate commit, before or after, never inside.

### 0.4 Concurrent-session protocol (learned the hard way twice today)

This repo currently has at least one other active session committing directly to it. Two real incidents happened today from this:

- A bare `git commit -m "..."` after `git add <my files>` committed 12+ unrelated files that another session had staged but not yet committed, because `git commit` with no pathspec commits the *entire index*, not just what was just added.
- The fix, used from the second incident onward: **always commit with an explicit trailing pathspec** — `git commit -m "message" -- path/to/file1 path/to/file2` — never a bare `git commit -m "message"`. This commits only the named paths regardless of what else is sitting staged in the shared index, and leaves the other session's staged work untouched for them to commit themselves.

For this architecture upgrade specifically, given `proxy.js`, `ReviewGateModal.tsx`, and the chat files have all seen concurrent edits today:

1. **Before starting any extraction step, run `git log --oneline -10` and `git status --short` fresh** — don't assume the file looks like it did in the last review. Re-read the actual current file before extracting from it.
2. **Prefer extracting files/routes the other session hasn't touched recently** (nothing in `chat/`, nothing review-gate related, until confirmed quiet) — start with invite routes and lifecycle/branding routes in `proxy.js`, which no concurrent commit has touched today.
3. **Keep each step small enough to start and finish within one sitting** — the longer a step stays half-done, the larger the window for a collision.
4. **Always commit with the trailing pathspec**, every time, no exceptions, for the remainder of this effort.

---

## 1. Phase 1 — Extract `proxy.js`'s Invite Routes (lowest risk, start here)

**Why first:** invite handling already has four dedicated integration test files (`proxy.inviteAccept.integration.test.ts`, `proxy.inviteSecurity.test.ts`, `proxy.inviteDefaultPassword.test.ts`, `proxy.sendInviteEmail.test.ts`), meaning it's already logically self-contained enough that someone separated its *tests* by concern even though the *implementation* still lives in one file. That's the strongest signal in the codebase for "safe to extract first." No concurrent commit today touched invite routes.

### Steps

1. **Inventory.** Grep `backend/src/proxy.js` for every route path containing `invite` (`grep -n "invite" backend/src/proxy.js`) to get the current, real list of routes and their exact line ranges — do not reuse any line numbers from the earlier review, the file has moved since.
2. **Read each handler in full**, including: the exact middleware chain used, any helper functions or constants declared at proxy.js's module scope that ONLY these handlers use (candidates to move alongside them), and any module-scope thing they depend on that's shared with other routes (things like `dbPool`, `isConfiguredAdminEmail`, email-sending helpers — these get passed in as constructor/factory parameters, not duplicated).
3. **Create `backend/src/routes/inviteRoutes.js`** (matching the existing `.ts` factory-router convention from `backend/src/routes/memoryRecords.ts`: `export function inviteRoutes(deps) { const router = Router(); router.post('/accept', ...); return router; }`), adapted to `.js` to match `proxy.js`'s own module style rather than mixing `.ts` into a `.js`-authored app.
4. **Paste each handler body verbatim** into the corresponding `router.METHOD(...)` call. Do not change validation logic, error messages, or status codes.
5. **In `proxy.js`**, delete the extracted `app.get/post(...)` blocks and replace with one line: `app.use('/api/invites', inviteRoutes({ db: dbPool, /* whatever else Step 2 identified */ }));` (exact mount path taken from what Step 1 found — invite routes may not all share one prefix; if not, mount each sub-group separately rather than forcing a shared prefix that didn't exist before).
6. **Remove now-unused imports** from the top of `proxy.js` (anything only the extracted handlers used); **add needed imports** to the new file.
7. **Run the verification ladder** (Section 0.2) against both files.
8. **Commit**, pathspec-scoped to exactly `backend/src/proxy.js` and `backend/src/routes/inviteRoutes.js`.
9. **Stop. Do not start Phase 2 in the same sitting unless Step 7's real verification (item 4) has actually confirmed green** — this is the calibration step for how long the rest of the phases realistically take, and the first real test of whether this extraction pattern holds up in practice.

---

## 2. Phase 2 — Extract Agent Dispatch and Model Routing

**Why second:** this is the highest-value extraction (every single agent call in the entire application goes through `resolveDispatchTarget`/`dispatchAgentCall`), but it's riskier than Phase 1 because it's on the hot path — worth doing only after Phase 1 has proven the extraction pattern works cleanly in this specific codebase.

### Steps

1. **Inventory.** Grep for `resolveDispatchTarget`, `dispatchAgentCall`, `MODEL_CATALOG`, `clampMaxTokens` in `proxy.js` to find every definition and every call site (call sites matter here — this function is almost certainly called from multiple routes, unlike the invite handlers).
2. **Create `backend/src/dispatch/agentDispatch.js`** exporting the same function names, verbatim bodies.
3. **In `proxy.js`, replace each definition with an import** (`const { resolveDispatchTarget, dispatchAgentCall } = require('./dispatch/agentDispatch');`) — call sites stay exactly as they are, only the `require`/definition location changes, so this step touches far fewer lines than it might sound like.
4. **Special care:** if `resolveDispatchTarget`/`dispatchAgentCall` close over any module-scope state in `proxy.js` (e.g., a cached rate-limit map, an in-memory model-health tracker), that state needs to move with them or be passed in explicitly — closures are the most common way this class of extraction silently changes behavior (two routes that used to share one in-memory cache now each get their own if the state isn't moved correctly).
5. **Verification ladder**, with extra weight on Step 3 (test trace) — re-read `proxy.agentAccess.integration.test.ts` line by line against the new call path, since this is the route most exercised by real usage.
6. **Commit**, pathspec-scoped to `backend/src/proxy.js` and `backend/src/dispatch/agentDispatch.js`.

---

## 3. Phase 3 — Extract Remaining `proxy.js` Routes

By this point, `proxy.js` should be down to: app setup (Express init, CORS, body parsing), auth middleware definitions (`checkToken`), the lifecycle-events forwarding route, the branding/site-fetch route, and route registration lines pointing at everything extracted in Phases 1-2.

### Steps

1. Repeat the Phase 1 pattern (inventory → new router file → verbatim paste → replace with `app.use` → verify → commit) for each remaining logical group: lifecycle-events forwarding, branding/site-fetch, and any group not yet covered.
2. **One commit per group**, not one commit for all of Phase 3 — same reasoning as Phase 1/2: smaller units are easier to verify and revert.
3. After the last group, `proxy.js` should read like `backend/src/index.ts` already does: Express setup + a list of `app.use('/api/x', authMiddleware, xRouter(deps))` lines, nothing else. That end-state is the concrete "done" signal for this phase — if `proxy.js` still has any `app.get`/`app.post` with a real handler body inline, Phase 3 isn't finished yet.

---

## 4. Phase 4 — Split the Three Largest Frontend Components

Targets: `ProjectSettings.tsx` (1,897 lines), `ProjectWorkspace.tsx` (1,896 lines), `AppSettingsModal.tsx` (1,419 lines). Do these **after** the backend phases, not in parallel — `ProjectWorkspace.tsx` in particular is exactly the kind of file the concurrent session has already shown interest in today (their `reviewGateReadiness.ts` work touches `ProjectWorkspace.tsx`), so this phase should wait for a confirmed quiet window on that file specifically.

### Steps (repeat per component)

1. **Read the whole component once, end to end**, and categorize every piece of state/logic into one of: (a) pure data-fetching/mutation (calls to `db/projectRepository.ts`, `services/api.ts`, etc.), (b) derived/computed values with no side effects, (c) event handlers that call (a) or (b), (d) pure JSX/presentation.
2. **Extract (a) and (c) into a new hook**, following the exact existing convention (`hooks/useProject.ts`, `hooks/usePipeline.ts`, `hooks/useAgents.ts` — read one of these first to match its shape: return object keys, loading/error state pattern, etc., rather than inventing a new hook shape).
3. **The hook's returned shape must match what the component currently destructures** from its own internal `useState`/`useEffect` calls — i.e., if the component today does `const [x, setX] = useState(...)`, the new hook should expose `{ x, setX }` (or an equivalent updater) so the component's JSX and remaining handlers don't need to change at all, only their data source moves.
4. **Leave (b) and (d) in the component file.** The component after extraction should be readable top-to-bottom as: call the new hook, derive a couple of local values, return JSX — no business logic mixed in with markup.
5. **Verification ladder**, with the existing component test file (e.g., `tests/unit/ProjectWorkspace-controls.test.tsx`, `ProjectWorkspace-rerun.test.tsx`, etc. — there are several for `ProjectWorkspace.tsx` already) hand-traced against the new structure. These tests almost certainly render the component and interact with it via testing-library queries (role/text), which is good — that kind of test is naturally insulated from *where* the logic lives, as long as the component's rendered output and behavior are unchanged.
6. **Commit per component**, not one commit for all three.

---

## 5. Phase 5 — Split `agents/definitions.ts` and `agents/tools.ts`

Lowest priority (these files are large but not on anyone's critical path today, and are read/imported everywhere, so a mistake here has the widest blast radius of any phase — do this last, once the extraction pattern is well-proven).

### Steps

1. **`agents/definitions.ts`**: split by phase into `agents/definitions/phase0.ts` … `phaseN.ts`, each exporting its own `AgentDefinition` objects, with `agents/definitions/index.ts` re-assembling them into the exact same `AGENT_DEFINITIONS` object/map that exists today (same keys, same values, same insertion order if anything downstream relies on iteration order — check `Object.keys(AGENT_DEFINITIONS)` usage before assuming order doesn't matter). Every existing `import { AGENT_DEFINITIONS } from '@/agents/definitions'` elsewhere in the app should need **zero changes** — this is the acid test that the split was done correctly. If any import path needs updating outside of `definitions.ts`/`definitions/index.ts` itself, the split introduced a real change, not just a reorganization.
2. **`agents/tools.ts`**: split by the existing bundle groupings already visible in the file (`CONTEXT_TOOLS`, `ORCHESTRATOR_TOOLS`, `RESEARCH_TOOLS`, `OPTIMIZATION_TOOLS`, `GOVERNANCE_TOOLS`) into separate files, with `agents/tools/index.ts` re-exporting everything under the exact same names. Same acid test: no other file's imports should need to change.
3. **Verification**: this is the one phase where a genuine full-project `tsc` pass matters most, since `definitions.ts`/`tools.ts` are imported almost everywhere — push hard for a real `npx tsc` run (on your machine or via a throwaway Vercel preview deploy) before considering this phase done, more than any other phase in this plan.

---

## 6. Definition of Done (per step, not just per phase)

A step is done when, and only when, all of the following are true:

- [ ] The moved code is byte-identical in logic to the original (verbatim copy, confirmed by re-reading old and new side by side).
- [ ] Every call site of anything moved has been found via grep and updated, or confirmed unchanged because only the definition moved.
- [ ] The syntax check (Section 0.2, layer 1) passes.
- [ ] The import audit (layer 2) found no orphaned references to the old location.
- [ ] The relevant existing test file(s) have been hand-traced against the new structure (layer 3).
- [ ] **A real compile/test run — not mine — has confirmed it (layer 4).** This is the one that was skipped two sessions ago and caused a production build failure; it does not get skipped again.
- [ ] The commit is pathspec-scoped to exactly the files this step touched (Section 0.4).
- [ ] `git status` immediately after the commit shows nothing unexpected staged or missing.

---

## 7. Rollback Procedure

Because every step is one small, isolated commit:

- **To undo the most recent step:** `git revert <commit-sha>` (safer than `reset` once anything might have been pushed) — the revert is small and scoped, since the original commit was too.
- **To undo an entire phase:** revert each of that phase's commits in reverse order.
- **If a step is caught broken *before* committing:** just discard the working-tree changes for the specific files touched (`git checkout -- <files>` or equivalent) — nothing else is affected since no other unrelated files should ever be part of the same working session for that step (Section 0.3).
- No step in this plan involves a destructive database migration or an irreversible data change — every rollback is a pure code revert.

---

## 8. Suggested Sequencing Against the Existing Roadmap

`docs/architecture/agentic-maturity-roadmap.md` already tracks Phase 3 ("Backend durable orchestration") and Phase 7 ("Critic and reviewer agents"). This plan's Phases 1-3 (proxy.js decomposition) are effectively the concrete implementation of roadmap Phase 3's precondition — you can't move execution authority to a durable backend orchestrator while the current backend is one 4,000-line file. Recommend updating the roadmap's Phase Tracker to reference this document once Phase 1 here actually starts, rather than tracking the two efforts separately.

**Nothing in this plan starts until you say go — and even then, one phase, one step, one commit at a time, each with real verification before the next.**
