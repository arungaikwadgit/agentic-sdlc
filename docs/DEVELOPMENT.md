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

### Backend (`backend/`) — local dev with PROXY_TOKEN auth

Copy and fill the backend env file:

```bash
copy backend\.env.example backend\.env
```

Edit `backend\.env`:
```
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o
PROXY_TOKEN=your-secret-token
PORT=3001
```

> **Note:** `backend/` uses a simple PROXY_TOKEN for local development. For production (Railway + Vercel), use `server/` with Supabase JWT auth instead — see the [Deployment Guide](./deployment-and-agentic-assessment.md).

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

## Invite Links (manual sharing + security model)

The email-invite feature is on hold. The supported way to add someone to a
project today is the **manual invite link**: an Admin or Project Owner
generates a link in Project Settings → Team, copies it, and shares it however
they like (Slack, chat, in person). Email sending (Resend/Gmail) still runs
automatically if configured on the backend, but it's best-effort — invite
creation always succeeds and always returns a copyable link, whether or not
the email actually sends. If email delivery fails, the UI shows the failure
reason and the link is still there to copy and share by hand.

**Who can create/revoke/view invites for a project**
- Any app Admin (`ADMIN_EMAIL_ALLOWLIST`, checked in `backend/src/proxy.js`),
  for any project.
- The project's own Project Owner (the project creator, or anyone with an
  accepted `app_role='project_owner'` `team_members` row for that project).
- A Project Owner can only grant `editor`, `reviewer`, or `viewer` —
  `project_owner` itself is never grantable through an invite link, by anyone.
- Everyone else gets `403 Forbidden`. Denied attempts are logged (best-effort,
  non-blocking) to `invite_log` when a team_members row exists to attach the
  log entry to, or to the server console otherwise.

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

**Testing**: `backend/src/proxy.inviteSecurity.test.ts` covers the token
hashing / role-ranking / expiry / admin-allowlist logic without a database.
`backend/src/proxy.inviteFlow.integration.test.ts` covers the full
create → accept/revoke → authorization HTTP flow against a real Postgres and
is skipped automatically if `POSTGRES_URL_TEST` isn't set.

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
| `cd frontend && npm run test:e2e` | Playwright E2E tests (needs running dev server) |
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
