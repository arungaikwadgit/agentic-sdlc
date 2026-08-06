# Security Review Addendum - 2026-07-05

Scope: manual invite-link hardening (email-based invite sending is on hold
per product decision; this addendum covers the fallback in-app invite-link
flow). Builds on `docs/security-review-2026-07-01.md` — that review's F3
(Replay Attack) fix is unchanged; this addendum documents two additional
findings identified and fixed in the same subsystem.

## Findings Table

| ID | Vulnerability Type | Status | Severity | Files | Notes |
|---|---|---|---|---|---|
| F7 | Authorization Gap | Fixed | Critical | `backend/src/proxy.js` | `POST /api/invite/send`, `DELETE /api/invite/revoke`, and `GET /api/invite/team/:projectId` previously accepted any authenticated user for any project — no check that the caller was an app Admin or that project's Owner. Any signed-in user could invite people into, or revoke invites from, a project they had no relationship to. |
| F8 | Sensitive Data Storage (plaintext secret) | Fixed | High | `backend/src/proxy.js`, `backend/migrations/005_secure_invite_links.sql` | Invite tokens were stored in plaintext (`team_members.invite_token`, and as the in-memory fallback store's key). Now only a SHA-256 hash is persisted (`invite_token_hash`); the raw token is returned to the caller exactly once and never round-tripped through storage or logs. |

## Category Review

### Authorization (F7)

- Reviewed every invite-management endpoint against who is actually allowed to call it per the product's stated rule: "Admin can create invite links for allowed projects. Project Owner can create invite links only for owned projects."
- Result: **Fixed**. Added `authorizeInviteAction()`, checked before create/revoke/list. Authorization resolves the caller's role two ways — a relational `team_members` row (`app_role='project_owner'`, `invite_status='accepted'`) and the `projects.data.teamMembers` JSONB entry seeded at project creation — because project membership is represented in both places in this codebase and a project's own creator has no relational row until someone accepts an invite. A Project Owner is also blocked from granting a role ranked at or above their own (`appRoleRank()`), even though `project_owner` was already excluded from the invitable-role list.
- Failed authorization attempts are logged (best-effort) to `invite_log` when a `team_members` row exists to attach to, otherwise to the server console — full audit-log coverage for identity-less denials would need a schema change (`invite_log.team_member_id` is `NOT NULL`) and was judged out of scope for this pass.

### Sensitive Data Storage (F8)

- Reviewed how the invite secret is generated, transmitted, and stored.
- Result: **Fixed**. `hashInviteToken()` (SHA-256) is applied before every write and every comparison across create/accept/validate/revoke. A tampered or guessed token cannot match a stored hash by construction. Legacy rows created before this change keep a raw-token fallback comparison for backward compatibility only — no new invite ever writes a raw token.

## Verification

- Backend unit tests: `backend/src/proxy.inviteSecurity.test.ts` (15 tests, DB-free, run and passing) — hashing determinism/collision resistance, role ranking, admin allowlist, expiry.
- Backend integration tests: `backend/src/proxy.inviteFlow.integration.test.ts` (8 tests) — compiles clean and skips correctly with no database configured; requires a real Postgres (`POSTGRES_URL_TEST`) to actually execute, which was not available in the environment this change was authored in. Run locally or via CI to get an authoritative pass/fail.
- Full backend suite: 27 passed, 8 skipped (the integration file above), 0 failed.
- Frontend: `tsc --noEmit` passed clean.

## Residual Recommendations

1. Reconcile the two project-membership stores (`team_members` relational table vs. `projects.data.teamMembers` JSONB) into one source of truth — the dual-check in `authorizeInviteAction()` works but is inherited complexity, not a clean design, and is a likely source of future bugs if the two stores ever drift.
2. `server/src/routes/invites.ts` (mounted at `/api/invites` in `server/src/index.ts`) references tables (`invites`, `project_members`) and columns (`projects.owner_id` in that codebase's sense) that do not exist in the schema this app actually runs — it is dead/broken code, not exercised by the frontend, and should be removed or rewritten rather than left mounted.
3. Run the integration suite against a real Postgres (local Docker or CI) before merging — this addendum's authorization/hashing logic was verified by careful code tracing and DB-free unit tests, not a live end-to-end run.
