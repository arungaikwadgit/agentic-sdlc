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

# Copy and fill env files
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

Edit `backend\.env`:
```
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o
PROXY_TOKEN=your-secret-token
PORT=3001
```

Edit `frontend\.env`:
```
VITE_API_URL=/api
VITE_PROXY_TOKEN=your-secret-token
```

## Running Locally

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend proxy: http://localhost:3001/health

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
| `cd frontend && npm test` | Unit + integration tests (Vitest) |
| `cd frontend && npm run test:coverage` | Tests with coverage report |
| `cd frontend && npm run test:e2e` | Playwright E2E tests (needs running dev server) |
| `k6 run tests/performance/pipeline-load.js` | K6 load test (needs k6 installed) |

## Project Structure

See `docs/ARCHITECTURE.md` for full structure and ADRs.

## Adding a New Agent

1. Add the `AgentId` to `src/types/agent.types.ts`
2. Add the definition to `src/agents/definitions.ts`
3. Add the agent to the correct phase in `src/agents/constants.ts`
4. Update `TOTAL_AGENTS` constant

## Migrations

Dexie auto-migrates on version change. To add a new field:

1. Increment version in `src/db/database.ts`
2. Add upgrade function: `.upgrade(tx => tx.projects.toCollection().modify(p => { p.newField = default; }))`
3. Export a backup before deploying (Projects → Export).

## Test Data

To create sample projects quickly, use the 5 presets in the New Project modal. Each preset has a domain, name, and description pre-filled.
