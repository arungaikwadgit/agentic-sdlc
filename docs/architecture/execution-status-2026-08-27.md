# Execution Status — 2026-08-27

Continues `docs/architecture/execution-status-2026-08-26.md`.

---

## 1. Completed today

| Item | What | Commit(s) | Status |
|---|---|---|---|
| #15 — Integration provider scoping | Investigated the credential-storage duplication this item was scoped to resolve, and scoped which of the 5 claimed integration providers are actually wired. | See Section 2 for the full commit list (5 doc corrections + diagram) | Done, verified. See Section 2. |

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

Backlog #15 is closed. Remaining items, in the program's original order: #16 (eval scorers), #17 (load/performance testing), #21 (UI component inventory), #5 phases 4-6, deferred Jira full scope — plus the #12 follow-ups and the Section 3 items above. User's call on what to prioritize next.
