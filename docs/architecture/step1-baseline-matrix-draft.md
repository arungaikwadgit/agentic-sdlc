# Step 1 — Enterprise-Readiness Baseline Matrix (Draft, for review)

**Scope note, read first:** This is a first pass, built only from evidence already gathered and cited earlier in this program (this session and the prior session segment it continues). It covers the architecture areas where I have direct, cited evidence — not yet all 60-80 components the full program eventually needs. Rows marked **Requires verification** are exactly that: not guessed, not inferred from adjacent evidence, flagged for a dedicated check before Steps 2-20 build specs on top of them. Per Process Rule 1, nothing here is presented as final without a citation.

Legend: 🟢 Confirmed working in production/main · 🟡 Exists but limited/partial/off by default · 🔴 Missing or confirmed broken · ⚪ Requires verification

---

## A. Pipeline Orchestration & Review Gates

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---|---|---|
| Phase/agent execution ordering | 🟢 | `PHASE_ORDER`/`PHASE_AGENTS` drive a 30-agent pipeline across phases 0a-6; single source of truth `getGateRequiredBeforePhase()` in `agentEnablement.ts` | None currently known | `frontend/src/lib/agentEnablement.ts:129-140`; regression test in `tests/unit/pipelineEngine-orchestration.test.ts` | — |
| Gate-blocks-execution (manual run/re-run) | 🟢 (fixed this program) | A gate no longer lets agents behind it run before approval, including on resume past an unpersisted gate | None known post-fix | Commit `3788e80b`; `getGateBlockingAgent()` in `agentEnablement.ts:166-173` | Was a real production data-integrity bug (project `c6736efb-...`), now remediated in both code and that project's data |
| Gate-approval ordering (review UI) | 🟢 (fixed this program) | A gate can no longer be approved while an earlier gate is unapproved, even if its own artifacts are done | None known post-fix | Commit `1fb7758d`; `frontend/src/lib/reviewGateReadiness.ts:44-47`, 6 passing tests in `tests/unit/reviewGateReadiness.test.ts` | Was live in production data (gate1 approved with gate0 never approved); data corrected via backed-up Supabase UPDATE |
| Admin gate override (unlock/lock/unlock-all) | 🟢 | Deliberate escape hatch for admins, separate code path from the two fixes above, correctly out of scope for them | Not a gap — by design | `frontend/src/components/admin/AdminPanel.tsx` | — |
| Team-assignment-driven agent skipping | 🟢 | Unassigned agents auto-skip; `sdlcOrchestrator`/`tokenOptimizer`/`aiGovernance` exempted so gate0 always has something to review | None known | `frontend/src/lib/agentEnablement.ts:19-79` | — |
| Sidebar "already run" status display bug | 🟢 (fixed this program, per user report) | Previously-executed agents were shown as complete even after being reset; fixed per this session's earlier UI work | Not independently re-verified with a fresh screenshot this turn | User-reported and addressed earlier this session (see prior turns) | ⚪ Recommend a screenshot check before calling this fully closed |

## B. Agentic RAG & Memory

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---|---|---|
| RAG pipeline for the in-app chatbot | 🟢 | Full pipeline: query rewrite, evidence-sufficiency scoring, citations, retry loop | None known for this specific surface | `backend/src/chat/` | — |
| RAG for the 30 SDLC pipeline agents | 🔴 | No retrieval pipeline — agents self-report confidence only | Every pipeline agent's "confidence" is unverified self-assessment, not grounded in retrieved evidence | `backend/src/l3Runtime.ts`; `docs/architecture/agentic-rag-gap-analysis-and-plan.md` | Material — this is the single largest capability gap between "agents that produce plausible text" and "agents that ground claims in real project context" |
| Memory architecture — scope taxonomy | 🟢 (designed), 🟡 (implemented) | Two-scope model (`project_private`/`domain_shared`) with a mandatory dual-filter SQL predicate and an approval gate for domain-shared records; ADR fully specifies this | v1 retrieval is tag+keyword, not semantic | `docs/ADR/ADR-004-memory-architecture.md` | Cross-project knowledge reuse is coarse (keyword match) until v2 |
| Vector search / embeddings | 🔴 (deliberately deferred) | Not installed. `pgvector` extension absent from Supabase (confirmed via `list_extensions`); `embedding vector(1536)` column explicitly commented out in the initial migration | Semantic memory retrieval, and any future embedding-based agent grounding, has no DB-level foundation yet | `backend/migrations/001_initial_schema.sql`; Supabase `list_extensions` result this session; ADR-004 explicitly defers this to v2 | This is a stated, intentional roadmap item, not an oversight — but it blocks any Step 6 spec that assumes semantic search |

## C. Deployment Topology & Infrastructure

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---|---|---|
| Frontend/proxy service | 🟢 | Deployed on Railway (`agentic-sdlc`, project `steadfast-flexibility`), single service | None known | Railway `get-service-config`, `list-services` this session and prior | — |
| Project/Admin API (`server/src`) | 🟢 (resolved this session — was previously an open P0) | Deployed as Railway service `artistic-charm` (project `zucchini-rejoicing`), `rootDirectory: "server"`, live on commit `293c48c1`, healthy `/health` check | One deploy attempt (`63885eb1`) failed and its logs are unrecoverable (Railway GC'd them); root cause unknown but very likely inconsequential — no commit this session touches `server/` | `get-service-config`, `list-deployments`, `get-status` this session | Was previously misclassified as "maybe not deployed" — now confirmed live, so Identity/RBAC/project-CRUD/admin-panel functionality that depends on it should NOT be downgraded as this program continues |
| Runtime API (`backend/src/index.ts`, distinct from the proxy) | ⚪ | `backend/package.json` has a `runtime:start`/`runtime:build` script separate from `start` (the proxy) | Not yet confirmed which Railway service (if any) runs this specific entrypoint vs. the proxy | `backend/package.json` scripts | Needs a dedicated check — do not assume it shares a service with the proxy just because they're in the same repo |
| Background lifecycle worker (Token Optimizer / AI Governance async runs) | 🔴 (code exists, off in prod) | `BACKGROUND_WORKER_ENABLED` does not appear in the live Railway service's 33 enumerated variables | Async governance/optimization runs are not actually executing in production despite the code path existing | Verified directly against live Railway variables, earlier this session | Any Step 6 spec or NFR that assumes this worker is running needs an explicit "currently off" caveat |
| Supabase plan / backup posture | 🟡 | Free tier (confirmed via `get_organization`); auto-pauses on inactivity, which caused several false "hibernated" errors this session | No point-in-time recovery (inferred from published free-tier policy, not a direct query — stated as high-confidence inference, not a hard fact) | `get_organization`, `get_advisors` this session | A real production-readiness gap for an "enterprise-grade" claim — PITR/backup posture needs a deliberate decision, not silent acceptance of the free tier |
| Supabase RLS coverage | 🟡 | ~24 tables have RLS *enabled* but zero policies attached — meaning access control is 100% application-code-enforced, zero DB-layer defense-in-depth | No DB-level authorization backstop if application code has a bug | `get_advisors` this session | Material for any security/compliance-facing claim ("defense in depth") |
| `_claude_backup_2026_08_07` snapshot table | 🟢 (fixed this session) | RLS enabled, verified via `pg_class.relrowsecurity = true` and a clean advisor re-run | None known post-fix | This session's remediation | Was a real, self-introduced exposure; now closed |
| CI pipeline | 🟡 | 4 jobs (backend/frontend/server/shared-types), real Postgres service container for backend integration tests, `typecheck` + `migrate:up:test` + `test` steps | Only frontend has a coverage step; backend runs plain `jest` with no coverage gate; `server/` has 140 test files and **no test runner installed at all** (no test script, no jest/vitest/mocha dependency) | `.github/workflows/ci.yml`; `server/package.json` — re-verified this session | A "90%+ coverage" NFR cannot be enforced for 2 of 3 backend-side codebases today — this is a concrete, scoped implementation task, not a vague testing-strategy aspiration |

## D. Security & Data Protection

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---|---|---|
| Integration credential encryption | 🟢 | AES-256-GCM envelope encryption, versioned storage marker | Covers integration credentials only, not the database's general posture | `backend/src/integrationCredentialCrypto.js` | — |
| F7 (authorization gap) / F8 (plaintext token storage) | 🟢 (per doc, not independently re-verified this session) | Documented as fixed in `docs/security-review-2026-07-05.md` | Not re-confirmed against current `main` this session — the doc's claim was taken at face value from a prior read, per Process Rule 4 this should get a fresh spot-check before Step 6 specs cite it as closed | `docs/security-review-2026-07-05.md` | ⚪ Low risk of being stale (doc is recent relative to program start) but flagging per Rule 4 rather than silently trusting it |
| Dead code referencing non-existent tables | 🟡 | Known and documented: `server/src/routes/invites.ts` references tables that don't exist | Not yet scheduled for removal | `docs/security-review-2026-07-05.md` | Low risk (dead code) but noise in any future security audit |
| Supabase Auth — leaked-password protection | 🔴 | Disabled | Users can set already-breached passwords | `get_advisors` this session | Straightforward, low-effort fix; worth an early quick win |
| Two SECURITY DEFINER views, two functions with mutable search_path | 🔴 | Flagged ERROR/WARN by Supabase's own advisor | Real, specific, fixable findings | `get_advisors` this session — view names: `agent_token_usage_summary`, `agent_token_usage` | Should be an early quick-win wave, not bundled into a large future spec |

## E. Testing & Quality

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---|---|---|
| Backend unit tests | 🟡 | 45 test files (42 non-integration + 3 integration requiring a live Postgres) | Cannot be executed reliably in this sandbox (see Ledger #3) — status is "exists, CI-only verifiable," not confirmed passing from this session | `find src -name "*.test.ts"` this session; CI config | Coverage/pass-rate claims must cite the next real CI run, not this session's attempts |
| Frontend unit tests | 🟢 (existing, CI-gated) | `vitest`, CI-enforced coverage step | Local sandbox run hung without completing; not this session's finding about the suite itself, a sandbox limitation | `.github/workflows/ci.yml`; this session's attempts | — |
| Server tests | 🔴 | 140 `*.test.ts` files present, zero test runner installed, no `test` script | Effectively 140 files of dead test code today | `server/package.json`, `find server -name "*.test.ts"` this session | High — this is either a lot of wasted authored test effort or a packaging oversight; worth a dedicated, low-effort investigation (is a runner missing from `package.json` by mistake, or was this abandoned?) |
| Eval scorers (agent output quality) | 🟡 | Heuristic scorers exist, in-code comments note they need eventual LLM-judge replacement | Self-acknowledged as a stopgap, not production-grade evaluation | `tests/eval/scorers.ts` | Relevant to any "AI quality assurance" enterprise claim |
| Load/performance testing | 🟡 | One k6 script, 10 virtual users | Not remotely enterprise-scale; single scenario | `tests/performance/pipeline-load.js` | Needs real load modeling before any production-scale claim |
| User feedback capture (thumbs/rating on agent output) | 🔴 | Absent — confirmed by grep, zero hits across `*.ts`/`*.js` for feedback-capture patterns | No mechanism to learn from user corrections/ratings at all | Grep, earlier this session | Blocks any future "agents improve from feedback" claim entirely — there's no data being captured to improve from |

---

## What this matrix does NOT cover yet

Explicitly out of scope for this pass — not overlooked, deliberately deferred to avoid guessing:

- Frontend UI component inventory (dashboards, individual agent panels, mockup previews, etc.)
- The full 30-agent roster's individual prompt quality/scope (only the RAG-grounding gap above is characterized)
- RBAC role/permission matrix detail (only the DB-layer RLS gap is characterized here — app-layer RBAC itself needs its own pass)
- Third-party integrations (Slack/Jira/etc. connectors, if any exist in this codebase — not yet checked)
- Cost/token-usage governance beyond the "worker is off" finding above

These become their own rows once a dedicated evidence pass is run for each — continuing this matrix, not restarting it.

---

**Status:** Draft, held for your review before any Step 6 component specs get written against it. Nothing above authorizes a code change — per Process Rule 3, that still requires a separate, explicit go per component/wave.
