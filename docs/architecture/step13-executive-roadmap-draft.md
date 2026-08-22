# Step 13 — Executive Roadmap

**Status:** Draft, held for review per your standing approval (planning-only) — Process Rule 3 applies to any implementation. Written for a non-technical/leadership audience — technical detail lives in Steps 1-12.

---

## Where things stand

This program started by finding real, previously-invisible gaps: a production service that had silently stopped deploying for two weeks, a database migration history with 9 missing files, and a security finding (SECURITY DEFINER views) that could have exposed cross-project data through an admin-only dashboard view. All three are now fixed and verified live — not just planned.

**What's done:** the foundational trust layer (deployment pipeline, migration history, core security fixes, dead code cleanup) is complete and verified. 6 of 7 "Wave 1" items closed; the 7th (leaked-password protection) is a known, accepted limitation of the current database plan tier, not an open task.

**What's ahead:** the platform's single biggest remaining investment is making its 32 AI agents ground their output in real evidence instead of self-reported confidence — currently the largest capability gap found in this program. Everything else remaining is smaller, well-scoped work: closing a test-coverage gap, reconciling a duplicated credential-storage system, and a handful of quick decisions (turn on a background worker, decide on database backup tier, etc.) that take minutes to decide but were sitting unresolved.

## Sequencing (ordinal, not calendar-dated — see Step 5 for why)

1. **Now-ish:** the quick decisions and quick wins (Step 6 §4) — none need more than a few hours or a single yes/no call
2. **Next, in parallel with #1:** start the vector-search/RAG-grounding work (Step 6's single biggest bet)
3. **Alongside both:** close the test-coverage gap incrementally (Step 9's ratchet plan, not a disruptive hard cutover)

## Decisions that need you specifically, not engineering time

- **Supabase plan tier:** staying on Free means accepting no backup/PITR and no leaked-password protection indefinitely. Both are one decision (upgrade to Pro), not two.
- **Compliance target:** is there a framework (SOC 2, GDPR, etc.) this platform needs to meet? Nothing in this program's findings points to one being defined yet — worth settling before the security/governance work gets sequenced in detail.
- **Embedding model choice for RAG:** deliberately left unresolved through this entire program (per the original Wave 3 spec) — needs a real decision before implementation starts, not picked ad hoc mid-build.

## Risk headline

The RAG-grounding work is the one item in this whole program most likely to run over — flagged as the top schedule risk since Step 5, still true today. Everything else is well-scoped enough that its size is known.

---

**This closes the planning phase of the program (Steps 1-13).** Remaining scope from the original request — deeper component-level specs for items beyond Wave 1, and ongoing execution — continues from here as implementation work, gated the same way Wave 1 was: explicit go-ahead per item, evidence before every completion claim.
