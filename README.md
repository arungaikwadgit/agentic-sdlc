# Agentic SDLC Framework

A browser-based tool that automates the full software development lifecycle using 30 AI agents across 11 phases, backed by an Autonomous Agent Runtime (Express + TypeScript + PostgreSQL).

## Architecture

```
frontend/          Vite + React (browser UI)
backend/           Express + TypeScript (Agent Runtime — port 4000)
shared-types/      @agentic-sdlc/shared-types (TypeScript interfaces, no runtime deps)
docs/adr/          Architecture Decision Records (ADR-001 through ADR-005)
migrations/        node-pg-migrate SQL migrations
docker-compose.yml PostgreSQL 15 + legacy proxy + runtime
```

## Quick Start

### Prerequisites
- Node 20+
- Docker Desktop (for the Postgres service)

### 1. Start Postgres

```bash
docker compose up db -d
# Wait for the health-check: docker compose ps
```

### 2. Install dependencies

```bash
# Root + frontend
npm install

# Backend
cd backend && npm install && cd ..

# Shared types
cd shared-types && npm install && cd ..
```

### 3. Configure environment

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` and set at minimum:
- `POSTGRES_URL` — already points to Docker Postgres; change only for remote DBs
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — at least one LLM provider key

Edit `frontend/.env` and set:
- `VITE_PROXY_TOKEN` — same value as `PROXY_TOKEN` in `backend/.env`

### 4. Run migrations

```bash
cd backend && npm run migrate:up
```

### 5. Run

```bash
# From repo root — starts frontend + legacy proxy + runtime
npm run dev

# Or start the runtime separately
cd backend && npm run runtime:dev
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Legacy proxy | http://localhost:3001 |
| Agent Runtime | http://localhost:4000 |
| Runtime health | http://localhost:4000/health |
| Runtime ready | http://localhost:4000/ready |

## Running Tests

```bash
# Frontend (vitest + coverage — thresholds enforced)
cd frontend && npm run test:coverage

# Backend (jest + real Postgres)
# Requires POSTGRES_URL_TEST to be set in backend/.env
cd backend && npm run migrate:up:test && npm test

# TypeScript typecheck (all packages)
cd backend && npm run typecheck
cd shared-types && npx tsc --noEmit
```

## CI

GitHub Actions runs on every push to `main`/`dev` and on PRs:
- `backend`: tsc typecheck → migrate test DB → jest
- `frontend`: tsc typecheck → vitest coverage (lines/functions/statements ≥80%, branches ≥75%)
- `shared-types`: tsc typecheck

See `.github/workflows/ci.yml`.

## Phases & Agents

| Phase | Agents | Mode |
|-------|--------|------|
| 0 — Orchestration | sdlcOrchestrator | Sequential |
| 1 — PRD | manager | Sequential |
| 1B — Foundation | projectCharter, brd | Sequential |
| 2 — Requirements | stakeholder, userStory, businessRules, feasibility, dataModel | Parallel |
| 3 — Design | architecture, apiDesign, uxResearch, interaction, uxMockups | Parallel |
| 3B — Security Gate | securityCompliance | Sequential |
| 4 — Dev Planning | sprintPlanner, taskBreakdown, techDebt, codeStructure, codeSnippets, uiComponentLibrary, codeReviewStandards, roadmapPlanner | Parallel |
| 5 — Testing | testPlan, testCases | Sequential |
| 6 — Prototype | workingPrototype | Sequential |
| 7 — DevOps | devopsEngineer, infraEngineer | Parallel |
| 8 — Operations | observabilityEngineer, onCallEngineer | Parallel |

## Features

- Multi-project dashboard with domain colour coding
- 30 AI agents producing professional SDLC documents
- Simple/Expert mode (Expert adds review gates + prompt editing)
- Review gates after Phase 1, Phase 2&3, Phase 5, Phase 6
- Export each document as .md or .docx
- IndexedDB storage (per-browser, offline capable)
