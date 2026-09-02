# Step 6 — Prioritization Matrix

**Status:** Draft, held for review — Process Rules 1-4 apply. This is planning, not execution: nothing here is authorized to start until you give an explicit go, per Process Rule 3.

**Source:** re-scores the 22 items from `step2-dependency-criticality-draft.md` now that Wave 1 has closed 7 of them (6 done, 1 accepted risk — see the program plan's Verification Ledger #7). This step adds a **business value** lens on top of Step 2's **technical criticality/dependency** lens, since criticality alone doesn't tell you what to do first when several P2s are all technically unblocked at once.

---

## 1. What's already closed (not re-scored below)

| Item | Outcome |
|---|---|
| Migration file reconstruction | Done, verified live |
| Server-side RBAC re-verification | Done — no gap found |
| `server/` deploy pipeline | Done (prior session) |
| Server test runner | Done — scaffolded + first real suite |
| SECURITY DEFINER + mutable search_path | Done, verified live |
| Dead code (`invites.ts`) | Done |
| `express-rate-limit` trust-proxy | Done |
| Leaked-password protection | **Accepted risk** — Supabase Free plan doesn't support it; revisit only if/when the org upgrades to Pro |

8 of 22 items are off the board. 14 remain, scored below.

---

## 2. Method

**Value axis** — how much this item moves the platform toward "enterprise-ready" as originally scoped, or how much downstream trust/capability it unlocks:
- **High** — closes a stated capability gap (RAG grounding) or a compliance-relevant control (backup/DR posture)
- **Medium** — real improvement, contained blast radius
- **Low** — polish, informational, or narrow-scope cleanup

**Effort/Risk axis** — engineering effort combined with blast radius if done carelessly:
- **High** — multi-component, needs a real design decision, or touches production data/behavior broadly
- **Medium** — contained but non-trivial (a few files, a schema change, a vendor decision)
- **Low** — a few hours, narrow surface, easy to verify

This is a judgment call on my part, same as Step 2's criticality scoring — flagged as such, not presented as measured fact.

---

## 3. Matrix

| Item (Step 2 ref) | Value | Effort/Risk | Quadrant |
|---|---|---|---|
| Vector search / embeddings (pgvector) (#4) | High | Medium | **Do next** |
| RAG grounding for 32 pipeline agents (#5) | High | High | **Do next** (biggest single item — needs #4 first) |
| Background lifecycle worker decision (#8) | Medium | Low | **Quick win** |
| RLS policy per-table review (#13) | Medium | Medium | **Do next** |
| Supabase backup/PITR posture decision (#12) | High | Low (it's a decision, not code) | **Quick win** |
| CI coverage gap, backend + server (#7) | Medium | Medium | **Do next** |
| Integration credential storage duplication (#14) | Medium | Low | **Done** (2026-08-22, commit `404a5d2a`) |
| Integration provider scoping (#15) | Low | Medium | **Done** (2026-08-27) — GitHub + Jira wired, Confluence/GitLab/Slack are placeholders |
| Eval scorers, heuristic → LLM-judge (#16) | Medium | Medium | **Scoped, deferred** (2026-08-27) — judge model (gpt-4o), replace-vs-both (both), and pilot scope (Token Optimizer) decided; build not started, kept in backlog |
| Load/performance testing expansion (#17) | Medium | Medium | **Do next** |
| User feedback capture (#18) | Low | Low | **Quick win** |
| Sidebar "already run" status re-check (#20) | Low | Low | **Quick win** |
| UI component structural inventory (#21) | Low | Medium | **Later** |
| Agent count correction, 30→32 (#22) | Low | Low | **Quick win** |

---

## 4. Reading the matrix into a recommendation

**Quick wins first (low effort regardless of value)** — these are cheap enough that sequencing barely matters, so front-load them for momentum and to shrink the backlog fast: background worker decision (#8), backup/PITR decision (#12), integration credential duplication (#14), feedback capture (#18), sidebar re-check (#20), agent count fix (#22). None of these need a design meeting — #8 and #12 are yes/no decisions, the rest are a few hours each. (#12 done 2026-08-26, #14 done 2026-08-22.)

**The one big bet** — pgvector (#4) → RAG grounding (#5) is the highest-value, highest-effort pair in the whole program, and it's also the item most likely to slip a schedule (already flagged as the biggest sprint risk in Step 5). Recommend starting #4 in parallel with the quick wins above, not after them, since it's on the critical path for #5 and nothing else here blocks it.

**Everything else (#7, #13, #16, #17)** — solid Medium/Medium items, no reason to front-load or defer specifically; slot them around the two tracks above based on team capacity.

**Genuinely low priority (#21)** — fine to defer to whenever capacity opens up; doesn't block anything else and has no user-facing urgency. (#15 done 2026-08-27 — see the row above.)

---

## 5. What this changes about Wave 2 (Step 3)

Step 3's original Wave 2 included "retroactively create the missing migration file for the SECURITY DEFINER view fix" — that's now **moot**: Wave 1's migration reconstruction (item 1) already wrote `021_agent_token_usage_view.sql` capturing the fixed (`security_invoker = true`) end-state directly, so there's no separate retroactive-tracking task left. Wave 2 shrinks to: RLS per-table review (#13) and the backup/PITR decision (#12) — both already scored above.

---

**Approval needed to proceed:** confirm this scoring (or reorder it) before Step 7 (RAID risk register) begins, per Process Rule 3. No item above is authorized to start implementation from this document alone.
