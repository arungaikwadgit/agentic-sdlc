# Execution Status — 2026-08-27

Continues `docs/architecture/execution-status-2026-08-26.md`.

---

## 1. Completed today

| Item | What | Commit(s) | Status |
|---|---|---|---|
| #15 — Integration provider scoping | Investigated the credential-storage duplication this item was scoped to resolve, and scoped which of the 5 claimed integration providers are actually wired. | See Section 2 for the full commit list (5 doc corrections + diagram) | Done, verified. See Section 2. |
| #16 — Eval scorers scoping | Made the 3 open-question decisions from the wave3 spec (judge model, replace-vs-both, pilot scope) per the user's explicit direction. Build deliberately NOT started — kept as a future backlog item. | `step4-specs-wave3-draft.md`, `step6-prioritization-matrix-draft.md` | Scoped, deferred. See Section 5. |

---

## 2. Gap → fix → benefit — Integration provider scoping (#15)

**What #15 was scoped to find out:** whether two credential-encryption systems (client-side AES-GCM, server-side AES-256-GCM) served genuinely different purposes or one was redundant, and which of the 5 claimed integration providers (Jira/Confluence/GitHub/GitLab/Slack) are actually wired versus placeholder.

**Finding 1 — the duplication was already resolved, five days before this review.** Commit `404a5d2a` (2026-08-22, backlog item #14) deleted the client-side system (`frontend/src/utils/crypto.ts` + the crypto calls in `useIntegrations.ts`) after confirming it was dead code — the server-side module (`backend/src/integrationCredentialCrypto.js`, AES-256-GCM) was already fully built and tested but had never actually been wired into the routes, so the client-side module was doing the real work by default, with a genuine defect (credentials became permanently undecryptable if a user's `localStorage` was cleared). The actual conclusion lived in the commit message and `execution-status-2026-08-23.md`, not in the architecture planning docs — those kept describing the duplication as open.

**Finding 2 — provider scoping itself.** Of the 5 claimed providers:

| Provider | Typed credential shape | Backend route | Frontend UI | Verdict |
|---|---|---|---|---|
| GitHub | Yes (`GithubCredentials`) | `githubIntegration.js` | `ProjectSettings.tsx`, `GithubPushModal.tsx` | Fully wired |
| Jira | Yes (`JiraCredentials`) | `jiraIntegration.js` (test-only, shipped 2026-08-24) | `ProjectSettings.tsx` | Stored/tested; issue-push and chat-tool reads explicitly deferred |
| Confluence | None | None | None | Placeholder only — a string in the `IntegrationProvider` type union, nothing else |
| GitLab | None | None | None | Placeholder only |
| Slack | None | None | None | Placeholder only |

**Fix:** no code changes were needed — the duplication was already fixed. The real gap was documentation drift: five planning docs (`step2-dependency-criticality-draft.md`, `step4-specs-wave4-draft.md`, `step6-prioritization-matrix-draft.md`, `step8-nfrs-draft.md`, `step10-security-governance-gates-draft.md`) still described the duplication as open or violated, which was factually wrong as of 2026-08-22. Rewrote the specific sections in all 5 to reflect the resolved state and the provider-scoping finding, and corrected `docs/architecture/interactive-architecture-diagram.html`'s "External integrations" entry, which incorrectly claimed Confluence and GitLab credentials could also be "stored/tested" (they cannot — there's no code path for either).

**Commits:**
- `docs: mark #14/#15 resolved in dependency criticality draft (backlog #15)` — `step2-dependency-criticality-draft.md`
- `Resolve integration credential storage investigation` — `step4-specs-wave4-draft.md`
- `Revise prioritization matrix with task completion updates` — `step6-prioritization-matrix-draft.md`
- `Consolidate credential storage and update summary` — `step8-nfrs-draft.md` (also updated the RLS-coverage line in the same summary sentence, since backlog #13 closed that gap on 2026-08-26 and the sentence was being rewritten anyway)
- `Update security governance gate status for credentials` — `step10-security-governance-gates-draft.md`
- `docs: update architecture diagram for backlog #15 (2026-08-27)` — `interactive-architecture-diagram.html`

**Benefit:** the planning docs and the live diagram now match what's actually in the codebase. Anyone reading them will no longer think the credential system needs consolidating, and won't assume Confluence/GitLab/Slack have partial support they don't.

**Confidence: ~0.95.** The duplication resolution is backed by a direct commit read (`404a5d2a`) plus a call-site search across `frontend/src` and `backend/src` finding zero remaining references to the deleted client-side module. The provider-scoping table is backed by a directory listing of `backend/src/routes/` (no `confluenceIntegration.*`, `gitlabIntegration.*`, or `slackIntegration.*` exist) and a full-text search of `ProjectSettings.tsx` for each provider name.

**Deliberately out of scope:** building real Confluence/GitLab/Slack support. Per the item's own pre-implementation gate, #15 was investigation-only — building those out is separate, unstarted work (a typed credential shape, a route file, and UI per provider), not a continuation of this investigation.

---

## 3. Scope note — what remains untouched

- **Stray `_claude_backup_2026_08_07` table** — still awaiting the user's own `DROP TABLE IF EXISTS public._claude_backup_2026_08_07;` (command already provided in backlog #13's wrap-up).
- **`vector` extension in the `public` schema** and **Supabase Auth's leaked-password protection** — both flagged in #13, neither actioned, both still WARN-level and low priority.
- **#12 backup workflow** — shipped but not yet live: needs 3 secrets, a first test run, and a restore drill.
- **Jira and GitHub read/write parity, and Confluence/GitLab/Slack support** — all explicitly deferred, not part of #15's scope.

---

## 4. Next step

Backlog #15 is closed. #16 is scoped but explicitly deferred (see Section 5) — the user chose to record the decisions and keep it in the backlog rather than build it now. Remaining items, in the program's original order: #17 (load/performance testing), #21 (UI component inventory), #5 phases 4-6, deferred Jira full scope, and #16 whenever it's picked back up — plus the #12 follow-ups and the Section 3 items above.

---

## 5. Scoped but deferred — Eval scorers upgrade (#16)

The wave3 spec for #16 (`step4-specs-wave3-draft.md`) left 3 open questions before any build could start: judge model choice, whether to replace the 5 existing heuristic scorers or run both, and rollout scope. Asked the user directly rather than assuming; decisions made 2026-08-27:

- **Judge model: `gpt-4o`** — the same model already used for the live agent pipeline (`backend/src/proxy.js`), so judge reasoning stays consistent with what actually generated the output being judged, rather than a cheaper model with a different quality bar.
- **Replace vs. both: run both.** The 5 heuristic scorers in `tests/eval/scorers.ts` stay as the free, deterministic, no-API-key baseline that already gates CI (per `tests/eval/eval.test.ts`'s no-API-key contract) — the judge score is reported alongside as a new signal, not a replacement. Matches the spec's own flagged risk about judge reliability: a bad judge run can never silently weaken the existing gate.
- **Rollout scope: pilot on Token Optimizer only**, per the architecture diagram's own prior suggestion (it already has real pgvector grounding, so a judge could score citation accuracy, not just plausibility) — not wired into every agent's fixtures on the first pass.

**Explicitly not done:** no code was written. `llmJudge.ts` (referenced in `tests/eval/README.md` as the aspirational file for this) still does not exist. The user's direction was to capture the scoping decisions and keep #16 as a future backlog item, not implement it in this session. Updated `step4-specs-wave3-draft.md`'s Open Questions (now answered) and Owner/Sign-off (now "scoped, deferred") accordingly, and `step6-prioritization-matrix-draft.md`'s #16 row (was "Do next", now "Scoped, deferred").

**Confidence: ~0.95** that the decisions themselves are recorded accurately (they came directly from the user, not inferred). Rubric design (part of section 20's original open questions) is intentionally left for whoever picks this up — `tests/eval/README.md`'s existing example judge prompt is the suggested starting point, not a finished rubric.
