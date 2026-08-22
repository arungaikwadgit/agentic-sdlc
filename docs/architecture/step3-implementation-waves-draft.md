# Step 3 — Implementation Waves

**Status:** Draft, held for review — Process Rules 1-4 apply. This is still planning, not execution: no wave in this document is authorized to begin until you give an explicit go per Process Rule 3, wave by wave (or item by item, your call).

**Source:** groups the 22 items from `step2-dependency-criticality-draft.md` by theme and dependency-readiness, not just raw priority order — most items have zero technical dependencies, so a flat priority list alone wouldn't produce a coherent execution grouping. Waves are ordered so nothing in a later wave is needed to start an earlier one.

---

## Wave 1 — Foundation & Quick Security Wins

**Can start immediately — every item here has zero technical dependencies.**

| Item | Criticality | Why it's here |
|---|---|---|
| Migration file reconstruction (recover/recreate `010`, `016`-`023`) | P0 | Anchors trust in every DB-touching claim for the rest of the program |
| Server-side RBAC re-verification | P0 | Anchors trust in every security claim for the rest of the program |
| Server test runner fix (140 dead test files) | P1 | Cheap to diagnose, unblocks Wave 4's CI coverage item |
| Leaked-password protection (Supabase Auth setting) | P2 | One setting, zero risk, no reason to wait |
| SECURITY DEFINER views + mutable search_path fix | P2 | Contained DB fix, zero risk, no reason to wait |
| Dead code removal (`server/src/routes/invites.ts`) | P2 | Noise reduction, zero risk |
| `express-rate-limit` trust-proxy config | P2 | One-line Express config, zero risk |

**Exit criteria:** migration history reconciled and documented; RBAC enforcement point (frontend-only vs. frontend+server) explicitly confirmed one way or the other; the four quick wins closed or explicitly deferred with a reason.

## Wave 2 — Data & Governance Closure

**Starts once Wave 1's migration reconstruction is done — everything here needs a trustworthy migration history to build on.**

| Item | Criticality | Why it's here |
|---|---|---|
| Retroactively create the missing migration file for the SECURITY DEFINER view fix (proper tracking, not just the live fix from Wave 1) | P2 | Directly depends on Wave 1's reconstruction establishing the correct next migration number |
| RLS policy per-table deliberate review | P2 | Natural follow-on once migration/schema history is trustworthy — reviewing policy coverage against a moving/unclear baseline isn't productive |
| Supabase backup/PITR posture decision | P2 | Business decision (upgrade tier vs. accept risk), no technical blocker, grouped here because it's the same "data governance" conversation |

**Exit criteria:** migration numbering is continuous and matches production again; RLS coverage decision documented per table (intentional vs. needs a policy); backup posture is an explicit decision, not a default.

## Wave 3 — RAG & Agent Output Quality

**The largest single investment in the program. Can start in parallel with Wave 1 (no shared dependency), but sequenced third here because it's a bigger, longer-running body of work than the quick wins in Waves 1-2.**

| Item | Criticality | Why it's here |
|---|---|---|
| Vector search / embeddings (pgvector) installation | P1 | Foundational — nothing else in this wave can start without it |
| RAG grounding for the 32 pipeline agents | P1 | The largest capability gap found in the whole program; depends on the item above |
| Eval scorers upgrade (heuristic → LLM-judge) | P2 | Thematically bound to agent output quality; benefits from RAG grounding existing first but isn't strictly blocked by it |
| User feedback capture (thumbs/rating on agent output) | P2 | Same theme — without this, there's no data to eventually train/tune quality against |

**Exit criteria:** pgvector installed and at least one agent demonstrably grounds output in retrieved evidence rather than self-reported confidence; a decision made on eval scorer replacement approach; feedback capture mechanism at least scoped, if not built.

## Wave 4 — Platform Hardening & Integrations

**Can start in parallel with Wave 3 — independent theme, only internal dependency is on Wave 1's test-runner fix.**

| Item | Criticality | Why it's here |
|---|---|---|
| CI coverage gap fix (backend + server) | P1 | Server half depends on Wave 1's test-runner fix; backend half is independent and can start immediately |
| Background lifecycle worker decision (turn on vs. formally scope out) | P1 | Independent decision, grouped here as general platform hardening |
| Integration credential storage duplication investigation → provider scoping | P2 | Two-step chain, contained to the integrations subsystem |
| Load/performance testing expansion | P2 | Platform hardening theme |

**Exit criteria:** coverage enforced in CI for all three backend-side codebases (or an explicit documented exception); background worker's fate decided and implemented; integration credential story is either unified or the two-system split is documented as intentional; load testing reflects a more realistic scenario than 10 VUs.

## Wave 5 — Verification & Polish

**Low urgency, no dependencies, no reason to prioritize ahead of anything above. Can be picked up opportunistically.**

| Item | Criticality | Why it's here |
|---|---|---|
| Sidebar "already run" status — screenshot re-verification | P3 | Just needs a screenshot, already believed fixed |
| UI component structural inventory → real UX audit | P3 | Informational baseline exists; a real audit is future scope, not urgent |
| Agent count correction (30→32) propagated to other docs | P3 | Bookkeeping |

---

## Sequencing summary

Waves 1, 3, and 4 can all start in parallel — they don't share prerequisites with each other. Wave 2 waits on Wave 1's first item. Wave 5 has no urgency and can be interleaved anytime. This is a **wave** plan, not yet a sprint plan — effort estimation and team capacity (Step 8 in the original program structure) will turn these into an actual sprint-by-sprint schedule.

---

**Approval needed to proceed:** confirm this wave grouping (or reorder it) before Step 4 (full 21-section specs, wave by wave) begins. Per Process Rule 3, no wave starts implementation without a separate, explicit go.
