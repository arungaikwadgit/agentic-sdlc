# Step 2 — Dependency Map, Criticality (P0-P3), Critical Path

**Status:** Draft, held for review — same rules as Step 1 (Process Rules 1-4 in the program plan doc apply here too). Built directly from the ~45 rows across 10 categories in `step1-baseline-matrix-draft.md`; nothing here introduces a new factual claim about the codebase, only sequencing and priority judgments on top of Step 1's evidence.

**Verification note on this pass:** before writing this, I re-checked the one open item from Step 1's "does this session's fix actually work" thread — `artistic-charm`'s redeployment (`d83dc303`, 2026-08-22T02:29 UTC) is confirmed **SUCCESS** and serving real traffic (200-status responses to `/api/projects`, `/permissions/me` observed directly in deploy logs). Step 1's Section C row for the Project/Admin API should be upgraded from 🟡 to 🟢 accordingly — noted here, not yet edited back into that file to avoid rewriting an already-reviewed document without your sign-off.

**New, minor finding surfaced by that same log check:** the live `artistic-charm` service logs an `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warning from `express-rate-limit` on every request — Railway's proxy sends `X-Forwarded-For` but Express's `trust proxy` setting isn't configured to match, so rate-limiting may not be keying on the real client IP. Not currently breaking anything (requests still return 200), so it's scored P2 below, not P0/P1.

---

## 1. Method

**Criticality definitions** (used consistently across every item below):

- **P0** — blocks trustworthy work elsewhere; a spec, fix, or claim built on top of this item would itself be unreliable. Must move first or in parallel with nothing ahead of it.
- **P1** — high-value, not a hard blocker, but touches multiple downstream areas or represents a materially incomplete capability (RAG grounding, test coverage gaps).
- **P2** — real, scoped, contained impact. Normal backlog priority.
- **P3** — low urgency, verification/polish, no material risk if deferred.

**Dependency direction:** "Depends on" = must be true/fixed first. "Blocks" = what can't be trusted or built until this item is resolved.

---

## 2. Dependency & Criticality Table

| # | Item (Step 1 ref) | Criticality | Depends on | Blocks |
|---|---|---|---|---|
| 1 | Migration files vs. live schema (F1) | **P0** | Nothing — can start immediately | Trustworthy specs for any DB-touching component; new-environment/disaster-recovery confidence; proper tracking of the SECURITY DEFINER view fix (#11); accurate future migration numbering |
| 2 | Server-side RBAC re-verification (G3) | **P0** | Nothing — can start immediately (read the `server/src` route handlers) | Any claim that RBAC is fully enforced; security/compliance-facing statements in later steps |
| 3 | `server/` deploy pipeline | **Done this session** | — | Was blocking #4, #16, #17 below (nothing server-side could be trusted as "currently live") — now unblocked, confirmed live 2026-08-22 |
| 4 | Vector search / embeddings (pgvector) (B4) | **P1** | Nothing technical — deliberate roadmap deferral, needs a scheduling decision, not a code fix | #5 (RAG grounding), memory architecture v2 (B3) |
| 5 | RAG grounding for the 32 pipeline agents (B2) | **P1** | #4 | Any future claim about agent output quality/trustworthiness; is the largest capability gap in the whole platform per Step 1 |
| 6 | Server test runner missing, 140 dead files (E3) | **P1** | Nothing — could be a one-line `package.json` fix or a real "these were abandoned" decision | Server-side coverage entirely (#7); confidence in any `server/` change going forward |
| 7 | CI coverage gap, backend + server (C8) | **P1** | #6 for the server half; backend half is independent and could be added now | The 90%+ coverage NFR mentioned in the original program scope — currently unenforceable for 2 of 3 backend codebases |
| 8 | Background lifecycle worker off in prod (C4) | **P1** | A decision: turn it on, or formally scope it out | Async Token Optimizer / AI Governance runs (#15) |
| 9 | Leaked-password protection disabled (D4) | **P2** | Nothing — single Supabase Auth setting | Nothing downstream — contained, quick win |
| 10 | Two SECURITY DEFINER views + mutable search_path (D5) | **P2** | Nothing to fix the setting; #1 to properly *track* the fix afterward | Nothing downstream if fixed directly; proper tracking depends on #1 |
| 11 | Dead code in `invites.ts` (D3) | **P2** | Nothing | Nothing — noise reduction only |
| 12 | Supabase backup/PITR posture (C5) | **P2** | A business decision (upgrade plan tier or accept the risk) | Any "enterprise-grade" backup/DR claim in later steps |
| 13 | RLS policy per-table deliberate review (F2) | **P2** | Nothing | Nothing urgent — refines an already-accurate picture |
| 14 | Integration credential storage duplication (H2) | **P2** | Resolved 2026-08-22 (commit `404a5d2a`) — client-side crypto deleted, server-side `integrationCredentialCrypto.js` is now the only system | Done — see execution-status-2026-08-23.md |
| 15 | Integration provider scoping (H1) | **P2** | #14 resolved 2026-08-22 — clean picture available. Scoped 2026-08-27: GitHub + Jira fully wired, Confluence/GitLab/Slack are placeholders (type-union entry only, no route, no UI) | Done — see execution-status-2026-08-27.md |
| 16 | Eval scorers still heuristic (E4) | **P2** | Nothing structural | Confidence in any "agent output quality" claim |
| 17 | Load/performance testing minimal (E5) | **P2** | Nothing | Any production-scale capacity claim |
| 18 | User feedback capture absent (E6) | **P2** | Nothing | Any "agents improve from feedback" future claim |
| 19 | `express-rate-limit` trust-proxy misconfiguration (new, found this pass) | **P2** | Nothing | Rate limiting may not key on real client IP behind Railway's proxy — not urgent, not broken |
| 20 | Sidebar "already run" status re-verification (A6) | **P3** | Nothing — just take a screenshot | Nothing |
| 21 | UI component structural inventory (J1) | **P3 / informational** | — | — |
| 22 | Agent count correction, 30→32 (J2) | **P3 / informational** | — | — |

Items already 🟢 in Step 1 with no open gap (pipeline ordering, both gate fixes, team-assignment skip, chatbot RAG, role model, credential encryption, RLS on the core tables, frontend CI coverage) are not repeated here — they have nothing to sequence.

## 3. Circular dependency check

None found. Every "depends on" in the table above resolves to either "nothing" (can start immediately) or a single upstream item, with no item appearing in its own dependency chain. This is worth stating plainly per Process Rule 2 — a genuine negative result, not an oversight.

## 4. Critical path

The sequence that gates the most downstream work, in order:

1. **#1 (migration files) and #2 (server-side RBAC check) in parallel** — both are P0, both are pure investigation/reconstruction with no dependencies, both unblock trust in everything else. Neither blocks the other.
2. **#6 (server test runner)** — cheap to diagnose (is it a missing `package.json` line or an abandoned effort?), unblocks #7.
3. **#4 (vector search decision) → #5 (RAG grounding)** — the single largest capability investment in this list; sequencing it early means later component specs (Step 6 onward) can assume a real answer instead of building around a placeholder.
4. **#8 (background worker decision)** — independent of the above, can run in parallel with #3-#5.
5. **P2 quick wins (#9, #10, #11, #19)** — no dependencies, cheap, can be scheduled any time in parallel with the above rather than waiting in line.
6. **P2 investigation items (#12, #13, #14→#15, #16, #17, #18)** — normal backlog, no urgency to front-load. #12–#15 done as of 2026-08-27 (see execution-status-2026-08-2{6,7}.md).
7. **P3 items (#20, #21, #22)** — whenever convenient.

## 5. What this feeds into

Step 3 (per the program's original structure) synthesizes this into implementation waves. The P0 pair (#1, #2) and the #4→#5 chain should anchor Wave 1 — everything else can be organized around them rather than a flat priority list.

---

**Approval needed to proceed:** review this sequencing before Step 3 (wave planning) begins, per Process Rule 3.
