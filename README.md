# Agentic SDLC Framework

A browser-based tool that automates the full software development lifecycle using 22 AI agents across 8 phases.

## Quick Start

### Prerequisites
- Node 20+

### Setup

```bash
cd agentic-sdlc

# Install root deps
npm install

# Install backend + frontend deps
npm run install:all

# Copy env files and fill in your keys
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` and set:
- `ANTHROPIC_API_KEY` — your Anthropic API key
- `PROXY_TOKEN` — any strong random string (e.g. `openssl rand -hex 32`)

Edit `frontend/.env` and set the same `VITE_PROXY_TOKEN` value.

### Run

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend proxy: http://localhost:3001

## Phases & Agents

| Phase | Agents | Mode |
|-------|--------|------|
| 1 — Orchestration | manager (PRD) | Sequential |
| 1B — Foundation | projectCharter, brd | Sequential |
| 2 — Requirements | stakeholder, userStory, businessRules, feasibility, dataModel | Parallel |
| 3 — Design | architecture, apiDesign, uxResearch, interaction | Parallel |
| 4 — Dev Planning | sprintPlanner, taskBreakdown, techDebt | Parallel |
| 5 — Testing | testPlan, testCases | Sequential |
| 6 — Security | securityCompliance | Sequential |
| 7 — DevOps | devopsEngineer, infraEngineer | Parallel |
| 8 — Operations | observabilityEngineer, onCallEngineer | Parallel |

## Features

- Multi-project dashboard with domain colour coding
- 22 AI agents producing professional SDLC documents
- Simple/Expert mode (Expert adds review gates + prompt editing)
- Review gates after Phase 1, Phase 2&3, Phase 5, Phase 6
- Export each document as .md or .docx
- IndexedDB storage (per-browser, offline capable)
