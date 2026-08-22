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
| Project/Admin API (`server/src`) | 🟢 (fixed and confirmed live) | Deployed as Railway service `artistic-charm` (project `zucchini-rejoicing`), `rootDirectory: "server"`. Deploy pipeline was broken (see Gap), fixed via `server/railway.json` (commit `9d7eea87`), and the resulting redeploy (`d83dc303`, 2026-08-22T02:29 UTC) is confirmed **SUCCESS**, observed serving real 200-status traffic (`/api/projects`, `/permissions/me`) in deploy logs | Historical: every deploy of this service silently failed from ~Aug 7 until this session's fix — repo-root `railway.json` (meant for the other service) was shadowing this service's own build config, so `tsc` never ran and `dist/index.js` never got produced; Railway's rollback masked it with zero visible outage the whole time. **Resolved as of this session** | Deploy logs for failures `63885eb1`/`3ccd8371` and success `d83dc303`; `get-service-config` on both Railway services | Was flagged 🟡 earlier this session pending live confirmation of the redeploy — now confirmed and upgraded to 🟢 in Step 2's verification pass |
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

## F. Data Layer & Schema Governance (new category — largest single finding of this pass)

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---|---|---|
| Migration files vs. live applied schema | 🔴 | Live `pgmigrations` tracking table (node-pg-migrate's own record, queried directly) shows migrations `000` through `023` have run against production, at three batch timestamps (2026-07-06, 2026-07-24, 2026-07-25) | The `main` branch's `backend/migrations/` folder only contains `000`-`009` and `011`-`015` — **migration `010` (`voice_rerun_backlog`) and `016` through `023` (`policy_decisions`, `memory_policy_audit`, `signed_policy_decisions`, `policy_decision_consumption`, `autonomous_agentic_execution_backlog`, `agent_token_usage_view`, `tool_call_audit_log`, `correlation_ids`) do not exist as files in the repo at all.** A fresh `npm run migrate:up` against a new environment today would stop short of production's actual schema — it cannot reproduce what's live. This also fully explains an earlier finding this session (two SECURITY DEFINER views flagged by the security advisor with no matching migration file anywhere in the repo) — migration `021` created them; that file was simply never committed. | `execute_sql` against live `pgmigrations` table this session, cross-checked against `ls backend/migrations/*.sql` earlier this session | High, and the single biggest "is this reproducible" gap found in the whole program so far. Disaster recovery, new-environment stand-up, or onboarding a new engineer would all silently diverge from production today. This should be a very early, high-priority remediation item — not folded into a general "testing strategy" wave |
| RLS policy coverage, precise count (correcting an earlier session's blanket characterization) | 🟡 | Queried directly: `projects` and `team_members` each have 4 real policies (SELECT/INSERT/UPDATE/DELETE, `app_role`-based); `agent_runs`, `agent_jobs`, `memory_records`, `rollback_log`, `invite_log`, `action_proposals` each have exactly 1 (a blanket `ALL` policy); the remaining 26 of 34 tables have RLS enabled with **zero** policies — deny-by-default, service-role-key-only access | This is a legitimate, common pattern for backend-only tables (default-deny until the app explicitly opens access), not automatically a defect — but it means "24 tables, zero DB-layer defense in depth" (an earlier session's phrasing) overstates it for the core user-facing tables and understates the precise count for governance/audit tables. Worth a deliberate per-table review, not a blanket fix | `execute_sql` against `pg_policies` this session | Refines, not reverses, the earlier finding — replace the earlier blanket claim with this table when Step 6 specs reference RLS posture |

## G. Application-Layer RBAC

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---|---|---|
| Role model | 🟢 | Four roles (`project_owner`/`editor`/`reviewer`/`viewer`), defined identically in frontend types and the DB `app_role` enum | None known — the two are in sync | `frontend/src/types/project.types.ts:10`; `backend/migrations/000_full_schema.sql:47` | — |
| Permission checks | 🟢 | Centralized in `frontend/src/lib/projectAccess.ts`: `getProjectMember`, `isProjectAdminUser`, `getProjectExportPermission`, `getReviewGatePermission`, `getAgentRunPermission` | Not yet checked: whether backend routes (`server/src`) independently re-verify these permissions server-side, or trust the frontend's checks | `frontend/src/lib/projectAccess.ts:54-189` | ⚪ Requires verification — if the server API doesn't re-check permissions itself, a malicious client could bypass frontend-only RBAC entirely. This is a meaningfully different risk level depending on the answer and should be checked before any security-facing claim |

## H. Third-Party Integrations

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---| ---|---|
| Supported providers | 🟡 | Five: Jira, Confluence, GitHub, GitLab, Slack (types only defined for Jira and GitHub credential shapes) | Confluence/GitLab/Slack credential shapes aren't typed yet — unclear if those three are fully wired or placeholder | `frontend/src/types/integration.types.ts` | Scope this precisely before any Step 6 spec claims "N integrations supported" |
| Credential storage | 🟡 | Client-side AES-GCM encryption (`utils/crypto.ts`), passphrase stored in `localStorage`, synced via `appStateApi` | This is a **separate** credential-storage mechanism from `backend/src/integrationCredentialCrypto.js` (server-side AES-256-GCM) — two parallel systems for what sounds like the same concern | `frontend/src/hooks/useIntegrations.ts` | ⚪ Requires verification — need to confirm these serve genuinely different purposes (e.g. one for user-level API keys, one for org-level) rather than being redundant/inconsistent security postures |

## I. Cost & Token Governance

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---|---|---|
| Token usage tracking (DB) | 🟢 (schema exists) | `agent_token_usage` / `agent_token_usage_summary` views live in production (migration `021`, per Ledger F above) | The migration file that creates them isn't in the repo (see Data Layer finding above) | Live Supabase `get_advisors` + `pgmigrations`, this session | Same reproducibility gap as Ledger F |
| Token Optimizer / AI Governance agents | 🟡 | Both are real pipeline agents (`frontend/src/agents/definitions.ts:222`, `:283`), exempted from team-assignment-skip so they always run in the synchronous pipeline | The separate **async** background-worker path for these (per earlier finding) is off in production (`BACKGROUND_WORKER_ENABLED` unset) — so only the in-pipeline synchronous run happens, not whatever the background worker was meant to add | `frontend/src/agents/definitions.ts`; earlier live Railway variable check | Any spec assuming the background worker's periodic/async governance runs needs to state plainly that only the synchronous, in-pipeline version currently runs |

## J. Frontend UI — Structural Inventory (not a quality audit)

| Component | Status | Current Capability | Gap | Evidence | Production Impact |
|---|---|---|---|---|---|
| Component organization | 🟢 | 11 feature-organized directories under `frontend/src/components/`: admin(4 files), auth(5), common(4), createProject(6), dashboard(5), documents(6), invite(1), pipeline(7), reviewGate(1), settings(2), team(1) — 42 `.tsx` files total | This is a structural count only — no per-component quality/accessibility/consistency review has been done | `find frontend/src/components` this session | A real UI/UX audit (design-system consistency, accessibility) is a distinct future pass, not implied by this row |
| Agent roster size (correction) | 🟢 | **32** agent definitions confirmed by direct count (`frontend/src/agents/definitions.ts`), not "30" as stated in earlier session notes and in this document's own RAG section above | Minor factual correction, noted so it doesn't propagate | `grep -c "^\s*id:\s*'"` this session | Update "30 pipeline agents" references elsewhere in this program to 32 |

---

## What this matrix does NOT cover yet

Explicitly out of scope for this pass — not overlooked, deliberately deferred to avoid guessing:

- Per-agent prompt quality/scope for all 32 agents individually (only the RAG-grounding gap is characterized at the fleet level)
- Whether `server/src` independently re-verifies RBAC (flagged ⚪ in section G, needs a dedicated check)
- Full typing/wiring confirmation for Confluence/GitLab/Slack integrations (flagged 🟡 in section H)
- Per-component UI/UX quality, accessibility, and design-system-consistency audit (section J is structural only)
- The 3 backend integration tests that need a live Postgres to run at all (noted in section E but not executed)

These become their own rows once a dedicated evidence pass is run for each — continuing this matrix, not restarting it.

---

**Status:** Draft, held for your review before any Step 6 component specs get written against it. Nothing above authorizes a code change — per Process Rule 3, that still requires a separate, explicit go per component/wave.
