# Step 4 — Component Specs, Wave 2 (Data & Governance Closure)

**Status:** Draft, continuing Step 4. Same rules as Waves 1/3: planning only, no implementation authorized.

---

# 1. Migration Tracking for the SECURITY DEFINER View Fix (P2)

**1. Purpose & Problem Statement.** Wave 1 fixes the two SECURITY DEFINER views/search_path issue directly against live Supabase. This item is the follow-on: recording that fix as a proper migration file so it doesn't become another entry in Step 1's "migration files vs. live schema" gap (Section F).

**2. Current State.** Depends entirely on Wave 1's migration-reconstruction item landing first — the correct next migration number can't be assigned until the 9 missing files (`010`, `016`-`023`) are reconstructed and the true next number is known.

**3. Target State.** A new migration file exists, correctly numbered, whose `UP` matches exactly what Wave 1 ran directly against Supabase, and `pgmigrations` on production reflects it as run (likely needs to be manually inserted into that tracking table to match, since the change already happened outside the migration tool — a `node-pg-migrate` nuance worth confirming before assuming automatic reconciliation).

**4-9.** Standard migration-file mechanics — no new architecture beyond writing correct SQL matching an already-applied change.

**10. Dependencies.** Wave 1's migration reconstruction (item 1) — hard blocker, this can't start correctly before that lands (Step 2, item #10's "depends on #1" note).

**11. Pre-Implementation Gate.** Risk: if this migration file is written before the reconstruction work settles the correct numbering, it could collide with one of the 9 recovered files. Mitigation: sequence strictly after Wave 1's item 1 closes, not in parallel.

**19. Effort Estimate.** Small, once unblocked.

**20. Open Questions.** Whether `pgmigrations` needs a manual insert to mark this as "already run" or whether it can be run normally against production without re-applying (since the schema state already matches) — needs a quick check of `node-pg-migrate`'s behavior here (it typically errors if a migration's `UP` conflicts with existing state, e.g. `CREATE VIEW` on a view that already exists, unless written idempotently with `CREATE OR REPLACE VIEW`).

**21. Owner/Sign-off.** Unassigned, awaiting go.

---

# 2. RLS Policy Per-Table Deliberate Review (P2)

**1. Purpose & Problem Statement.** Step 1 (Section F) found a precise, accurate picture of RLS policy coverage: `projects`/`team_members` have 4 real policies each, 6 tables have 1 each, 26 of 34 have zero (deny-by-default). This item is deciding, table by table, whether "zero policies" is intentional (service-role-only, correct) or an oversight (should have app-facing policies but doesn't).

**2. Current State.** The precise counts exist (Step 1); the *intent* behind each zero-policy table has not been reviewed.

**3. Target State.** Each of the 26 zero-policy tables has an explicit, documented classification: "intentionally service-role-only" or "needs a policy, gap identified."

**4-9.** Not applicable — this is a review/classification task, not a build task. Any tables reclassified as "needs a policy" would spin off their own follow-on spec.

**10. Dependencies.** Benefits from, but doesn't strictly require, Wave 1's migration reconstruction landing first (a trustworthy migration history makes this review more meaningful, per Step 3's Wave 2 framing) — soft dependency, not a hard blocker.

**11. Pre-Implementation Gate.** No risk in the review itself. Risk sits downstream: if a table turns out to need a policy and doesn't have one, that's a real gap that would need prioritizing separately, not silently deferred because "the review is done."

**19. Effort Estimate.** Small-Medium — 26 tables to classify, most likely quick (governance/audit tables are probably correctly service-role-only) but each needs an actual look, not a rubber stamp.

**20. Open Questions.** None structural — this is investigation.

**21. Owner/Sign-off.** Unassigned, awaiting go.

---

# 3. Supabase Backup / PITR Posture Decision (P2)

**1. Purpose & Problem Statement.** Supabase is on the free tier (Step 1, Section C) — no point-in-time recovery. This is a business decision (upgrade tier vs. accept the risk), not a technical task.

**2. Current State.** Free tier, no PITR, confirmed via `get_organization`.

**3. Target State.** An explicit, documented decision: either upgrade to a paid tier with PITR, or formally accept the current backup posture as sufficient (e.g. if the `_claude_backup_2026_08_07`-style manual-snapshot pattern from earlier this session is deemed adequate for now).

**4-9.** Not applicable — this is a decision, not a build.

**10. Dependencies.** None.

**11. Pre-Implementation Gate.** N/A — no implementation risk, only a business/cost tradeoff to weigh (Supabase paid tier pricing not researched as part of this program; would need a quick lookup if evaluating seriously).

**19. Effort Estimate.** Trivial in engineering terms — this is a decision meeting, not a build task.

**20. Open Questions.** Actual Supabase paid-tier cost and PITR retention window (not researched this program — flagging rather than guessing a number).

**21. Owner/Sign-off.** Unassigned, awaiting your decision specifically (this one isn't really "implementation go" — it's a business call only you can make).

---

**Next in Step 4:** Wave 4 (CI coverage, background worker, integrations, load testing) and Wave 5 (polish) — continuing without pausing.
