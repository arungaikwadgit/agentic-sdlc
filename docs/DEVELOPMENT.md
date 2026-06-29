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
