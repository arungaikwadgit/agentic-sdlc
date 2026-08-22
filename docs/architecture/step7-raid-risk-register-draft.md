# Step 7 — RAID Risk Register (Risks, Assumptions, Issues, Dependencies)

**Status:** Draft, held for review — Process Rules 1-4 apply. Planning artifact; nothing here authorizes further implementation on its own.

**Source:** synthesizes everything found across Steps 1-6 and the Wave 1 execution (2026-08-22) into the four RAID categories, plus a few items that only became visible *because* of this session's live work (the Vercel/GitHub authorship block, the force-push, Vercel MCP access gap). Each entry is cited to where it was found.

---

## 1. Risks (things that could go wrong)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | RAG grounding (Step 6 #5) is the single largest, longest-running item in the program and already flagged twice (Step 5 sprint roadmap, Step 6) as the biggest schedule risk — effort could balloon once real retrieval-quality work starts | High | High | Scope the pilot to 2-3 agents before the full 32-agent rollout, per the Wave 3 spec's own framing (`step4-specs-wave3-draft.md`) — don't let pilot scope creep to "do it everywhere" |
| R2 | Server/ test suite (Wave 1 item 3) has never actually been executed in this session — scaffolded and reviewed for correctness, but sandbox I/O limits blocked a real `npm test` run here | Medium | Medium | You confirmed a local pass already; still worth a CI run on the next push to catch any environment-specific gap the sandbox review couldn't |
| R3 | This session force-pushed rewritten history on `main` (`git push --force-with-lease`) to fix commit authorship | Low (already done, low ongoing risk) | Medium if it recurs carelessly | Confirmed safe this time (solo repo, no other branches based on the rewritten commits) — but flag as a pattern to avoid repeating without the same safety check (content-diff against origin first) |
| R4 | Backend/server coverage has **zero CI enforcement today** (Step 1 Ledger #3) — any future regression in `server/` or `backend/` ships without a coverage gate catching it | Medium | Medium | Covered by Step 6 item #7 (CI coverage gap) — not yet started |
| R5 | pgvector/RAG work (R1) depends on an embedding-model choice that Step 4's Wave 3 spec explicitly did **not** authorize — if someone picks a model ad hoc mid-implementation, it bypasses the deliberate decision point that spec called for | Medium | Medium | Surface the model choice as its own explicit decision point before Step 6 #4 starts, not inside the implementation PR |
| R6 | The stashed 2026-07-29–08-06 WIP (new repository classes, auth/security tests, two migrations, a `deploy/railway/` directory) has sat untouched since it was stashed — the longer it sits, the more it'll conflict with work landing on `main` in the meantime (including this session's own changes) | Medium, growing over time | Medium | Needs a dedicated triage pass: inspect, decide keep/rework/discard, before it becomes unmergeable |

---

## 2. Assumptions (taken as true, not fully verified)

| # | Assumption | Basis | What happens if wrong |
|---|---|---|---|
| A1 | The 9 reconstructed migration files (Wave 1 item 1) match what was *originally* applied, not just the current live end-state | Explicitly scoped this way per the Step 4 spec ("match live end-state, not historical archaeology") — a deliberate choice, not an oversight | Low impact even if wrong: the goal was reproducibility for fresh environments, which is satisfied regardless of historical fidelity |
| A2 | `arungaikwadgit <arun.gaikwad@outlook.com>` is the correct, permanent GitHub-verified identity for future commits in this repo | Inferred from matching every pre-existing commit's author field | If this ever changes (e.g., GitHub account email update), the same Vercel block will recur — worth remembering the cause, not just the fix |
| A3 | This is a solo-maintainer repo (no other collaborators with local clones of `main`) | Inferred from the Vercel Hobby-plan error message itself ("does not support collaboration for private repositories") and no evidence of other contributors in commit history | If wrong, the earlier force-push could have silently discarded someone else's work — worth confirming explicitly if the team grows |
| A4 | Supabase staying on the Free plan is an acceptable tradeoff for now (leaked-password protection, backup/PITR both gated behind Pro) | Your "known risk" acknowledgment this session | If production data value/compliance requirements increase, this assumption should be revisited, not left as a standing default |
| A5 | The two intentional no-op migrations (010, 018 — see Wave 1 item 1) truly correspond to features that were either never built or built without dedicated schema | Exhaustive search of live schema + application code found nothing; documented as absence-of-evidence | If a "voice" or "signed decision" feature does exist somewhere unexamined (e.g., a Supabase Edge Function not in this repo), the assumption breaks — worth a quick check if either feature name comes up again |

---

## 3. Issues (already true, currently unresolved)

| # | Issue | Status | Owner/next action |
|---|---|---|---|
| I1 | Leaked-password protection cannot be enabled — Supabase Free plan doesn't support it | **Accepted risk** (this session, per your "known risk" call) | Revisit if/when Supabase org upgrades to Pro |
| I2 | ~24 tables have RLS enabled with zero attached policies — all access control is enforced in application code only, zero DB-layer defense-in-depth | Open, tracked as Step 6 item #13 (RLS per-table review) | Not started |
| I3 | Vercel MCP connector in this session has no visibility into the actual `agentic-sdlc` Vercel project (confirmed 404 on both known deployment domains, despite matching team slug) | Open — discovered this session while verifying deployment status | You confirmed Vercel is ready by checking the dashboard directly; the MCP access gap itself is still unresolved and will block me from verifying Vercel deployments in future sessions unless reconnected with correct project scope |
| I4 | Backend/server coverage has zero CI enforcement (see R4) | Open, tracked as Step 6 item #7 | Not started |
| I5 | Stashed 2026-07-29–08-06 WIP never inspected (see R6) | Open, flagged repeatedly since Step 1, still untriaged | Not started |
| I6 | Backup/PITR posture on Supabase Free tier — no point-in-time recovery available | Open, tracked as Step 6 item #12 (framed as a business decision, not a code fix) | Not started |

---

## 4. Dependencies (external factors this program relies on)

| # | Dependency | What relies on it | Health |
|---|---|---|---|
| D1 | Railway (2 services, 2 projects) | All backend/server production hosting | Healthy — both services confirmed SUCCESS at latest commit this session |
| D2 | Vercel (Hobby plan) | Frontend hosting | Healthy per your confirmation; Hobby plan's collaboration restriction (I3's root cause) is a standing constraint worth remembering for any future contributor |
| D3 | Supabase (Free plan) | All production data, auth | Functional but capped — leaked-password protection (I1) and backup/PITR (I6) both gated behind Pro |
| D4 | GitHub (`arungaikwadgit/agentic-sdlc`) | Source of truth, CI trigger, Vercel/Railway deploy trigger | Healthy — push access confirmed working via manual handoff this session (native GitHub connector still unavailable in this session type) |
| D5 | HaveIBeenPwned.org (via Supabase Auth) | Leaked-password protection specifically | Not currently in use (I1) |
| D6 | Embedding model / vector provider (not yet chosen) | Step 6 item #4 (pgvector) and everything downstream of it (#5 RAG grounding) | Not yet selected — see R5 |

---

## 5. What this feeds into

Step 8 onward (NFRs, testing strategy, security/governance gates) should treat I1-I6 as known starting conditions, not surprises to rediscover. R1/R5 should directly shape how the pgvector/RAG work gets scoped once it starts.

---

**Approval needed to proceed:** confirm this register (or add anything missed) before Step 8 (NFRs) begins, per Process Rule 3.
