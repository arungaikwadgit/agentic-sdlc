# Step 9 — Testing Strategy

**Status:** Draft, held for review per your standing approval (planning-only, no code changes) — Process Rule 3 still applies to any actual implementation.

**Source:** builds directly on Step 8's testing/coverage NFR row and the real, verified state of each codebase's test infrastructure as of this session.

---

## 1. Current state, per codebase (verified, not assumed)

| Codebase | Test runner | Coverage in CI | Real coverage % |
|---|---|---|---|
| `frontend/` | Vitest | Yes — `test:coverage` runs in `.github/workflows/ci.yml` | Unknown — never pulled from a live post-push run (Step 1 Ledger #3, still open) |
| `backend/` | Jest (`jest --testPathPattern=src/`), 45 `.test.ts` files | **No** — CI runs plain `jest`, no coverage step | Unknown — no coverage tooling invoked at all |
| `server/` | Jest, scaffolded this session (`jest.config.js`, `jest.setup.ts`, one real suite: `auth.test.ts`) | Not yet wired into CI | Effectively ~0% — one file covering `isAppAdmin`/`requireAppAdmin` only |

## 2. Test pyramid, mapped to what already exists

**Unit** — the bulk of coverage should live here, per-codebase:
- `backend/`: 45 existing files, healthy base to build from
- `server/`: needs real build-out beyond the one auth suite — priority order should follow Step 6's value scoring: `routes/projects.ts` (RBAC-critical, already manually verified this session — codify that verification as tests), then `routes/agents.ts`, `routes/adminTests.ts`
- `frontend/`: existing Vitest suite, scope unknown from this program alone — needs its own inventory pass

**Integration** — the layer this program's own work this session substituted for automated tests in several places (manual RBAC verification, manual migration-file verification via live `execute_sql`). These should become real, repeatable tests rather than one-off manual checks:
- Migration idempotency: every `backend/migrations/*.sql` file should be runnable against a test database and assert the resulting schema matches `information_schema` expectations — this session did this manually via Supabase's SQL tool; a CI job could do it on every migration file change
- RBAC enforcement: a test hitting `requireProjectRole()` with each `app_role` value against each mutating route, asserting 403 for disallowed roles — currently verified by code review only (Wave 1 item 2), not by an automated test

**E2E** — `adminTests.ts`'s `runE2E` suite already documents the intended path (Playwright, `npm run test:e2e` in `frontend/`) but explicitly can't run in the Railway server environment. No changes recommended here — the existing design (skip in prod, run in CI/local) is sound.

**Agent output quality (a fourth category specific to this platform)** — not unit/integration/e2e in the traditional sense, but the eval scorers (Step 6 #16, heuristic → LLM-judge) are this platform's equivalent of a quality test suite for the 32 pipeline agents. Sequencing note: benefits from RAG grounding (Step 6 #5) landing first — evaluating groundedness is more meaningful once agents actually retrieve evidence — but isn't strictly blocked by it, per Step 2's original dependency analysis.

## 3. Coverage target and how to get there without a false gate

Your standing instruction is >95% coverage. Applying it as a **hard CI gate today** would be premature and counterproductive — there's no trustworthy baseline in `backend/` or `server/` yet (this exact concern was already raised in the Wave 4 spec: "report-only-first, not a hard gate, since no trustworthy baseline exists"). Recommended sequence:

1. Add a coverage *reporting* step to `backend/`'s CI job (no gate) — get a real number.
2. Get `frontend/`'s real number from the next CI run post-push (still outstanding from Step 1).
3. Build out `server/`'s suite past the one file that exists today, with coverage reporting from the start.
4. Once all three have a real, trustworthy baseline, set the 95% gate — as an increasing ratchet if starting below it (e.g., "must not decrease" first, then raise the floor over subsequent sprints) rather than an immediate hard cutover that blocks all future PRs on day one.

## 4. What this doesn't cover

This step is silent on load/performance testing (Step 6 #17, tracked separately — different concern, different tooling) and on the RAG/agent-quality eval scorer redesign itself (Step 6 #16 — this step only notes where it fits in the pyramid, not how to build it).

---

**Approval needed to proceed:** none required to continue planning per your standing approval — flagging per Process Rule 3 only if any of this moves from plan to actual test-writing.
