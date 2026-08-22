# Step 11 — Production Readiness Checklist

**Status:** Draft, held for review per your standing approval (planning-only) — Process Rule 3 applies to any implementation.

**Source:** a point-in-time snapshot as of this session's verified findings (2026-08-22), not aspirational. Each row is 🟢/🟡/🔴 with the evidence behind it.

---

| Area | Status | Evidence |
|---|---|---|
| Backend deploy (Railway, `agentic-sdlc`) | 🟢 | Confirmed SUCCESS, latest commit, this session |
| Server deploy (Railway, `artistic-charm`) | 🟢 | Confirmed SUCCESS, latest commit, this session; was silently broken for ~2 weeks before this session's fix (Ledger #6) |
| Frontend deploy (Vercel) | 🟢 | Confirmed by you directly after the commit-authorship fix |
| Database migrations | 🟢 | Continuous 000-023, verified live against production schema |
| Server-side authorization | 🟢 | Confirmed enforced, no gap found |
| DB-layer defense-in-depth (RLS policies) | 🟡 | ~24 tables RLS-enabled, zero policies — app-layer-only; may be intentional per table, not yet confirmed per table |
| Leaked-password protection | 🔴 (accepted risk) | Not available on Supabase Free plan |
| Backup / point-in-time recovery | 🔴 (accepted risk) | Not available on Supabase Free plan |
| Test coverage — frontend | 🟡 | CI runs it; real % never pulled from a live run |
| Test coverage — backend | 🔴 | No coverage step in CI at all |
| Test coverage — server | 🔴 | One test file exists; effectively unmeasured |
| Governance gate enforcement (runtime) | 🟡 | Schema/data model fully wired (policy_decision_id everywhere); whether app code actually blocks on `deny` outcomes not verified (Step 10 §2) |
| Credential storage | 🟡 | Functional but duplicated across two systems, unreconciled |
| Background job processing | 🟡 | Worker code exists, switched off in production — a decision, not a bug |
| Rate limiting | 🟢 | Working correctly on both services post trust-proxy fix |
| Observability / correlation IDs | 🟡 | Schema supports it; population by application code unverified |
| Dead code | 🟢 | Confirmed clean pass this session (`invites.ts` removed after verifying it was unreachable) |
| Load/performance testing | 🔴 | ~10 VU, not representative of real usage; no real usage data exists to test against yet |
| User feedback capture | 🔴 | Confirmed absent — zero hits for feedback/rating patterns anywhere in the codebase |
| RAG grounding (32 pipeline agents) | 🔴 | Confirmed zero grounding — self-reported confidence only |

## Summary

**7 green, 6 yellow, 6 red.** None of the reds are silent or newly discovered by this checklist — every one traces to a finding already tracked in Steps 1-8 or the RAID register, and two (leaked-password protection, backup/PITR) are explicitly accepted risks rather than open work. The yellows are the more interesting category: they're places where the *infrastructure* for a capability exists (RLS enablement, governance schema, correlation ID columns) but the *behavior* that makes it real hasn't been confirmed — worth prioritizing verification over new-build work in several cases, since some of this may already be closer to done than the red items suggest.

---

**Approval needed to proceed:** none required to continue planning per your standing approval.
