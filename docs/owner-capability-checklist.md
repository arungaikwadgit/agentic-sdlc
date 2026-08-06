# Owner Capability Checklist — Invite & Password Flow

Verified 2026-07-11. Covers what a Project Owner (and, for contrast, other
roles) can and cannot do in the current invite / default-password / forced
password-change flow, as actually implemented in
`backend/src/proxy.js`, `server/src/routes/`, `frontend/src/lib/projectAccess.ts`,
and `frontend/src/components/settings/ProjectSettings.tsx`.

**How this was verified:** direct inspection of the current source (not
assumptions from older docs or task history), cross-checked against the
passing test suite — `projectAccess.test.ts`, `ProjectSettings-team.test.tsx`,
`ReviewGateModal-core.test.tsx`, `ReviewGateModal-prompt-sandbox.test.tsx`,
`ProjectWorkspace-*.test.tsx` (all green as of this session), plus the
existing backend suites `proxy.inviteSecurity.test.ts`,
`proxy.inviteFlow.integration.test.ts`, `proxy.inviteAccept.integration.test.ts`,
`proxy.inviteDefaultPassword.test.ts`. A live HTTP smoke test against the real
Supabase project in `backend/.env` was attempted but abandoned: the sandbox's
file mount for `backend/src/proxy.js` (~140KB) hit a reproducible write-size
ceiling around 127KB and corrupted the running copy on every attempt (three
different corruption patterns across five tries — garbled tail, an injected
null byte, and mid-statement truncation, all confirmed against the
authoritative source each time). That's a sandbox/tooling limitation, not
something observed in the app itself. Supabase Auth connectivity (account
creation, sign-in) was reachable from the sandbox; the local Postgres tunnel
(`POSTGRES_URL` → `127.0.0.1:15433`) was not, so the DB-persistence leg of the
flow could not be exercised live either. Treat the items below as
source-verified, not live-verified, and re-confirm against a real browser
session before relying on this for a security decision.

## The 3-step flow

1. **Send** — `POST /api/invite/send`. Provisions a real Supabase Auth account
   for the invitee up front (`provisionInviteeAccount()`), with
   `email_confirm: true` and a generated default password
   (`firstname_ddmmyyyy`, e.g. `arun_11072026`) — no confirmation-email wait.
   Returns the invite link, token, and password in the response regardless of
   whether the notification email actually sends (email delivery is
   best-effort; the link/password are the source of truth).
2. **Accept / sign in** — the invitee signs in to Supabase directly with the
   default password, then `POST /api/invite/accept` with that session's
   bearer token. The server re-verifies the session's *confirmed* email
   server-side (`requireVerifiedInviteeEmail`) — a client-supplied email is
   never trusted.
3. **Forced password change** — `AuthGuard.tsx` blocks the entire app behind
   `ForcedPasswordChange` whenever `user_metadata.must_change_password` is
   `true` (set by both a fresh invite accept and an admin-triggered reset).
   Clearing it is self-service: `supabase.auth.updateUser({ password, data: {
   must_change_password: false } })` — no backend route involved.

## Who can send/manage invites for a project

| Action | App Admin (`ADMIN_EMAIL_ALLOWLIST` / local admin-bypass) | Project Owner | Editor / Reviewer / Viewer |
|---|---|---|---|
| Send invite granting `editor`/`reviewer`/`viewer` | ✅ | ✅ | ❌ (`403 Forbidden`, logged to `invite_log`) |
| Send invite granting `project_owner` | ✅ | ✅ — **updated 2026-07-11**: `authorizeInviteAction()`'s ceiling check now only rejects roles ranked *strictly higher* than `project_owner` (`appRoleRank(requestedAppRole) > appRoleRank('project_owner')`), which is impossible today since `project_owner` is the top rank. A Project Owner can now delegate full ownership to another member (see the code comment at that check for the rationale) | ❌ |
| Revoke / view an existing invite for the project | ✅ | ✅ (own project only) | ❌ |
| Reset a team member's password (`/api/invite/reset-password`) | ✅ | ✅ (own project only) | ❌ |
| Change another member's `appRole` in Project Settings | ✅ | ✅ | ❌ (`isAdmin` gate in `ProjectSettings.tsx`) |
| Remove a member | ✅ | ✅, **except**: cannot remove/downgrade the project's last remaining Project Owner (`wouldLeaveNoOwner()` guard — blocks both `removeMember()` and role changes via `handleInviteSubmit()`) | ❌ |
| Run pipeline agents | ✅ | ✅ (`ROLE_PERMISSIONS.project_owner.canRunAgents`) | Editor: ✅, Reviewer/Viewer: ❌ |
| Approve/comment on review gates | ✅ | ✅ | Editor/Reviewer: ✅, Viewer: ❌ |
| Export documents | Governed separately by `getProjectExportPermission()` in `projectAccess.ts` — admins/owners always `canExport: true`; other roles depend on `project.exportAccess.enabledRoleIds`/`enabledMemberIds` | | |

**Note on docs/DEVELOPMENT.md's old claim:** the previous wording — *"project_owner itself is never grantable through an invite link, by anyone"* — is only half true. It's correct for a Project-Owner-level caller (blocked by the role-ceiling check), but an app Admin **can** grant `project_owner` via invite: `INVITABLE_APP_ROLES = ['project_owner', 'editor', 'reviewer', 'viewer']` includes it, and `authorizeInviteAction()` returns `{ ok: true }` unconditionally for admin/admin-bypass callers before the ceiling check ever runs. There's also a stale code comment nearby (`backend/src/proxy.js` ~line 1512) claiming *"project_owner is already excluded from INVITABLE_APP_ROLES entirely"* — the array itself contradicts that comment. Worth a follow-up cleanup pass on that comment specifically; not fixed here since it's a no-op comment with no behavioral effect.

## Security properties confirmed by inspection

- Invite tokens are never stored raw — only `SHA-256(token)` is persisted (`team_members.invite_token_hash`); a tampered/guessed token simply won't match and 404s.
- Invite acceptance requires a **server-verified**, email-confirmed Supabase session; the invited email must match that session's email exactly (`403` on mismatch) — never a client-supplied email/query param.
- Invites expire after 7 days (`isInviteExpired`, derived from `invited_at`), and revoked/already-accepted invites are rejected (`410`/`409`).
- Accepted access is project-scoped: the resulting `invite_sessions` token only grants access to the one project/role it was issued for.
- Defense-in-depth: even if a stored `team_members.app_role` somehow ended up outside `INVITABLE_APP_ROLES` (e.g. legacy data), `dbAcceptInvite()` rejects the accept with `INVALID_ROLE` rather than honoring it.

## Live-verified 2026-07-11 (real Chrome browser, real dev servers, real Supabase project)

- **Bug found and fixed**: `sendInvite()` in both `frontend/src/components/settings/ProjectSettings.tsx`
  and `frontend/src/components/team/TeamPanel.tsx` had a hardcoded client-side
  guard that unconditionally blocked sending any invite with
  `appRole === 'project_owner'` — a warning modal fired ("Invite links cannot
  grant Project Owner access...") and the request never reached
  `POST /api/invite/send`. This was stale relative to the backend's current
  policy (App Admins, and now Project Owners too, can grant `project_owner`)
  and fully defeated that capability from the UI. Fixed by removing the
  client-side block in both places; the server (`authorizeInviteAction()`)
  remains the actual authority. Verified live: signed in as `admin@local`,
  sent a `project_owner` invite, got a real invite link/token/password back
  with no warning (`POST /api/invite/send` → `200`).
- **Bug found and fixed**: `TeamPanel.tsx`'s `changeRole()`/`removeMember()`
  had no "last owner" protection at all — the UI relied entirely on the
  deprecated `TeamMember.isAdmin` flag (`disabled={m.isAdmin}`,
  `{!m.isAdmin && ...}`), which is never set on new members (only `appRole`
  is). In practice this meant the sole Project Owner of a project could be
  demoted or removed via this panel with zero guard. Added a
  `wouldLeaveNoOwner()` check mirroring `ProjectSettings.tsx`'s existing
  protection, and fixed a related stale `m.isAdmin` read in the invite
  payload's `invitedBy` field.
- Confirmed live: full send → sign-in-with-default-password → forced
  password change flow works end-to-end for a `project_owner` invite
  (`ForcedPasswordChange` blocked the app, password set successfully, gate
  lifted automatically via `AuthContext`'s listener, "Welcome aboard!" shown).
- Confirmed live: the invitee's account did **not** see the project
  afterward, even navigating directly to `/?project=<id>`. Root cause: no
  local Postgres in this dev environment (`backend` log: "Invite system: DB
  connection failed, using in-memory store"), so the `team_members` sync
  never durably persisted for `server/`'s `GET /api/projects` to pick up.
  This is the same limitation already called out under "Local Postgres
  setup" earlier in `docs/DEVELOPMENT.md` — not a new bug, and not
  reproducible with real Postgres configured.
- Not yet exercised live: real email delivery succeeding (only the
  Resend-sandbox-mode failure path was seen, since the test recipient wasn't
  the account's own verified address — expected, not a bug); Postgres
  persistence of `team_members`/`invite_log` (blocked by lack of local
  Postgres, as above).
