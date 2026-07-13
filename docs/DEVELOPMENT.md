# Development Guide

## Prerequisites

- Node 20+
- npm 10+
- Docker (optional, for containerised deployment)

## Setup

```bash
git clone <repo>
cd agentic-sdlc

# Install all dependencies
npm install
cd backend && npm install
cd ../frontend && npm install && cd ..
```

### Backend (`backend/`) — local dev, three auth paths

Copy and fill the backend env file:

```bash
copy backend\.env.example backend\.env
```

Minimal `backend\.env` to run agent calls only (no invite/team features):
```
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o
PROXY_TOKEN=your-secret-token
PORT=3001
```

`checkToken()` in `backend/src/proxy.js` accepts, in order: (1) the
`admin@local` / `admin` local-dev bypass (see below) — never available when
`NODE_ENV=production`; (2) a real Supabase JWT, if `SUPABASE_URL`/
`SUPABASE_ANON_KEY` are set; (3) the shared `PROXY_TOKEN` secret. With none of
`PROXY_TOKEN`/`SUPABASE_URL` set, auth is effectively open (local/dev-only).

**To exercise invite/team/password features locally**, also set in
`backend\.env`:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...        # service_role key — admin account provisioning
ADMIN_EMAIL_ALLOWLIST=you@example.com   # comma-separated app admins (in addition to the admin@local bypass)
# Invite emails — either one enables real sending; leave both unset for "dev
# mode" (invite link/password still returned in the API response and UI, just
# no email sent):
RESEND_API_KEY=re_...
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx   # 16-char Google App Password, not your account password
APP_URL=http://localhost:5173
```
See `backend/.env.example` for the full list with inline explanations, and
`docs/owner-capability-checklist.md` for what each role can do once this is
configured.

**Admin bypass for local testing** — sign in on the login screen with
`admin@local` / `admin` (see `frontend/src/lib/adminMode.ts`,
`ADMIN_BYPASS_ENABLED = import.meta.env.DEV`) to get full app-admin
capabilities (including granting `project_owner` via invite) without needing
a real Supabase session. This only works in dev builds — production always
requires real Supabase auth. `tests/e2e/fixtures/auth.ts` uses the same
bypass for Playwright E2E runs via `CI_ADMIN_BYPASS=true` (alternative:
`CI_SUPABASE_EMAIL` + `CI_SUPABASE_PASSWORD` for a real-auth E2E run).

> For production (Railway + Vercel), use `server/` with Supabase JWT auth instead of `backend/`'s PROXY_TOKEN fallback — see the [Deployment Guide](./deployment-and-agentic-assessment.md).

### Frontend (`frontend/`)

```bash
copy frontend\.env.example frontend\.env
```

Edit `frontend\.env`:
```
VITE_API_URL=/api
```

> **Security:** Do NOT add `VITE_PROXY_TOKEN` to the frontend `.env`. Any `VITE_*` variable is bundled into the browser build and exposed publicly. The token lives only in `backend/.env` (server-side) and is never passed to the frontend.

### Server (`server/`) — production backend (Supabase JWT auth)

Only needed when running the full production stack locally:

```bash
copy server\.env.example server\.env
```

Edit `server\.env`:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # service_role key — server only, never frontend
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o
PORT=3001
```

> **Security:** `SUPABASE_SERVICE_KEY` is the service_role (secret) key. It must never appear in frontend env files or be exposed in the browser.

## Local Postgres (master data, team/invite persistence)

This section documents infrastructure that already exists in the repo
(`docker-compose.yml`, `backend/migrations/*.sql`, `backend/scripts/seed*.js`)
but was never written up here — this closes that gap. It replaces the
ephemeral, dev-only fallback stores in `backend/src/proxy.js`
(`localProjectStore`, `inviteStore`) with a real local Postgres so invited
team members, invite tokens, and app-wide master data (phases, agents,
domains, role templates) survive a `nodemon` restart instead of being wiped
every time a backend source file is saved.

**1. Start local Postgres via Docker** (root `docker-compose.yml`, `db`
service only — do not confuse with `docker/docker-compose.yml`, which
containerizes the whole app and is for a different workflow):

```bash
docker compose up -d db
```

Default credentials (override via env vars if you want different ones):
`agentuser` / `agentpass` / db `agentdb`, exposed on `localhost:5432` —
these already match `backend/.env.example`'s `POSTGRES_URL_LOCAL` default,
so no changes are needed for the common case.

**2. Create the schema.** The files in `backend/migrations/` are plain,
idempotent SQL (safe to re-run) — despite `backend/package.json` having
`migrate:up`/`migrate:down` scripts that invoke `node-pg-migrate`, these
particular files are **not** written in `node-pg-migrate`'s format (they're
named/structured for direct `psql` execution, per each file's own header
comment) — running them via `npm run migrate:up` will not work as expected.
Use `psql` directly instead:

```bash
psql postgresql://agentuser:agentpass@localhost:5432/agentdb -f backend/migrations/000_full_schema.sql
psql postgresql://agentuser:agentpass@localhost:5432/agentdb -f backend/migrations/004_master_data_catalog.sql
```

(`000_full_schema.sql` already supersedes `001_initial_schema.sql` +
`002_invite_roles.sql` combined — see its own header comment. Run
`003_rls_policies.sql` too only if you want Supabase-style Row Level Security
policies locally; it's optional for local dev since `backend/proxy.js`
connects with a superuser-equivalent role.)

**3. Seed master data** (phases, the 26 agents, domains, role templates —
generated from the real `frontend/src/agents/*` and `frontend/src/data/roleTemplates.ts`
source, not hand-entered, so it can't drift from what the app actually ships):

```bash
cd backend
POSTGRES_URL=postgresql://agentuser:agentpass@localhost:5432/agentdb npm run seed:master-data
```

Optionally, seed sample/demo projects too:

```bash
POSTGRES_URL=postgresql://agentuser:agentpass@localhost:5432/agentdb npm run seed:sample-data
```

**4. Point `backend/.env` at it.** Set (or confirm) in `backend/.env`:

```
POSTGRES_URL_LOCAL=postgresql://agentuser:agentpass@localhost:5432/agentdb
```

Restart `npm run dev:backend` after this — `backend/src/proxy.js` reads this
once at process startup (see `resolveDbConnectionString()`), so saving the
`.env` file alone doesn't take effect until the process restarts.

**Without this setup**, local dev still works — `backend/proxy.js` and the
frontend's `masterDataCatalog.ts` both have explicit, documented fallbacks to
in-memory storage / built-in frontend defaults (see the `import.meta.env.DEV`
branch in `frontend/src/services/masterDataCatalog.ts`). The tradeoff without
a local Postgres: invited team members, invite links, and any app-state
config you change locally are lost on every backend restart. This was the
root cause of the `GET /api/projects/:id 404` bug where a bookmarked project
ID stopped resolving after a `nodemon` auto-restart wiped the in-memory
project store.

## Invite Links (default-password accounts + security model)

Adding someone to a project is a 3-step flow: an Admin or Project Owner sends
an invite from Project Settings → Team; the invitee signs in immediately with
a generated default password (no confirmation-email wait); the app then
forces them to set their own password before they can use anything else.

**Account provisioning (`POST /api/invite/send`)**
- The invitee's real Supabase Auth account is created up front —
  `provisionInviteeAccount()` in `backend/src/proxy.js` — with
  `email_confirm: true` and a generated default password in the format
  `firstname_ddmmyyyy` (e.g. `arun_11072026`). No separate email-confirmation
  step is needed: the password itself, delivered out of band via the invite
  email/link, is the proof of mailbox ownership.
- The invite link, raw token, and generated password are always returned in
  the API response, whether or not the notification email actually sends —
  email delivery (Resend/Gmail) is best-effort. If it fails, the UI shows the
  failure reason and the admin can still copy the link/password to share
  manually.
- If the email was already registered (a re-invite, or someone removed and
  re-added), the existing Supabase account's password is reset instead of
  creating a duplicate.

**Forced password change**
- Both a fresh invite accept and an admin-triggered reset
  (`POST /api/invite/reset-password`) set
  `user_metadata.must_change_password = true`. `AuthGuard.tsx` blocks the
  entire app behind `ForcedPasswordChange` until it's cleared.
- Clearing it is self-service and client-only:
  `supabase.auth.updateUser({ password, data: { must_change_password: false
  } })` in `ForcedPasswordChange.tsx` — no server route involved.
  `AuthContext`'s `onAuthStateChange` listener picks up the resulting
  `USER_UPDATED` event and the gate lifts automatically.

**Who can create/revoke/view invites for a project**
- Any app Admin (`ADMIN_EMAIL_ALLOWLIST`, checked in `backend/src/proxy.js`),
  for any project — **including granting `project_owner`**.
- The project's own Project Owner (the project creator, or anyone with an
  accepted `app_role='project_owner'` `team_members` row for that project) —
  **including granting `project_owner`** to someone else (delegating full
  ownership). `authorizeInviteAction()`'s role-ceiling check only rejects a
  requested role ranked *strictly higher* than `project_owner`
  (`appRoleRank(requestedAppRole) > appRoleRank('project_owner')`), which is
  impossible today since `project_owner` is the top rank — this was changed
  from an earlier `>=` comparison specifically so a Project Owner can
  delegate. See `docs/owner-capability-checklist.md` for the full capability
  matrix and for a note on a stale code comment near `INVITABLE_APP_ROLES`
  that still claims `project_owner` is "already excluded" — the array itself
  contradicts that comment.
- **Client-side note**: the Team Settings UI (`ProjectSettings.tsx` and
  `TeamPanel.tsx`) used to have a hardcoded block preventing anyone —
  including Admins — from sending a `project_owner` invite at all, left over
  from before this was allowed server-side. That block was removed
  2026-07-11 after being caught live; the server has always been the actual
  authority.
- Everyone else gets `403 Forbidden`. Denied attempts are logged (best-effort,
  non-blocking) to `invite_log` when a team_members row exists to attach the
  log entry to, or to the server console otherwise.
- Removing/downgrading the project's last remaining Project Owner is blocked
  client-side (`wouldLeaveNoOwner()` in `ProjectSettings.tsx`) so a project
  can never end up with zero owners.

**How the token is protected**
- The invite token is a random UUID, shown to the caller exactly once (in the
  API response and the share link).
- Only its SHA-256 hash (`team_members.invite_token_hash`) is ever persisted.
  Accept/validate/revoke all hash the client-supplied token server-side and
  compare hashes — the raw token is never looked up or logged.
- A tampered or guessed token simply won't match any stored hash and 404s.

**What the server checks before granting access** (`/api/invite/accept`,
`backend/src/proxy.js`):
1. The token's hash matches a `team_members` row.
2. That invite is `pending` (not `accepted` already, not `revoked`).
3. It hasn't passed its 7-day TTL (`isInviteExpired`, derived from
   `invited_at` — there's no separate `expires_at` column to drift out of
   sync).
4. The invited email matches the *server-verified* Supabase session email —
   never a client-supplied email/query-param. `requireVerifiedInviteeEmail()`
   re-validates the bearer JWT and requires a confirmed email on every accept
   call.
5. The resulting access is scoped to exactly that one project and that one
   role — accept issues a project-scoped `invite_sessions` token, and the
   invitee's `team_members` row for any *other* project is untouched.

None of this is enforced client-side only — the invite-accept page
(`frontend/src/components/invite/InviteAcceptPage.tsx`) calls the same
server endpoints and only shows "you're in" after the server confirms; it
never grants access based on URL parameters alone.

**Automated tests**: `backend/src/proxy.inviteSecurity.test.ts` covers the
token hashing / role-ranking / expiry / admin-allowlist logic without a
database. `backend/src/proxy.inviteFlow.integration.test.ts` covers the full
create → accept/revoke → authorization HTTP flow against a real Postgres and
is skipped automatically if `POSTGRES_URL_TEST` isn't set.
`backend/src/proxy.inviteDefaultPassword.test.ts` and
`backend/src/proxy.sendInviteEmail.test.ts` cover default-password generation/
provisioning and the email-send path specifically;
`backend/src/proxy.inviteAccept.integration.test.ts` covers the sign-in-with-
default-password → accept flow. See `docs/owner-capability-checklist.md` for
a source-verified capability matrix and what's still unverified against a
live browser session.

**Manual testing flow (real browser, local dev)**

Prerequisite: `backend/.env` has `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` set
(see Backend Setup above) — invite send needs a real Supabase project to
create the invitee's account against, even in local dev.

1. Start both servers: `npm run dev` (backend on :3001, frontend on :5173).
2. Open http://localhost:5173 and sign in as `admin@local` / `admin` (the
   local admin-bypass login — gives you full admin rights without a real
   Supabase session for your own account).
3. Open or create a project, go to **Project Settings → Team**, and click
   **Invite**. Enter a real email address you control and pick a role —
   try `project_owner` first, since that's the case that changed (an app
   admin can now grant it; a Project Owner still cannot — see the
   capability table above).
4. The invite modal shows the generated invite link, the raw token, and the
   default password (`firstname_ddmmyyyy`, e.g. `arun_11072026`) — copy the
   password down, you'll need it in the next step. If Resend/Gmail is
   configured, an email also goes out with the same info; check the
   inbox to confirm delivery, but don't rely on it arriving to keep testing.
5. Open the invite link in a **new incognito window** (so you don't clobber
   your `admin@local` session) and sign in with the invitee's email + the
   default password from step 4.
6. Confirm you land on **`ForcedPasswordChange`** — the app should not let
   you navigate anywhere else. Set a new password (8+ characters).
7. Confirm the app unlocks automatically after saving (no manual redirect
   needed — `AuthContext`'s listener clears the gate) and that you land in
   the project with the role you were invited as.
8. Back in the `admin@local` window, refresh Project Settings → Team and
   confirm the new member shows up with the correct role, and that
   re-inviting the same email now resets their password instead of erroring.
9. As a negative check, sign in as that non-admin invitee and try to invite
   someone else as `project_owner` from Team settings — it should be
   rejected (button hidden, or a `403` if forced via API), confirming the
   role-ceiling check actually holds in a live session, not just in tests.
10. Clean up: `node backend/scripts/cleanupInviteTestUsers.js <email>` to
    delete the real Supabase Auth user(s) you created while testing.

Steps 1-8 confirm the money-path (send → default-password sign-in → forced
change); step 9 is the specific case the RBAC consolidation this doc
describes was meant to fix, so don't skip it.

## Running Locally

```bash
# Start both backend proxy + frontend (recommended for dev)
npm run dev
```

- Frontend: http://localhost:5173
- Backend proxy: http://localhost:3001/health

To run only the backend or frontend separately:

```bash
npm run dev:backend    # backend/ proxy only
npm run dev:frontend   # Vite frontend only
```

## Running with Docker

```bash
docker-compose -f docker/docker-compose.yml up
```

- App: http://localhost:3000

## Available Scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Start backend + frontend concurrently |
| `npm run dev:backend` | Backend proxy only |
| `npm run dev:frontend` | Frontend (Vite) only |
| `cd frontend && npm run typecheck` | TypeScript compile check |
| `cd frontend && npm test` | Run Vitest unit tests |
| `cd frontend && npm run build` | Production build |
| `cd frontend && npm run test:coverage` | Tests with coverage report |
| `cd frontend && npm run test:e2e` | Playwright E2E tests (needs running dev server). Auth is handled by `tests/e2e/fixtures/auth.ts`: set `CI_ADMIN_BYPASS=true` to sign in as `admin@local` (no Supabase needed), or `CI_SUPABASE_EMAIL` + `CI_SUPABASE_PASSWORD` for a real-auth run. Neither set → no-op if the app has no login requirement. |
| `k6 run tests/performance/pipeline-load.js` | K6 load test (needs k6 installed) |

## Project Structure

```
agentic-sdlc/
├── frontend/          # React + Vite SPA (Vercel)
│   └── src/
│       ├── agents/        # Agent definitions, constants, prompt defaults
│       ├── components/    # React components (pipeline, documents, auth, etc.)
│       ├── db/            # Dexie/IndexedDB schema and project repository
│       ├── services/      # Pipeline engine, API client, exporters
│       └── types/         # Shared TypeScript types
├── backend/           # Express proxy (local dev, PROXY_TOKEN auth)
├── server/            # Express API (production, Supabase JWT auth, Railway)
├── docs/              # Architecture docs, ADRs, test plans
└── tests/             # Unit, integration, E2E, and performance tests
```

See `docs/ARCHITECTURE.md` for ADRs and system design details.

## Adding a New Agent

1. Add the `AgentId` to `frontend/src/types/agent.types.ts`
2. Add the definition to `frontend/src/agents/definitions.ts`
3. Add the agent to the correct phase in `frontend/src/agents/constants.ts` (`PHASE_AGENTS`)
4. `TOTAL_AGENTS` is derived automatically — no manual update needed

> `TOTAL_AGENTS` is computed as `Object.values(PHASE_AGENTS).flat().length`, so adding an agent to `PHASE_AGENTS` updates the count automatically.

## Migrations

Dexie auto-migrates on schema version change. To add a new field:

1. Increment version in `frontend/src/db/database.ts`
2. Add upgrade function: `.upgrade(tx => tx.projects.toCollection().modify(p => { p.newField = default; }))`
3. Export a backup before deploying (Projects → Export).

## Context Document Persistence

Agents support attaching context files (PDF, Word, Excel, CSV, TXT, images) via the Re-run panel. Uploaded files are extracted to text and stored in `project.contextDocuments` in IndexedDB. They persist across re-runs and page reloads.

PDF extraction uses `pdf.js` loaded dynamically from `cdnjs.cloudflare.com`. The CSP in `frontend/vite.config.ts` already allows this domain — do not remove those entries.

## Test Data

To create sample projects quickly, use the 5 presets in the New Project modal. Each preset has a domain, name, and description pre-filled.
