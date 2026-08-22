# Step 4 — Component Specs, Wave 4 (Platform Hardening & Integrations)

**Status:** Draft, continuing Step 4. Same rules as prior waves: planning only.

---

# 1. CI Coverage Gap Fix — Backend + Server (P1)

**1. Purpose & Problem Statement.** `.github/workflows/ci.yml` only runs a coverage step for frontend (Step 1, Section C). Backend runs plain `jest`, no coverage gate; server has no test runner at all (Wave 1, item 3).

**2. Current State.** 1 of 3 backend-side codebases has CI-enforced coverage.

**3. Target State.** All three (frontend, backend, server) have coverage reporting in CI, with an agreed threshold (the original program's own stated aim was 90%+, per your standing instruction — worth confirming that's still the target before enforcing it as a hard gate, since a sudden 90% requirement against untested legacy code could block unrelated PRs).

**4. Scope.** In: adding `--coverage` to backend's `jest` CI step; adding server's coverage step once Wave 1's test-runner fix lands. Out: actually writing new tests to hit a coverage threshold — that's a much larger, separate body of work implied but not included here.

**10. Dependencies.** Server half depends on Wave 1's test-runner fix (Step 2, item #7). Backend half is independent, can start now.

**11. Pre-Implementation Gate.** Risk: turning on a hard coverage gate before current coverage is known could immediately break CI for unrelated future PRs if current coverage sits well below whatever threshold gets set. Mitigation: report-only first (coverage number visible in CI output/PR comments), decide on an enforced threshold once the real baseline number is known — this program flagged repeatedly that a fresh, trustworthy coverage number hasn't been obtainable yet (Step 1, Section E), so setting a hard gate before that number exists would be guessing.

**19. Effort Estimate.** Small for backend (config change), depends on Wave 1's outcome for server.

**20. Open Questions.** Confirm the 90%+ target is still current intent, or whether a lower initial threshold with a ratchet-up plan is preferred.

**21. Owner/Sign-off.** Unassigned, awaiting go.

---

# 2. Background Lifecycle Worker Decision (P1)

**1. Purpose & Problem Statement.** The async worker for Token Optimizer/AI Governance runs exists in code but `BACKGROUND_WORKER_ENABLED` is unset in production (Step 1, Section C).

**2. Current State.** Code exists, dormant. Only the synchronous in-pipeline agent runs currently execute (Step 1, Section I).

**3. Target State.** An explicit decision: turn it on (understand what it actually adds beyond the synchronous runs — not fully characterized in this program, would need a code read of the worker's actual logic before flipping the flag blind), or formally document it as out of scope / superseded by the synchronous path.

**4-9.** Contingent entirely on the decision — no design work until "turn it on" or "scope it out" is chosen.

**10. Dependencies.** None.

**11. Pre-Implementation Gate.** Risk of just flipping the flag on without understanding current behavior: unknown resource/cost impact (a background worker running periodically has different cost characteristics than synchronous pipeline runs), and unknown whether it duplicates or conflicts with the synchronous path's work. Mitigation: read `backend/src/lifecycle/` (referenced in Step 1 but not deeply examined this program) before deciding, don't flip the flag as a first step.

**19. Effort Estimate.** Small for the decision once the code is understood; the code-reading step is the real prerequisite work.

**20. Open Questions.** What does the background worker actually do differently from the synchronous runs? Not answered in this program — needs a dedicated read.

**21. Owner/Sign-off.** Unassigned, awaiting go.

---

# 3. Integration Credential Storage Investigation → Provider Scoping (P2)

**1. Purpose & Problem Statement.** Two parallel credential-encryption systems exist (client-side AES-GCM in `useIntegrations.ts`, server-side AES-256-GCM in `integrationCredentialCrypto.js`) with no confirmed reason for the split (Step 1, Section H). Also: 5 integration providers claimed, only 2 have typed credential shapes.

**2. Current State.** Both systems exist and are used somewhere; their respective scope/purpose isn't documented anywhere found this program.

**3. Target State.** A clear answer: are these two systems serving genuinely different purposes (e.g. user-level vs. org-level credentials), or is one redundant/should be deprecated? Then, informed by that answer, precise scoping of which of the 5 claimed providers (Jira/Confluence/GitHub/GitLab/Slack) are actually fully wired vs. placeholder.

**4-9.** Investigation first; any consolidation work would be a follow-on spec once the answer is known.

**10. Dependencies.** Provider scoping benefits from the credential-storage investigation resolving first (Step 2, item #15 depends on #14), so they're sequenced as one two-step item.

**11. Pre-Implementation Gate.** Risk: assuming redundancy and deleting one system without confirming intent first could break a legitimate use case. Mitigation: this spec is investigation-only; no consolidation without a separate explicit decision once the answer is known.

**19. Effort Estimate.** Small-Medium — mostly code reading and confirming actual call sites for each credential system.

**20. Open Questions.** The core question this whole item exists to answer.

**21. Owner/Sign-off.** Unassigned, awaiting go.

---

# 4. Load/Performance Testing Expansion (P2)

**1. Purpose & Problem Statement.** Current load testing is one k6 script at 10 virtual users (Step 1, Section E) — not representative of any real production-scale scenario.

**2. Current State.** `tests/performance/pipeline-load.js`, single scenario, 10 VUs.

**3. Target State.** A load test scenario reflecting realistic concurrent usage (exact target numbers not established this program — would need actual or projected user-count data, which hasn't been gathered, rather than picking an arbitrary bigger number).

**4-9.** Standard k6 scenario expansion — ramp patterns, more realistic request mix across the actual agent pipeline endpoints, not just a flat VU count increase.

**10. Dependencies.** None technical, though realistic target numbers would benefit from actual usage data if it exists somewhere (not checked this program).

**11. Pre-Implementation Gate.** Risk: an arbitrary "bigger number" without real usage data to calibrate against produces a test that looks more rigorous without actually being more meaningful. Mitigation: this spec explicitly flags needing real or projected usage figures before committing to specific VU/scenario targets.

**19. Effort Estimate.** Small-Medium.

**20. Open Questions.** Actual or projected concurrent user targets — not established.

**21. Owner/Sign-off.** Unassigned, awaiting go.

---

**Next in Step 4:** Wave 5 (low-urgency polish) — continuing without pausing.
