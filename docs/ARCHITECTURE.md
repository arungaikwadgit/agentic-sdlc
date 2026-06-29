# Architecture Decision Records

## ADR-001: Use IndexedDB instead of a backend database

**Context:** Multi-user collaboration not required initially; offline support desired.
**Decision:** Dexie.js over IndexedDB.
**Consequences:** No server costs, but data is per-browser. Use backup/restore for portability.

## ADR-002: Staggered parallel agents with concurrency cap

**Context:** OpenAI/Anthropic rate limits (~60 req/min after tuning).
**Decision:** Run parallel phases with a `p-queue` concurrency cap of 3 and a 1.5s stagger between agent starts (see `utils/queue.ts`).
**Consequences:** A full 30-agent run takes 20–35 minutes; acceptable for the planning use case.

## ADR-003: Two-backend architecture (local proxy + production server)

**Context:** Frontend cannot safely hold the API key. Local dev and production have different auth requirements.
**Decision:**
- `backend/` — lightweight Express proxy with PROXY_TOKEN auth, used for local development only.
- `server/` — full Express API with Supabase JWT verification, used for Railway (production) deployment.

**Consequences:** Developers run `backend/` locally. Vercel uses the Supabase anon key (`VITE_SUPABASE_ANON_KEY`); Railway runs `server/` with the service_role key (`SUPABASE_SERVICE_KEY`). The two keys must never be swapped between environments.

## ADR-004: OpenAI gpt-4o as default model

**Context:** Anthropic credit balance issues in development; OpenAI widely available.
**Decision:** Use OpenAI Chat Completions API. Model configurable via `OPENAI_MODEL` env var.
**Consequences:** Response shape differs from Anthropic (choices[].message.content vs content[].text). Frontend `extractText` handles this.

## ADR-005: Markdown-only document renderer (no heavy library)

**Context:** Libraries like `react-markdown` add ~50KB to bundle.
**Decision:** Custom lightweight markdown-to-HTML renderer in `DocumentViewer.tsx`.
**Consequences:** Covers 95% of agent output formatting; edge cases may render imperfectly.

## ADR-006: TOTAL_AGENTS derived dynamically from PHASE_AGENTS

**Context:** Hardcoded agent counts drifted out of sync as agents were added.
**Decision:** `TOTAL_AGENTS = Object.values(PHASE_AGENTS).flat().length` — computed at import time from the authoritative `PHASE_AGENTS` map in `constants.ts`.
**Consequences:** Adding or removing an agent from `PHASE_AGENTS` automatically updates progress tracking. No manual count to maintain.

---

## System Overview

```
Browser (React + Vite)
  └── Dexie.js (IndexedDB)          — project + agent output storage
  └── project.contextDocuments       — uploaded context files (PDF, Word, CSV…)
  └── PipelineEngine.ts             — orchestrates 30 agents across 11 phases
  └── Supabase Auth (anon key)      — user authentication (frontend)
  └── /api/agents/call (fetch proxy)
        └── [Local Dev]  backend/src/proxy.js   (PROXY_TOKEN, localhost:3001)
        └── [Production] server/src/            (Supabase JWT, Railway)
              └── OpenAI API (gpt-4o default)
```

### Pipeline Phases and Agents (30 total)

| Phase | Name | Agents | Parallel? | Review Gate |
|-------|------|--------|-----------|-------------|
| phase0 | SDLC Orchestrator | sdlcOrchestrator (1) | No | — |
| phase1 | PRD | manager (1) | No | gate1 (after phase1 + 1b) |
| phase1b | Foundation | projectCharter, brd (2) | No | gate1 |
| phase2 | Requirements | stakeholder, userStory, businessRules, feasibility, dataModel (5) | **Yes** | gate2 |
| phase3 | Design | architecture, apiDesign, uxResearch, interaction, uxMockups (5) | **Yes** | gate3 (after phase3 + 3b) |
| phase3b | Security Review | securityCompliance (1) | No | gate3 |
| phase4 | Dev Planning | sprintPlanner, taskBreakdown, techDebt, codeStructure, codeSnippets, uiComponentLibrary, codeReviewStandards, roadmapPlanner (8) | **Yes** | — |
| phase5 | Testing | testPlan, testCases (2) | No | gate5 |
| phase6 | Prototype | workingPrototype (1) | No | gate6 (exploratory — no approval required) |
| phase7 | DevOps | devopsEngineer, infraEngineer (2) | **Yes** | — |
| phase8 | Operations | observabilityEngineer, onCallEngineer (2) | **Yes** | — |

**Total: 30 agents, 11 phases, 5 active review gates.**

Parallel phases run with a max concurrency of 3 (p-queue). Sequential phases run one agent at a time.

---

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/agents/constants.ts` | Phase order, parallel phases, PHASE_AGENTS map, review gates, TOTAL_AGENTS |
| `frontend/src/agents/definitions.ts` | All 30 agent system/user prompts |
| `frontend/src/agents/promptDefaults.ts` | Shared instructions injected into every agent prompt |
| `frontend/src/agents/domains.ts` | Domain knowledge stores |
| `frontend/src/services/pipelineEngine.ts` | Phase orchestration, review gates, resume, concurrency |
| `frontend/src/db/database.ts` | Dexie schema and version migrations |
| `frontend/src/db/projectRepository.ts` | Dexie CRUD with optimistic concurrency |
| `frontend/src/services/api.ts` | API client: calls /api/agents/call, friendly error messages |
| `frontend/src/services/traceability.ts` | Requirements ↔ Stories ↔ Tests CSV |
| `frontend/src/services/exporters/` | .md, .docx, .xlsx export |
| `frontend/src/components/pipeline/AgentContextUploader.tsx` | Context file upload (PDF, Word, CSV, etc.) with IndexedDB persistence |
| `frontend/src/components/documents/MockupPreview.tsx` | Live HTML mockup renderer with style editor |
| `backend/src/proxy.js` | Local dev Express proxy (PROXY_TOKEN auth) |
| `server/src/` | Production Express API (Supabase JWT auth, Railway) |

---

## Security Constraints

| Key | Location | Scope |
|-----|----------|-------|
| `VITE_SUPABASE_ANON_KEY` | `frontend/.env` → Vercel env | Public/anon — safe in browser |
| `SUPABASE_SERVICE_KEY` | `server/.env` → Railway env | Secret — server only, never frontend |
| `PROXY_TOKEN` | `backend/.env` | Local dev only — never committed |
| `VITE_PROXY_TOKEN` | **Not used** | Removed — must not appear in any frontend env file |

The frontend never holds a secret key. All LLM calls go through the proxy/server, which validates either the Supabase JWT (production) or the PROXY_TOKEN header (local dev).
