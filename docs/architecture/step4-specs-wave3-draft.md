# Step 4 — Component Specs, Wave 3 (RAG & Agent Output Quality)

**Status:** Draft, continuing Step 4 without pausing per instruction. Same rules as Wave 1's spec doc: planning only, no implementation authorized here.

---

# 1. Vector Search / Embeddings (pgvector) Installation (P1)

**1. Purpose & Problem Statement.** `pgvector` is not installed on the Supabase project (confirmed via `list_extensions`); the `embedding vector(1536)` column is explicitly commented out in `backend/migrations/001_initial_schema.sql`. This is a deliberate, documented v2 deferral (ADR-004), not an oversight — but it's the hard blocker for any real RAG grounding.

**2. Current State.** No vector extension, no embedding columns, memory retrieval is tag+keyword only (ADR-004 v1).

**3. Target State.** `pgvector` extension enabled on the Supabase project; `memory_records` (and any other table needing semantic search) has a real `vector` column; an embedding-generation path exists (choice of model needed — see Open Questions).

**4. Scope.** In: enabling the extension, adding the column(s), choosing and wiring an embedding model for new records. Out: backfilling embeddings for all historical records (separate follow-on task, potentially expensive depending on volume) and building the actual RAG retrieval logic (that's Item 2 below).

**5. Functional Requirements.** New `memory_records` (and eventually other evidence sources) get an embedding computed at write time; a similarity-search query path exists (`<->` or `<=>` operators via pgvector) callable from the backend.

**6. Non-Functional Requirements.** Embedding generation must not meaningfully slow down the synchronous agent pipeline — likely needs to be async/best-effort rather than blocking agent completion, given the pipeline's existing latency profile (not measured this program, flagged as an open question).

**7. Architecture/Design Approach.** `CREATE EXTENSION vector;` via a new migration; add `embedding vector(N)` column sized to match the chosen embedding model's output dimension; embedding generation call added wherever `memory_records` are currently written (needs a code location check — not yet identified in this program).

**8. Data Model/Schema Changes.** New migration: enable extension, add column(s), likely a supporting index (`ivfflat` or `hnsw`, pgvector's two indexing options — choice affects build time vs. query speed, needs a decision based on expected table size, which is currently unknown).

**9. API/Interface Changes.** New internal function for similarity search; no external API surface implied yet.

**10. Dependencies.** None technical (Step 2, item #4) — this has been sitting as a scheduling decision, not a blocker. Blocks: Item 2 (RAG grounding) entirely.

**11. Pre-Implementation Gate.** Risk 1: embedding model choice has cost/latency/quality tradeoffs not yet evaluated in this program — needs a real comparison (e.g. OpenAI `text-embedding-3-small` vs. a self-hosted option), not a default guess. Risk 2: unknown current `memory_records` row count — if large, backfill is a real cost/time question, not a rounding error. Mitigation: this spec explicitly does NOT authorize a model choice or a backfill plan — those need their own decision before Item 1 starts, not assumed as part of "just enable pgvector."

**12. Security Considerations.** None beyond existing DB access controls — embeddings aren't more sensitive than the text they're derived from, but should inherit the same RLS/access posture as `memory_records` itself.

**13. Testing Strategy.** After enabling: write a record, confirm an embedding is generated and stored, run a similarity query, confirm sane nearest-neighbor results against a small hand-built test set.

**14. Rollout Plan.** Migration first (extension + column, no data yet), then wire up embedding generation on new writes, verify, then decide on backfill separately.

**15. Rollback Plan.** Extension and column can be dropped if abandoned; no destructive risk to existing data since this is purely additive.

**16. Monitoring/Observability.** Track embedding generation latency and failure rate once live — not yet instrumented.

**17. Documentation Updates Required.** Update ADR-004 to mark v2 as in progress; update Step 1 Section B once closed.

**18. Acceptance Criteria.** Extension enabled, column exists, a real similarity query returns sensible results against a small test set.

**19. Effort Estimate.** Medium — the extension/column work is small, but the embedding-model decision and integration point identification are the real work here, not the SQL.

**20. Open Questions.** Embedding model choice (cost/latency/quality tradeoff, unevaluated). Current `memory_records` volume (unknown — affects backfill planning). Indexing strategy (`ivfflat` vs `hnsw`, depends on volume). Exact code location(s) where `memory_records` get written (not yet identified this program).

**21. Owner/Sign-off.** Unassigned, awaiting go — and specifically awaiting the model-choice decision before implementation can meaningfully start.

---

# 2. RAG Grounding for the 32 Pipeline Agents (P1)

**1. Purpose & Problem Statement.** The 32 SDLC pipeline agents (`frontend/src/agents/definitions.ts`) currently self-report confidence with no retrieval step — every "confidence" value is an unverified LLM self-assessment, not grounded in retrieved evidence. This is the single largest capability gap found in the whole program (Step 1, Section B).

**2. Current State.** Full contrast exists in-repo: the in-app chatbot (`backend/src/chat/`) already has a real pipeline — query rewrite, evidence-sufficiency scoring, citations, retry loop. The 30(32)-agent pipeline (`backend/src/l3Runtime.ts`) has none of that; agents receive prior-agent outputs directly via `ctx.priorOutputs` (in-context, not retrieved) and nothing else.

**3. Target State.** At minimum, agents whose output quality most depends on grounding (candidates: `architecture`, `securityCompliance`, `apiDesign` — not yet decided, see Open Questions) retrieve relevant evidence (prior project artifacts, memory records, possibly external docs) before generating output, with retrieved sources cited in that output the same way the chatbot already does.

**4. Scope.** In: adapting the chatbot's existing RAG pattern for pipeline-agent use — this is significant, but not starting from zero, since a working reference implementation already exists in the same codebase. Out: rebuilding RAG from scratch, and out: doing all 32 agents at once (see Open Questions on rollout sequencing).

**5. Functional Requirements.** Agents in scope retrieve top-K relevant evidence via the similarity search from Item 1, before generating their output; retrieved evidence is cited in the output; agents explicitly note when evidence is insufficient (mirroring the chatbot's evidence-sufficiency scoring) rather than filling gaps with unfounded confidence.

**6. Non-Functional Requirements.** Added latency per agent run must be bounded — a retrieval round-trip per agent, times up to 32 agents in a pipeline run, could meaningfully slow the whole SDLC pipeline if not designed carefully (parallelizable where agents don't have sequential dependencies, which most don't per `PHASE_AGENTS` grouping).

**7. Architecture/Design Approach.** Extract the chatbot's RAG components (`backend/src/chat/`) into a shared module callable from both the chatbot and `l3Runtime.ts`; wire the in-scope agents to call it before their existing prompt-construction step; extend prompt templates to include retrieved context with citation instructions (agent prompt patterns for this already exist informally — see `frontend/src/agents/definitions.ts` lines referencing "retrieval of only relevant evidence" in the `tokenOptimizer`/`aiGovernance` prompt *text*, which describes the concept but doesn't implement it).

**8. Data Model/Schema Changes.** None beyond Item 1's embedding column — this consumes that infrastructure, doesn't add new schema.

**9. API/Interface Changes.** New shared internal retrieval function/module; agent output schema likely needs a `citations`/`sources` field added if one doesn't exist (not yet confirmed).

**10. Dependencies.** Item 1 (pgvector) — hard blocker (Step 2, item #5).

**11. Pre-Implementation Gate.** Risk 1: retrofitting 32 agent prompts is a large surface area — doing all at once risks a large, hard-to-review change. Mitigation: explicitly scope to a pilot subset first (2-3 agents), validate the pattern, then roll out. Risk 2: latency impact on the full pipeline run is unmeasured. Mitigation: benchmark pilot agents' added latency before committing to full rollout.

**12. Security Considerations.** Retrieved evidence must respect the same `project_private`/`domain_shared` dual-filter (ADR-004) already governing memory access — an agent must not retrieve another project's private evidence.

**13. Testing Strategy.** For pilot agents: compare output quality/citation accuracy before and after, on a fixed set of test projects; verify no cross-project data leakage in retrieval results.

**14. Rollout Plan.** Pilot (2-3 agents) → validate latency and quality → expand in batches, not all 32 at once.

**15. Rollback Plan.** Retrieval call is additive to existing prompt construction — can be feature-flagged off per-agent if a rollout causes problems, falling back to current self-reported-confidence behavior.

**16. Monitoring/Observability.** Track retrieval latency, evidence-sufficiency scores, and citation presence per agent run once live.

**17. Documentation Updates Required.** Update Step 1 Section B; update `docs/architecture/agentic-rag-gap-analysis-and-plan.md` (already exists, likely has relevant prior thinking worth reconciling with this spec rather than duplicating).

**18. Acceptance Criteria.** Pilot agents demonstrably cite retrieved evidence in output; a measured (not guessed) latency impact figure exists before wider rollout.

**19. Effort Estimate.** Large — this is the biggest single item in the whole program, spanning infrastructure (Item 1), a shared module extraction, and per-agent prompt/output changes across up to 32 agents even if rolled out in batches.

**20. Open Questions.** Which agents form the pilot subset (needs a judgment call on where grounding matters most)? Does agent output schema need a new `citations` field, or does existing free-text output suffice? Should this reuse `backend/src/chat/`'s code directly or fork the pattern (reuse is cleaner but couples two systems that may want to evolve differently)?

**21. Owner/Sign-off.** Unassigned, awaiting go — and given the scale, awaiting a decision on pilot scope specifically before any code starts.

---

# 3. Eval Scorers Upgrade (Heuristic → LLM-Judge) (P2)

**1. Purpose & Problem Statement.** `tests/eval/scorers.ts` uses heuristic scorers, with in-code comments already acknowledging they need eventual LLM-judge replacement (Step 1, Section E).

**2. Current State.** Heuristic-only; self-documented as a stopgap in the existing code.

**3. Target State.** LLM-judge-based scoring for agent output quality, replacing or supplementing the heuristics.

**4-9.** Standard LLM-as-judge pattern: a judge prompt, rubric, and scoring call added to the eval harness; no data model or API changes beyond the eval tooling itself.

**10. Dependencies.** None structurally (Step 2, item #16), but thematically stronger once Item 2 (RAG grounding) exists, since a judge could then also score citation accuracy, not just output plausibility.

**11. Pre-Implementation Gate.** Risk: LLM-judge scoring has its own reliability questions (judge consistency, cost per eval run) — needs a rubric design pass, not just "call an LLM to score it."

**19. Effort Estimate.** Medium.

**20. Open Questions.** Judge model choice; rubric design; whether to replace heuristics entirely or run both and compare.

**21. Owner/Sign-off.** Unassigned, awaiting go.

---

# 4. User Feedback Capture (P2)

**1. Purpose & Problem Statement.** No mechanism exists to capture user ratings/corrections on agent output (confirmed by grep, zero hits for feedback-capture patterns — Step 1, Section E).

**2-9.** Would need: a UI affordance (thumbs up/down or similar, likely in `frontend/src/components/pipeline/`), a storage table for feedback events, and a link back to the specific agent run being rated.

**10. Dependencies.** None (Step 2, item #18). Thematically grouped with Wave 3 since it's the same "agent output quality" concern, and captured feedback would eventually feed eval/tuning work.

**11. Pre-Implementation Gate.** No blockers — this is a straightforward, self-contained feature. Main design question is scope (per-agent-run rating vs. per-pipeline rating vs. both).

**19. Effort Estimate.** Small to Medium — mostly UI work plus a simple new table.

**20. Open Questions.** Rating granularity (per-agent vs. per-pipeline); whether captured feedback feeds anything automated yet, or is just collected for now.

**21. Owner/Sign-off.** Unassigned, awaiting go.

---

**Next in Step 4:** Wave 2 (data/governance closure — migration tracking for the SECURITY DEFINER fix, RLS per-table review, backup posture decision) and Wave 4 (CI coverage, background worker, integrations, load testing) remain. Continuing next turn without pausing, per instruction — flag if you want me to stop and let you review what exists so far instead.
