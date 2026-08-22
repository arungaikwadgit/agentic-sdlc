# Step 5 — Sprint Roadmap

**Status:** Draft. Same rules as prior steps: planning only.

**A real limitation, flagged rather than guessed around:** a genuine sprint roadmap needs team size, sprint length, and velocity — none of that has been established anywhere in this program. Rather than invent a team size or fabricate calendar dates, this roadmap is **ordinal** (Sprint 1, Sprint 2, Sprint 3, Sprint 4+) and driven by dependency order + relative effort from Step 4's specs, not real capacity. Converting this to actual calendar dates needs one input from you: team size and sprint length (1-week vs. 2-week). Until then, treat "Sprint N" as "the Nth batch of work in dependency order," not a real date range.

**Effort key** (from Step 4's specs): Trivial (hours) · Small (part of a sprint) · Small-Medium · Medium (most of a sprint for one person) · Large (multiple sprints or multiple people).

---

## Sprint 1 — Foundation (two parallel tracks, no shared dependency)

**Track A — Data/Security (P0 focus):**
- Migration file reconstruction (P0, Medium)
- Server-side RBAC re-verification (P0, Small)
- Server test runner fix (P1, Small-Medium)
- 4 P2 quick wins: leaked-password protection, SECURITY DEFINER views/search_path, dead code removal, rate-limit trust-proxy config (all Trivial — fill capacity around the larger items)

**Track B — RAG Infrastructure (independent, can start day 1):**
- pgvector installation (P1, Medium) — the long pole for Wave 3, worth starting immediately rather than waiting

**Sprint 1 exit criteria:** migration history reconciled; RBAC enforcement point confirmed; 4 quick wins closed; pgvector installed and a basic similarity query verified working.

## Sprint 2 — Governance Closure + RAG Pilot Prep

**Track A (gated on Sprint 1's migration reconstruction):**
- Migration tracking for the SECURITY DEFINER fix (P2, Small)
- RLS policy per-table review (P2, Small-Medium)
- Supabase backup/PITR decision (P2, Trivial — but needs your input, not engineering time)
- CI coverage gap fix, backend half (P1, Small — independent, can also start Sprint 1 if capacity allows)
- Background lifecycle worker decision (P1, Small, after a code-read of `backend/src/lifecycle/`)

**Track B (gated on Sprint 1's pgvector):**
- RAG grounding pilot scoping — choosing the 2-3 pilot agents, extracting the chatbot's RAG pattern into a shared module (P1, start of a Large item)

**Sprint 2 exit criteria:** migration numbering fully reconciled and tracked; RLS coverage decision documented per table; backup posture decided; backend CI coverage visible; background worker's fate decided; RAG pilot scope chosen and shared module extraction started.

## Sprint 3 — RAG Pilot Execution + Remaining Platform Items

**Track A:**
- RAG grounding pilot implementation and validation (P1, continuing the Large item from Sprint 2)

**Track B:**
- CI coverage gap fix, server half (P1, Small — gated on Sprint 1's test-runner fix)
- Integration credential storage investigation → provider scoping (P2, Small-Medium)

**Sprint 3 exit criteria:** pilot agents demonstrably grounding output with citations; measured latency impact known; server-side CI coverage visible; integration credential story understood and documented.

## Sprint 4+ — RAG Rollout + Quality Tooling + Polish

- RAG grounding wider rollout, batch by batch, informed by Sprint 3's pilot results (P1, remainder of the Large item — pace depends entirely on pilot findings, not predictable from here)
- Eval scorers upgrade to LLM-judge (P2, Medium)
- User feedback capture (P2, Small-Medium)
- Load/performance testing expansion (P2, Small-Medium — needs real/projected usage numbers as an input, flagged in Step 4)
- Wave 5 polish: sidebar screenshot check, UX audit scoping, agent-count doc propagation (all P3, Trivial — fill capacity anytime)

**Sprint 4+ exit criteria:** full RAG rollout complete or a deliberate stopping point chosen; eval tooling upgraded; feedback capture live; load testing reflects realistic scenarios; all P3 items closed.

---

## What determines how many calendar sprints this actually takes

Two unknowns this roadmap can't resolve on its own:
1. **Team size and sprint length** — directly determines whether "Sprint 1" is one week or two, and whether Tracks A/B run with the same people sequentially or different people in parallel.
2. **RAG pilot results** — the single biggest schedule risk. If the pilot's latency/quality findings are good, wider rollout is mostly mechanical repetition. If they're not, Sprint 4+ could expand significantly, and that's better to know from a real pilot than to estimate away.

---

**Approval needed to proceed:** confirm team size/sprint length if you want this converted to real dates; otherwise this ordinal structure is treated as the roadmap going into Step 6 (prioritization matrix).
