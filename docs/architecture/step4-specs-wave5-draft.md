# Step 4 — Component Specs, Wave 5 (Verification & Polish)

**Status:** Draft. Low-urgency items — compressed treatment throughout, consistent with the P3 tier assigned in Step 2. This completes Step 4 across all 5 waves.

---

# 1. Sidebar "Already Run" Status — Screenshot Re-Verification (P3)

**Current state:** Believed fixed earlier this session (per user report and follow-up work), not independently re-verified with a fresh screenshot this program (Step 1, Section A). **Task:** take a current screenshot of a project with reset agents, confirm the sidebar shows idle/not-run state correctly. **Dependencies:** none. **Effort:** trivial. **Owner:** unassigned, awaiting go.

# 2. UI Component Structural Inventory → Real UX Audit (P3)

**Current state:** Structural inventory only exists (42 `.tsx` files, 11 directories — Step 1, Section J), no design-system-consistency or accessibility review. **Task:** scope and schedule a real UX audit as a distinct future body of work — this item itself is just the scoping decision, not the audit. **Dependencies:** none. **Effort:** trivial to scope; the audit itself (out of scope here) would be Medium-Large. **Owner:** unassigned, awaiting go.

# 3. Agent Count Correction Propagation (P3)

**Current state:** Corrected from "30" to the actual **32** in Step 1 (direct count from `frontend/src/agents/definitions.ts`). **Task:** grep the rest of the docs tree (`docs/`, `ARCHITECTURE.md`, any other planning docs) for stale "30 agents"/"30-agent" references and update them to 32, so the correction doesn't silently fail to propagate. **Dependencies:** none. **Effort:** trivial — a grep and a handful of edits. **Owner:** unassigned, awaiting go.

---

## Step 4 — completion note

All 5 waves now have specs: Wave 1 (`step4-specs-wave1-draft.md`), Wave 2 (`step4-specs-wave2-draft.md`), Wave 3 (`step4-specs-wave3-draft.md`), Wave 4 (`step4-specs-wave4-draft.md`), Wave 5 (this file). Every item from Step 2's dependency table now has a corresponding spec. Nothing has been implemented — every item is marked "unassigned, awaiting go" per Process Rule 3.

**Next in the program:** Step 5 onward (sprint roadmap, prioritization matrix, RAID risk register, NFRs, testing strategy, security/governance gates, production readiness checklist, enterprise-ready definition, executive roadmap) per the original 20-step structure.
