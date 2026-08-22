# Step 10 — Security & Governance Gates

**Status:** Draft, held for review per your standing approval (planning-only) — Process Rule 3 applies to any implementation.

**Source:** turns Step 8's security NFR findings into concrete gate definitions — what must be true before code merges, and what the platform's own AI-governance tables (already built and wired as of Wave 1) should actually gate at runtime.

---

## 1. Merge-time security gates (for this repo's own development)

| Gate | Current enforcement | Recommendation |
|---|---|---|
| Server-side RBAC on new routes | None automated — verified manually this session (Wave 1 item 2) | Add the integration test described in Step 9 §2; require it for any new mutating route touching `team_members`-scoped resources |
| No new SECURITY DEFINER views/functions without justification | None automated | A migration-review checklist item — cheap, no tooling needed, just a habit backed by this session's finding (two views had this exact problem, both now fixed) |
| No new tables without RLS consideration | None automated — this is exactly how ~24 tables ended up RLS-enabled-but-policy-less (a deliberate, documented pattern per migration 006, not an oversight, but worth re-confirming per table as Step 6 #13 proceeds) | Migration review checklist: every new table gets an explicit RLS decision recorded in the migration file's comments, matching this session's own convention |
| Secrets/credentials never duplicated without reason | Currently **violated** — two separate credential encryption systems exist (frontend `useIntegrations.ts`, backend `integrationCredentialCrypto.js`), flagged in Step 8 and Step 6 #14 | Resolve the duplication (Step 6 #14) before treating this gate as met |

## 2. Runtime governance gates (the platform's own AI-governance feature)

This is the part of "governance gates" that's specific to this platform, not generic engineering hygiene: `policy_decisions` (migration 016) already models exactly this — every governed action gets a `decision` of `allow`, `constrain`, `approval_required`, or `deny`, with `risk_tier` and `reasons`/`constraints` attached.

**What's already wired (confirmed live, Wave 1 item 1):** `agent_jobs`, `lifecycle_events`, `agent_runs`, and `chat_messages` all carry `policy_decision_id`, meaning the schema supports gating every one of those four execution paths on a policy decision.

**What wasn't verified this session:** whether the *application code* actually checks `policy_decisions.decision` before letting an `agent_job` run, an `agent_run` proceed, or a `chat_message`-triggered action execute — or whether the column is populated but not yet enforced. This is a real, specific gap worth closing before calling the governance system "live" rather than "modeled." Recommend a targeted follow-up: trace one execution path (e.g., `agent_jobs` → job pickup) and confirm the `deny`/`approval_required` outcomes actually block execution, not just get recorded.

## 3. Compliance framework — open question carried from Step 8

Restating from Step 8 rather than assuming an answer: no formal compliance framework (SOC 2, GDPR, etc.) appears anywhere in this program's findings. If one exists as a target, it should shape which of the above gates become *hard* blockers vs. advisory — e.g., SOC 2 would likely require the RLS gap (Step 6 #13) closed before certification, not just "documented as intentional."

---

**Approval needed to proceed:** none required to continue planning per your standing approval.
