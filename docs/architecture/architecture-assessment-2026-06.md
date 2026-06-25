# agentic-sdlc — Architecture Assessment & Target Design

**Date:** 2026-06-11
**Scope:** This assessment was reframed during review. The repo already has a working frontend/backend split (`frontend/` React+Vite SPA, `backend/` Express proxy, `docker/` build). The real gaps are:

1. No persistent/shared database — all project, team, and settings data lives in browser IndexedDB (Dexie), per-browser, not shareable across users or devices.
2. No domain API — the backend is a thin OpenAI proxy with no concept of projects, users, or roles.
3. No shared types between frontend and backend.
4. (Added during this review, user-confirmed) The backend should become a real **multi-provider LLM gateway** (OpenAI + Claude), own the **agent prompt library** (app-level defaults + project-level overrides), and enforce **role-based access control (RBAC)** on its APIs.

Everything below is written against this scope. Sections 4-6 are not yet drafted in this pass; they continue in this same file.

---

## 1. Codebase Assessment (summary)

| Area | Current state | Implication |
|---|---|---|
| Frontend | React 18 + Vite + TS, 7,856 LOC in `frontend/src`, CSS Modules, Dexie/IndexedDB for all persistence | Solid SPA, but is the system of record — must become a client of a real API |
| Backend | `backend/src/proxy.js`, ~370 lines, Express. Endpoints: `/api/health`, `/api/agent` (OpenAI chat completions), `/api/fetch-site` (branding scrape), `/api/github/test`, `/api/github/issues`, `/api/settings` (writes `backend/.env`) | No DB, no auth, no domain model — purely a credential-hiding proxy |
| Auth | `Project.activeAdminId` — "no password, just selection" of a team member as admin | Not real auth; anyone with the browser can become admin |
| Prompts | `frontend/src/agents/definitions.ts` (hardcoded defaults), `frontend/src/agents/promptDefaults.ts` (app-level overrides in Dexie `settings`), `Project.promptOverrides[]` (project-level, JSON Patch or full replacement) | All prompt logic and storage is client-side |
| LLM provider | OpenAI only, via `backend/.env` `OPENAI_API_KEY`/`OPENAI_MODEL` | `AgentRun.tokensUsed` comment says "from Anthropic response" — Claude support appears to have been originally intended but never wired up |
| Deployment | `docker/Dockerfile` (3-stage: frontend build → backend deps → final image running both `serve` and `node proxy.js`), `docker-compose.yml` (single `app` service) | No DB service/volume defined |
| Security findings | `.env` files not gitignored; `checkToken` middleware is a no-op if `PROXY_TOKEN` unset; CORS is `origin: '*'` | All must be addressed in target design |

---

## 2. Target Architecture

### 2.1 Overview of the change

The backend (`backend/`) evolves from "OpenAI proxy" into a real **domain + AI-gateway service**:

```
┌─────────────────────────────┐        ┌──────────────────────────────────────┐
│   Frontend (React/Vite SPA)  │        │   Backend (Express, Node)             │
│                               │        │                                        │
│  - UI screens                │  HTTPS │  ┌──────────────┐  ┌─────────────────┐ │
│  - Calls domain API only      │◄──────►│  │ Domain API    │  │ LLM Gateway     │ │
│  - No direct Dexie writes for │        │  │ /api/projects │  │ /api/agent      │ │
│    projects/users/prompts     │        │  │ /api/users    │  │  -> provider    │ │
│  - Local cache only (optional)│        │  │ /api/roles    │  │     adapter     │ │
│                               │        │  │ /api/prompts  │  │  (OpenAI/Claude)│ │
└───────────────────────────────┘        │  └──────┬───────┘  └────────┬────────┘ │
                                          │         │                    │          │
                                          │  ┌──────▼────────────────────▼───────┐ │
                                          │  │ Auth & RBAC middleware             │ │
                                          │  └──────┬─────────────────────────────┘ │
                                          │         │                                │
                                          │  ┌──────▼───────┐                       │
                                          │  │ DB layer      │                       │
                                          │  │ (Postgres or  │                       │
                                          │  │  SQLite)      │                       │
                                          │  └───────────────┘                       │
                                          └──────────────────────────────────────────┘
```

Key principle: **the frontend stops being the system of record.** Dexie may remain as an offline cache/queue (optional, Phase 5+), but projects, users, roles, and prompts are owned by the backend DB.

### 2.2 Database

Recommendation: **Postgres** for real deployments, with **SQLite** as the dev/local default (via an ORM that supports both, e.g. Prisma or Drizzle) so the existing "clone and run" dev experience isn't lost.

Tables (mapped from existing Dexie schema + new RBAC/prompt requirements):

| Table | Purpose | Source / notes |
|---|---|---|
| `users` | Replaces ad-hoc `TeamMember` + `activeAdminId`. Has `id`, `email`, `password_hash`, `name`, `avatar_color`, `created_at` | New — real accounts |
| `roles` | `id`, `name` (e.g. `admin`, `product-manager`, `tech-lead`, ... mirrors `ROLE_TEMPLATES`), `permissions` (JSON or join table) | New — derived from `frontend/src/data/roleTemplates.ts` (`ROLE_TEMPLATES`, 11 templates) |
| `user_roles` | many-to-many `user_id` ↔ `role_id`, optionally scoped per `project_id` | New |
| `projects` | Mirrors `Project` type minus `teamMembers`/`agentAssignments` (now relational) — `id`, `name`, `description`, `domain`, `status`, `version`, `current_phase`, `mode`, `domain_knowledge`, `branding_guidelines`, `disabled_role_ids`, `archived*`, `github_integration_id`, `created_at`, `updated_at` | From `frontend/src/types/project.types.ts` |
| `project_members` | Replaces `Project.teamMembers[]` — `project_id`, `user_id`, `role_id` | New relational form of `TeamMember` |
| `agent_assignments` | Replaces `Project.agentAssignments[]` — `project_id`, `agent_id`, `user_id` (was `memberIds[]`, now one row per member) | From `AgentAssignment` |
| `agent_runs` | Replaces `Project.agentRuns` map — `project_id`, `agent_id`, `status`, `output`, `error`, `started_at`, `completed_at`, `tokens_used`, `provider` (new), `model` (new) | From `AgentRun` + provider tracking |
| `review_gates` | Replaces `Project.reviewGates` map — `project_id`, `gate_id`, `after_phases` (JSON), `approved`, `approved_at`, `approved_by` (FK users) | From `ReviewGate` |
| `prompt_defaults` | App-level prompt library — `agent_id` (PK), `system_prompt`, `provider_hint`, `updated_at`, `updated_by` | Replaces `frontend/src/agents/promptDefaults.ts` (currently Dexie `settings['app:promptDefaults']`) |
| `prompt_overrides` | Project-level — `project_id`, `agent_id`, `patch` (JSON, RFC 6902), `full_prompt`, `updated_at`, `updated_by` | From `Project.promptOverrides[]` |
| `integrations` | GitHub credentials etc. — `id`, `project_id`, `type`, `encrypted_payload`, `created_at` | From Dexie `integrations` table — **must be encrypted at rest**, currently stored plaintext in IndexedDB |
| `settings` | Remaining app-wide settings (theme, telemetry flag) — `key`, `value` (JSON) | From Dexie `settings` table |

Optimistic concurrency: keep the existing `version` integer column on `projects`, incremented on every update (matches current `updateProject` behavior).

### 2.3 LLM Gateway (multi-provider)

New module: `backend/src/llm/` with a provider-agnostic interface:

```ts
// backend/src/llm/types.ts
interface LlmProvider {
  name: 'openai' | 'claude';
  chatCompletion(req: {
    systemPrompt: string;
    userPrompt: string;
    model?: string;
    maxTokens?: number;
  }): Promise<{ text: string; tokensUsed: number; model: string }>;
}
```

- `backend/src/llm/openaiProvider.js` — wraps existing `httpsPost` logic currently in `proxy.js` (OpenAI chat completions endpoint).
- `backend/src/llm/claudeProvider.js` — new, calls Anthropic Messages API (`https://api.anthropic.com/v1/messages`), using `ANTHROPIC_API_KEY`. **Note:** the README already references `ANTHROPIC_API_KEY` even though it's unused today — this closes that doc/code gap.
- `backend/src/llm/index.js` — `getProvider(name)` factory + `resolveProviderForAgent(agentId, project)` — resolution order: per-agent override (new `prompt_defaults.provider_hint` or a project-level setting) → project-level default provider → global default (env var `DEFAULT_LLM_PROVIDER`).

`/api/agent` (existing endpoint) is extended:
- Request body adds optional `provider` field (`'openai' | 'claude'`); if omitted, server resolves per the rule above.
- Response includes `provider` and `model` actually used, plus `tokensUsed` (so `AgentRun.tokensUsed`/`provider`/`model` can be persisted accurately — this also retroactively makes the existing "from Anthropic response" comment in `agent.types.ts` correct).
- `testMode` short-circuit behavior is preserved per-provider (each adapter implements its own mock response for tests).

Env vars (additions to `backend/.env.example`):
```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
DEFAULT_LLM_PROVIDER=openai   # or claude
```

> **2026-06 interim implementation note**: a lightweight version of this section shipped ahead of the
> full Phase 2 migration, directly in `proxy.js` (no `backend/src/llm/` module split yet, no DB —
> still `.env`-based config and Dexie `settings` for app-level routing hints). Env var names and the
> `/api/agent` request/response contract (`provider`/`model` in and out) match this section exactly,
> so Phase 2 can replace the in-`proxy.js` implementation with the `backend/src/llm/` module structure
> without changing the contract the frontend already depends on. Specifics:
> - `ANTHROPIC_ENABLED=true|false` (new) gates Claude — defaults to `false`/disabled even if a key is present, so enabling it is explicit.
> - `AGENT_PROVIDER_MAP` (new, JSON env var, e.g. `{"uxMockups":"claude"}`) is the interim stand-in for `prompt_defaults.provider_hint` — per-agent routing hints. Also mirrored client-side in Dexie (`app:agentProviderHints`, via `frontend/src/agents/promptDefaults.ts`) and sent per-request as `provider` on `/api/agent`.
> - Resolution order implemented: request `provider` → `AGENT_PROVIDER_MAP[agentId]` → `DEFAULT_LLM_PROVIDER` → fallback to `openai` if Claude is hinted/requested but `ANTHROPIC_ENABLED` is false.
> - `AppSettingsModal.tsx` (`api` tab) gained: Claude API key field, enable toggle, Claude model select, default-provider select, and a per-agent provider routing table (grouped by phase, using existing `PHASE_ORDER`/`PHASE_AGENTS`/`PHASE_LABELS`).
> - Still pending from Phase 2: DB-backed `prompt_defaults.provider_hint`, `agent_runs.provider`/`model` persistence, server-only key storage (admin-gated), and the `backend/src/llm/` module split.

### 2.4 Prompt library service

New endpoints under `/api/prompts`:

| Method | Path | Purpose | RBAC |
|---|---|---|---|
| `GET` | `/api/prompts/defaults` | List all app-level default prompts (one per `AgentId`) | any authenticated user (read) |
| `PUT` | `/api/prompts/defaults/:agentId` | Update the app-level default prompt for an agent | `admin` only |
| `DELETE` | `/api/prompts/defaults/:agentId` | Reset to hardcoded `AGENT_DEFINITIONS` value | `admin` only |
| `GET` | `/api/projects/:id/prompts` | List project-level overrides | project member |
| `PUT` | `/api/projects/:id/prompts/:agentId` | Set/replace a project-level override (`fullPrompt` or `patch`) | project member with `edit_prompts` permission (e.g. tech-lead, admin) |
| `DELETE` | `/api/projects/:id/prompts/:agentId` | Remove a project-level override | same as above |

`pipelineEngine.runAgent`'s existing precedence order is preserved, just resolved server-side now:
1. `prompt_overrides` (project-level, `full_prompt` > `patch` applied to default)
2. `prompt_defaults` (app-level)
3. `AGENT_DEFINITIONS[agentId].systemPrompt` (hardcoded fallback, ships in backend code as a seed/reference, not editable without DB)

The hardcoded `AGENT_DEFINITIONS` (currently `frontend/src/agents/definitions.ts`) becomes a **shared package** (see 2.6) so both frontend (for display/UI labels: `name`, `description`, `outputLabel`) and backend (for the fallback `systemPrompt` and `buildUserPrompt`) use the same source.

### 2.5 Auth & RBAC

New module: `backend/src/auth/`.

- **Authentication**: session-based (signed httpOnly cookie) or JWT — recommend httpOnly cookie + short-lived JWT for simplicity with a small team-facing tool, avoiding the need for refresh-token UX. `POST /api/auth/login` (email + password), `POST /api/auth/logout`, `GET /api/auth/me`.
- **Password storage**: bcrypt/argon2 hash in `users.password_hash`. (First-run: a seed script creates an initial admin user — replaces the current "first team member becomes admin" pattern.)
- **Roles**: seed `roles` table from `ROLE_TEMPLATES` (11 templates: product-manager, tech-lead, ux-designer, project-manager, scrum-master, qa-engineer, security-engineer, devops-engineer, sre, engineering-manager, architect) plus a new `admin` role with full access.
- **Permission model**: simple capability list per role, e.g.:
  - `admin`: all permissions, including user management, prompt-defaults editing, settings.
  - `tech-lead`, `architect`: `edit_prompts`, `run_pipeline`, `manage_project`.
  - Other roles: `run_pipeline` (for their assigned agents only), `view_project`.
  - Everyone: `view_project` for projects they're a member of.
- **Middleware**: `requireAuth` (valid session) and `requireRole(...)` / `requirePermission(...)` applied per-route. `/api/health` stays open (no auth) for container healthchecks.
- **Migration of `activeAdminId`**: the "no password, just selection" admin concept is removed. Existing projects' `teamMembers` with `isAdmin: true` become seed data for the `users`/`user_roles` tables during the data migration (Phase 4), but each such user must set a password on first login (or an admin issues invites).

### 2.6 Shared types

New workspace package `shared/` (or `packages/shared-types/` if moving to a monorepo layout with npm workspaces):

- `shared/types/agent.types.ts` — `AgentId`, `AgentStatus`, `PhaseId`, `AgentRun`, `AgentDefinition`, `AgentPromptContext` (moved from `frontend/src/types/agent.types.ts`, extended with `provider`/`model` fields on `AgentRun`)
- `shared/types/project.types.ts` — `Project`, `ProjectSummary`, `ReviewGate`, `PromptOverride` etc. (moved from `frontend/src/types/project.types.ts`), with `teamMembers`/`agentAssignments` arrays kept for API response shape even though the DB is relational (API serializes joins back into these shapes for frontend compatibility — minimizes frontend rewrite)
- `shared/types/auth.types.ts` — new: `User`, `Role`, `Permission`, `Session`
- `shared/agents/definitions.ts` — `AGENT_DEFINITIONS` (moved from `frontend/src/agents/definitions.ts`)
- `shared/data/roleTemplates.ts` — `ROLE_TEMPLATES`, `COVERED_AGENTS`, `buildTeamRoster` (moved from `frontend/src/data/roleTemplates.ts`)

Both `frontend/package.json` and `backend/package.json` depend on `shared` via a workspace reference (`"shared": "workspace:*"` if using npm/pnpm workspaces, or a relative `file:` dependency as a lighter-weight option that avoids a full monorepo restructure).

### 2.7 API design (domain endpoints, new)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login`, `/api/auth/logout` | Session management |
| `GET` | `/api/auth/me` | Current user + roles |
| `GET/POST` | `/api/users` | List/create users (admin) |
| `GET/PUT/DELETE` | `/api/users/:id` | Manage a user (admin) |
| `GET` | `/api/roles` | List roles + permissions |
| `GET/POST` | `/api/projects` | List projects (filtered to ones the user is a member of, unless admin) / create project |
| `GET/PUT/DELETE` | `/api/projects/:id` | Read/update/archive a project |
| `GET/POST/DELETE` | `/api/projects/:id/members` | Manage `project_members` |
| `GET/PUT` | `/api/projects/:id/assignments` | Manage `agent_assignments` |
| `POST` | `/api/projects/:id/agent-runs/:agentId/run` | Trigger one agent (replaces direct `pipelineEngine` calls to `/api/agent` — engine now orchestrates server-side or frontend still drives but always through this endpoint) |
| `GET` | `/api/projects/:id/agent-runs` | Current state of all agent runs for a project |
| `GET/PUT` | `/api/projects/:id/review-gates/:gateId` | Read/approve a review gate |
| `GET/PUT/DELETE` | `/api/prompts/defaults[/:agentId]`, `/api/projects/:id/prompts[/:agentId]` | Prompt library (2.4) |
| `POST` | `/api/agent` | Low-level LLM call (existing, extended per 2.3) — retained for direct/manual use but normal pipeline flow goes through `/agent-runs/:agentId/run` |
| existing | `/api/fetch-site`, `/api/github/test`, `/api/github/issues` | Unchanged, but now behind `requireAuth` |
| `GET/PUT` | `/api/settings` | App-wide settings — **must stop writing `backend/.env` via `fs.writeFileSync`** (current finding); becomes DB-backed `settings` table, admin-only |

### 2.8 Deployment model

`docker-compose.yml` gains a `db` service:

```yaml
services:
  app:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    ports: ["3000:3000", "3001:3001"]
    environment:
      - DATABASE_URL=postgres://app:app@db:5432/agentic_sdlc
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DEFAULT_LLM_PROVIDER=${DEFAULT_LLM_PROVIDER:-openai}
      - PROXY_TOKEN=${PROXY_TOKEN}
      - SESSION_SECRET=${SESSION_SECRET}
    depends_on: [db]
    restart: unless-stopped
  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=app
      - POSTGRES_DB=agentic_sdlc
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata:
```

`docker/Dockerfile` gains a migration step on container start (e.g. `npx prisma migrate deploy` or equivalent) before launching `proxy.js`. Local dev keeps SQLite (`DATABASE_URL=file:./dev.db`) so `npm run dev` still works without Docker/Postgres.

---

## 3. Agentic AI Architecture

This section documents how agentic AI is used in the core SDLC pipeline — how agents plan, choose tools, replan, and execute to produce their outputs. The application implements two distinct tiers of agentic behaviour, plus a macro-level pipeline orchestration layer that governs the overall flow.

---

### 3.1 The Two-Tier Agent Model

Every one of the 26 agents in the pipeline falls into one of two tiers:

| Tier | Name | How it works | When to use |
|---|---|---|---|
| **L2** | Single-shot | System prompt + user prompt → one LLM call → output | Deterministic document generation where prior outputs provide enough context (the majority of agents) |
| **L3** | Iterative loop | Plan → Act (tool call) → Observe (result) → Revise → repeat → Done | Agents that need to gather information, validate choices, or search before writing (e.g. UX Mockups, Code Snippets, Observability Engineer) |

The runtime detects tier at startup: if an `AgentDefinition` has both a `goal` function and a non-empty `tools` array, it routes through the L3 runtime (`services/l3Runtime.ts`). Otherwise it calls the LLM once (`api.callAgent`).

---

### 3.2 L2 — Single-Shot Agent Flow

The majority of agents use L2. Each agent run follows this sequence:

```
┌─────────────────────────────────────────────────────────────┐
│  1. BUILD CONTEXT (PipelineEngine.buildContext)              │
│     Project name + description + domain                      │
│     + domain knowledge (project.domainKnowledge + registry) │
│     + prior outputs from ALL completed upstream agents       │
│     + team roster (member names, roles, agent assignments)   │
│     + branding guidelines (if set)                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  2. RESOLVE SYSTEM PROMPT (3-level precedence)               │
│     1st: project-level promptOverride.fullPrompt (if any)   │
│     2nd: app-level promptDefaults[agentId] (App Settings)   │
│     3rd: hardcoded AGENT_DEFINITIONS[agentId].systemPrompt  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  3. BUILD USER PROMPT                                        │
│     AgentDefinition.buildUserPrompt(ctx) — agent-specific   │
│     template that injects context into the prompt body      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  4. ROUTE TO PROVIDER (per-agent or global hint)             │
│     Resolution: request.provider → AGENT_PROVIDER_MAP →     │
│     DEFAULT_LLM_PROVIDER → openai (fallback)                │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  5. CALL LLM → EXTRACT TEXT → PERSIST                        │
│     api.callAgent({ systemPrompt, userPrompt, provider })    │
│     updateAgentRun(projectId, agentId, { status: 'complete', │
│       output, tokensUsed, provider, model })                 │
└─────────────────────────────────────────────────────────────┘
```

**Key design choice:** prior outputs are passed as a flat map keyed by `AgentId`. Each agent's `buildUserPrompt` decides which prior outputs to include and how to frame them. This gives each agent full access to everything the pipeline has produced so far without imposing a fixed "read exactly these upstream outputs" constraint at the engine level.

---

### 3.3 L3 — Iterative Plan-Act-Observe-Revise Loop

L3 agents implement a lightweight ReAct-style loop (Yao et al., 2022) without requiring native function-calling APIs — the protocol is entirely text-based, meaning it works identically across OpenAI and Claude:

```
┌──────────────────────────────────────────────────────────────────┐
│  INITIALISE                                                       │
│  Build goal + initial plan steps + tools block                   │
│  Inject into extended system prompt (L3 AGENT MODE header)       │
│  Conversation history = [system, user]                           │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  ITERATION LOOP (max N iterations, configurable)                  │
│                                                                   │
│  ┌─── LLM CALL ──────────────────────────────────────────────┐  │
│  │  Send conversation history to LLM                         │  │
│  │  Parse response for protocol markers:                     │  │
│  │                                                           │  │
│  │  TOOL_CALL: <name>        → ACT phase                     │  │
│  │  { "arg": "value" }                                       │  │
│  │                                                           │  │
│  │  PLAN_REVISION: <reason>  → REVISE phase                  │  │
│  │  STEPS: 1. ... 2. ...                                     │  │
│  │                                                           │  │
│  │  FINAL_OUTPUT:            → DONE                          │  │
│  │  <document>                                               │  │
│  │                                                           │  │
│  │  (no marker found)        → treat as FINAL_OUTPUT         │  │
│  │                           (graceful L2 degradation)       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  IF TOOL_CALL:                                                    │
│    Execute tool → append tool result to conversation             │
│    Record ToolTraceEntry { tool, args, result, durationMs }      │
│    Loop back ↑                                                    │
│                                                                   │
│  IF PLAN_REVISION:                                                │
│    Record PlanRevision { reason, steps, iteration }              │
│    Append revision acknowledgement to conversation               │
│    Loop back ↑                                                    │
│                                                                   │
│  IF FINAL_OUTPUT or maxIterations:                                │
│    Extract content after FINAL_OUTPUT: marker                    │
│    Exit loop                                                      │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  PERSIST                                                          │
│  updateAgentRun({ status: 'complete', output, l3: {              │
│    iterations, toolTrace[], planRevisions[], finalizedAt } })     │
└──────────────────────────────────────────────────────────────────┘
```

**Protocol markers** are plain-text conventions injected into the system prompt. The LLM is instructed to emit exactly `TOOL_CALL: <name>` followed by a JSON args line when it wants to call a tool, and `FINAL_OUTPUT:` when it is ready to write the final document. This avoids requiring OpenAI `tool_use` or Anthropic `tools` API features, keeping the loop provider-agnostic.

**Graceful degradation:** if the LLM emits a well-formed response without any marker, `parseResponse` treats the entire text as `FINAL_OUTPUT`. This means an L3-capable agent silently degrades to L2 behaviour if the LLM ignores the agentic protocol — no crash, just a single-shot result.

**What gets traced:** the full `L3RuntimeMeta` (iteration count, every tool call with args and result, every plan revision with reason and steps) is persisted to `agentRun.l3`. This trace is available for inspection and debugging in the agent's run record.

---

### 3.4 Available Tools

L3 agents are equipped with tools from three groups defined in `agents/tools.ts`:

| Group | Tools | Purpose |
|---|---|---|
| `ALL_TOOLS` | `search_web`, `read_url`, `read_prior_output`, `get_domain_knowledge` | General-purpose context gathering |
| `CONTEXT_TOOLS` | `read_prior_output`, `get_domain_knowledge`, `get_team_roster` | Reading from the project's already-assembled context without external calls |
| `RESEARCH_TOOLS` | `search_web`, `read_url` | Live web research for agents that need current information (e.g. tech stack lookups, real-world design patterns) |

Each `AgentDefinition` declares which tool group it uses via the `tools` field. The L3 runtime dispatches tool calls to the corresponding implementation and appends results to the conversation before the next LLM call.

---

### 3.5 Macro-Level Orchestration: Plan-and-Execute

Above the per-agent loop sits the pipeline engine (`services/pipelineEngine.ts`), which implements a **Plan-and-Execute** orchestration pattern:

```
┌──────────────────────────────────────────────────────────────────┐
│  PHASE 0: SDLC Orchestrator (L2 agent)                           │
│  Reads project context → produces an SDLC Orchestration Plan     │
│  (goal decomposition, phase sequencing, risk register,           │
│   per-agent dependency map, replan triggers)                     │
│  Output consumed by team + downstream agents as shared context   │
└────────────────────────┬─────────────────────────────────────────┘
                         │  plan complete
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  PipelineEngine.run(startFromPhase?)                             │
│                                                                   │
│  FOR each phase in PHASE_ORDER [phase0 → phase8]:                │
│    IF a review gate is required before this phase:               │
│      Check gate.approved → if not approved: PAUSE                │
│      → emit onGateReached(gateId) → set status='paused'         │
│      → return  (human must approve in UI to resume)             │
│                                                                   │
│    IF phase is in PARALLEL_PHASES:                               │
│      Run all phase agents concurrently via p-queue (max 3)       │
│    ELSE:                                                          │
│      Run agents sequentially                                      │
│                                                                   │
│    IF a review gate fires AFTER this phase:                      │
│      Emit onGateReached(gateId) → PAUSE                          │
│      Set currentPhase = next phase (so resume starts there)      │
│      → return                                                     │
│                                                                   │
│  Pipeline complete → set status='complete'                       │
└──────────────────────────────────────────────────────────────────┘
```

**Review gates as explicit replan checkpoints:** Four gates (after Phase 1b, after Phase 3, after Phase 5, after Phase 6) force the pipeline to pause and surface the accumulated agent outputs to a human reviewer. The reviewer can approve and continue, or trigger a re-run of any agent with an edited prompt — which implements the "replan" step: the human observes the output quality, decides the result is inadequate, edits the prompt (or the system prompt override), and re-runs the agent. If the re-run agent's phase is covered by a gate, that gate is automatically reset to unapproved and must be re-approved, enforcing a forward-only consistency guarantee.

**Resume and idempotency:** `PipelineEngine.runAgent` skips any agent whose run status is already `'complete'`. This means the pipeline can be paused, restarted, or interrupted at any point and resumed without re-running agents that have already succeeded — the project's `currentPhase` and each agent's `status` in IndexedDB are the authoritative state.

---

### 3.6 Agentic Flow Summary: How a Real Pipeline Run Works

A complete pipeline run for a new project traverses the following sequence:

```
User creates project (name, description, domain, team)
    │
    ▼
Phase 0 — SDLC Orchestrator
  L2: reads project context, produces orchestration plan
  Output: phase sequencing, risk register, per-agent guidance
    │
    ▼
Phase 1 — Project Manager (sequential)
  L2: produces project management plan
    │
Phase 1b — Project Charter + BRD (sequential)
  L2: two agents, each reads Phase 1 output + project context
    │
  ┌─ REVIEW GATE 1 ─────────────────────────────────────────────┐
  │  Human reviews Phase 1/1b outputs → approves or re-runs     │
  └──────────────────────────────────────────────────────────────┘
    │  (approved)
    ▼
Phase 2 — Analysis (5 agents, PARALLEL, p-queue concurrency=3)
  L2/L3: Stakeholder, User Stories, Business Rules, Feasibility,
         Data Model — each reads all prior complete outputs
    │
Phase 3 — Design (5 agents, PARALLEL)
  L2/L3: Architecture, API Design, UX Research, Interaction,
         UX Mockups — each reads prior complete outputs
    │
  ┌─ REVIEW GATE 2/3 ────────────────────────────────────────────┐
  │  Human reviews Phase 2+3 outputs → approves or re-runs       │
  └───────────────────────────────────────────────────────────────┘
    │  (approved)
    ▼
Phase 4 — Dev Planning (6 agents, PARALLEL)
  L2/L3: Sprint Planner, Task Breakdown, Tech Debt, Code
         Structure, Code Snippets, UI Component Library
    │
Phase 5 — Testing (2 agents, sequential)
  L2: Test Plan, Test Cases
    │
  ┌─ REVIEW GATE 5 ─────────────────────────────────────────────┐
  │  Human reviews Phase 5 outputs → approves or re-runs        │
  └──────────────────────────────────────────────────────────────┘
    │  (approved)
    ▼
Phase 6 — Security (1 agent, sequential)
  L2: Security Compliance
    │
  ┌─ REVIEW GATE 6 ─────────────────────────────────────────────┐
  │  Human reviews Phase 6 output → approves or re-runs         │
  └──────────────────────────────────────────────────────────────┘
    │  (approved)
    ▼
Phase 7 — DevOps (2 agents, PARALLEL)
  L2/L3: DevOps Engineer, Infra Engineer
    │
Phase 8 — Operations (2 agents, PARALLEL)
  L2/L3: Observability Engineer, On-Call Engineer
    │
    ▼
Pipeline complete — status='complete'
All 26 agent outputs available for export (ZIP, DOCX, XLSX, CSV)
```

Each agent in the pipeline has access to the outputs of every agent that completed before it (passed as `priorOutputs` in `AgentPromptContext`). This is how later-phase agents build on earlier ones — the Data Model agent can see the BRD, the API Design agent can see the Data Model, the Sprint Planner can see the Architecture, and so on. The context accumulates automatically; no manual wiring is needed between agents.

---

### 3.7 Where This Fits in the Canonical Agentic AI Taxonomy

| Canonical pattern | Where it appears in this application |
|---|---|
| **ReAct** (Reason + Act, interleaved) | L3 agent runtime — the per-agent Plan/Act/Observe/Revise loop in `l3Runtime.ts` |
| **Plan-and-Execute** (plan once, execute, replan on divergence) | Pipeline engine — Phase 0 produces the macro plan; review gates are explicit replan checkpoints; agent re-runs with edited prompts are the replan action |
| **Reflection** (self-critique before output) | Embedded in L3 agents via the PLAN_REVISION marker — agent revises its own plan when tool results reveal a gap |
| **Multi-agent orchestration** | The pipeline itself — 26 specialist agents, each with a defined role, chained by output-as-context |
| **Human-in-the-loop** | Review gates after phases 1b, 3, 5, 6 — human observes, approves or triggers re-run |
| **Tool use** | L3 agents — `search_web`, `read_url`, `read_prior_output`, `get_domain_knowledge`, `get_team_roster` |

The combination of Plan-and-Execute at the macro level with ReAct at the agent level is the key architectural choice: the pipeline is deterministic and predictable (phases run in order, gates enforce human checkpoints), while individual agents that need to gather information or validate choices before writing can do so autonomously within their allocated iteration budget.

---

## 4. UX/UI Redesign

Approach: **improve existing screens**, don't replace. Applied the `ui-ux-pro-max` checklist categories that are platform-agnostic (Accessibility, Layout/Responsive, Typography/Color, Forms/Feedback, Navigation) against each existing screen, and specced the new screens required by auth/RBAC and the prompt library. Mobile-specific guidance (bottom-nav limits, gestures, safe-area) is not applicable — this is a desktop web app — and was skipped.

### 3.1 Screen inventory (existing, with changes)

| Screen / Component | Purpose | Key changes needed |
|---|---|---|
| `Dashboard.tsx` | Multi-project list, domain color coding, archive toggle, export/import | Data now from `GET /api/projects` (server-filtered to user's projects unless admin). Export/import becomes a server-side backup endpoint (`GET/POST /api/admin/backup`) — client-side Blob export of `db.projects` no longer makes sense once projects are shared. **Add**: empty state when user has zero projects ("You're not on any projects yet — ask an admin to add you, or create one"); loading skeleton while `GET /api/projects` resolves; error state if the API call fails (network/auth). |
| `NewProjectModal.tsx` | Create a project | `POST /api/projects`, payload extended (2026-06) with `owner` (required), `team`, `projectType`, `priority`, `startDate`, `targetEndDate`, `techStack`, `targetUsers`, `initialRisks` — see `projects` table additions in 6.5. Creator is automatically added to `project_members` with their role. |
| `ProjectCard.tsx` | Summary card per project | Add a small role/member-avatar cluster (who's on this project) — data now available from `project_members` join. |
| `ProjectWorkspace.tsx` | Main pipeline view — phases, agent runs, gates | Agent run triggers go through `POST /api/projects/:id/agent-runs/:agentId/run`. **Add**: per-agent-run badge showing which provider/model was used (new `agent_runs.provider`/`model` columns) — small but useful for cost/quality debugging. Loading state per agent card already exists (status='running'); ensure error state surfaces `agent_runs.error` from the API, not just local state. |
| `ReviewGateModal.tsx` | Approve/reject phase gates | `PUT /api/projects/:id/review-gates/:gateId`. `approvedBy` now a real user id — show actual user name/avatar instead of placeholder. |
| `TeamPanel.tsx` | Manage team members + agent assignments | Becomes **two concerns**: (1) project membership — `GET/POST/DELETE /api/projects/:id/members`, picks from real `users` (org directory), not free-text name/email entry; (2) agent assignment — unchanged UX, now backed by `agent_assignments` table. **Permission check**: only users with `manage_project` permission see add/remove controls; others see read-only roster. |
| `AppSettingsModal.tsx` (tab: `api`) | API key / model config | Split: API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) move to a server-only admin screen (never sent to browser). Model picker (`MODELS` list) gains a **provider toggle** (OpenAI / Claude) — each provider shows its own model list. Visible only to `admin` role. |
| `AppSettingsModal.tsx` (tab: `prompts`) | Edit app-level agent prompt defaults | Becomes **Prompt Library** screen (3.3) — `GET/PUT/DELETE /api/prompts/defaults[/:agentId]`, admin-only. |
| `AppSettingsModal.tsx` (tab: `domains`, `appearance`, `projects`) | Domain knowledge defaults, theme, project admin (delete/restore) | `domains`: becomes admin-managed via API (same shape, server-backed). `appearance`: stays local (theme is a per-browser preference, fine to keep in `localStorage`/Dexie `settings`). `projects` (delete/restore/archive list): becomes `GET /api/projects?archived=true` + `PUT /api/projects/:id` (admin only). |
| `ExportMenu.tsx`, `DocumentViewer.tsx`, `GithubPushModal.tsx` | Document export, GitHub push | Largely unchanged — these operate on agent outputs already fetched via the API. `GithubPushModal` still calls `/api/github/*`, now behind `requireAuth`. |
| `ResumeModal.tsx` | "Interrupted pipeline" resume prompt | `runningProjects` query becomes `GET /api/projects?status=running` scoped to the user's projects. Same UX. |

### 3.2 New screen: Login

- **Purpose**: authenticate before any project data loads.
- **Layout**: centered card, max-width ~400px, app logo/name, email + password fields, "Sign in" button, error message area below the form (not a toast — persists until corrected).
- **States**:
  - *Empty*: fields blank, button disabled until both fields non-empty (basic client-side validation, real validation server-side).
  - *Loading*: button shows spinner + "Signing in…", fields disabled.
  - *Error*: inline message "Incorrect email or password" (generic — do not reveal which field was wrong, standard practice to avoid account enumeration).
- **Accessibility**: labels associated via `for`/`id` (current modals use placeholder-only inputs in places — this screen should set the standard going forward), visible focus ring on inputs/button (check against existing `--accent` color contrast on `--surface` background — verify ≥3:1 for focus indicators per WCAG 2.1 AA non-text contrast), Enter key submits the form.
- **Responsive**: single column at all widths; card width caps at 400px and centers on wider viewports.

### 3.3 New screen: Prompt Library (admin)

Replaces the `prompts` tab in `AppSettingsModal`, promoted to its own admin screen (still reachable from Settings nav).

- **Layout**: two-pane — left pane lists all 25 agents grouped by phase (using existing `PHASE_ORDER`/`PHASE_AGENTS`/`PHASE_LABELS` groupings from `frontend/src/agents/constants.ts`), right pane shows the selected agent's prompt editor.
- **Editor**: textarea with the current effective prompt (app default, or hardcoded fallback if no override), a "Reset to default" button (disabled/greyed if no override exists — current `resetPromptDefault` already handles this case), a "Provider hint" dropdown (OpenAI / Claude / "use project default") tied to the new `provider_hint` field.
- **States**: *unsaved changes* indicator (dot or "Modified" label) before save; *saving* — button shows spinner; *saved* — brief inline confirmation, not a modal.
- **Permissions**: entire screen gated to `admin` role — non-admins who navigate here (e.g. via URL) see a "You don't have permission to view this page" empty state, not a blank screen or silent redirect (avoids confusing "did my click not work?" moments).

### 3.4 New screen: Project-level Prompt Overrides

This already exists conceptually inside `ReviewGateModal` ("Save for this project" / Expert mode), per the precedence comment in `promptDefaults.ts`. Keep that entry point, but the underlying calls move to `PUT /api/projects/:id/prompts/:agentId`. No new screen — just confirm the existing Expert-mode UI continues to work with the new endpoint, and that the diff/patch view (JSON Patch via `fast-json-patch`) still renders correctly when the patch is now fetched from the server rather than read from Dexie.

### 3.5 New screen: User & Role Management (admin)

- **Layout**: table — columns Name, Email, Role(s), Projects (count), Actions (Edit/Deactivate). "Invite user" button top-right opens a modal: email + role picker (from the 11 `ROLE_TEMPLATES` + `admin`).
- **States**: empty state only applies pre-seed (shouldn't normally be empty since the seed admin always exists); loading skeleton rows; error toast if `GET /api/users` fails (transient, retryable — toast is appropriate here unlike the Login error).
- **Deactivate vs delete**: deactivating a user (soft) rather than deleting preserves `agent_runs.completed_by`/`review_gates.approved_by` referential integrity — surfaced as a confirm dialog explaining this distinction.
- **Accessibility**: table rows keyboard-navigable (tab through action buttons), role picker is a native `<select>` or accessible combobox (not a custom div-based dropdown without ARIA roles).

### 3.6 Cross-cutting checklist (ui-ux-pro-max categories applied)

| Category | Findings / actions |
|---|---|
| **Accessibility** | `ResumeModal.tsx` uses inline styles with emoji (🔄) as the only "new info" indicator — add `aria-live="polite"` region so screen readers announce the interrupted-pipeline notice. Verify all new admin screens (3.3, 3.5) have proper `<label>`/`aria-label` on inputs — existing modals are inconsistent on this. Color contrast: `--accent` on `--surface` (dark theme) should be checked against WCAG AA 4.5:1 for text, 3:1 for UI components — run an automated contrast check (e.g. axe) as part of Phase 6 testing. |
| **Layout/Responsive** | Existing screens appear to be desktop-first (no evidence of mobile breakpoints in the 10 CSS Modules). New screens (Login, Prompt Library, User Management) should at minimum degrade gracefully to ~768px (tablet) — two-pane layouts (3.3) stack vertically below ~900px. |
| **Typography/Color** | New screens must reuse existing CSS variables (`--surface`, `--accent`, `--text-muted`, etc. — referenced in `ResumeModal.tsx`) rather than introducing new tokens, to stay consistent with the theme system (`useThemeInit`). |
| **Forms/Feedback** | Standardize: destructive actions (deactivate user, remove project member, reset prompt to default) use confirm dialogs; non-destructive saves use inline "Saved" feedback, not modals; network/auth errors get persistent inline messages (Login) vs. transient toasts (list-loading failures). |
| **Navigation** | Admin screens (Prompt Library, User Management, API/provider settings) need a consistent "Admin" section in the settings nav, visually distinct (e.g. a divider + "Admin" label) so non-admins immediately understand why they don't see those items (rather than wondering if they're missing). |

---

## 5. Migration Plan (6 phases)

Each phase should land as its own PR (or small PR series) and leave the app in a working state — no "big bang" cutover.

### Phase 1 — Extract shared types & domain logic

- **Objective**: create the `shared/` package (2.6) without changing any runtime behavior. Frontend continues to work exactly as today, just importing types/constants from `shared/` instead of local files.
- **Files affected**: move `frontend/src/types/agent.types.ts`, `frontend/src/types/project.types.ts`, `frontend/src/agents/definitions.ts`, `frontend/src/data/roleTemplates.ts` → `shared/`. Update all `import type {...} from '@/types/...'` and `import {...} from '@/agents/definitions'` across `frontend/src` (search-and-replace, ~7,856 LOC to check for references). Add `shared` as a workspace dependency in `frontend/package.json` and `backend/package.json`.
- **Risks**: import path churn touches many files — high chance of missed references causing TS build errors (caught by `tsc`/CI, not runtime). `AGENT_DEFINITIONS[agentId].buildUserPrompt` is a function — moving it to a shared package used by the backend means the backend now executes frontend-authored prompt-building logic; check for any browser-only APIs inside `buildUserPrompt` implementations (e.g. `window`, `document`) before moving.
- **Validation**: `npm run build` (frontend) and existing Vitest suite (31 test files) pass unchanged — this phase should produce a **zero-diff in behavior**, only import paths change. Coverage thresholds in `vite.config.ts` (lines:80/functions:80/branches:75/statements:80) must still pass.

### Phase 2 — Backend domain API, LLM gateway, prompt library, and auth (foundations)

- **Objective**: build out the new backend pieces from Section 2 — DB schema + ORM, `/api/auth/*`, `/api/users`, `/api/roles`, `/api/projects*`, `/api/prompts*`, and the multi-provider LLM gateway (`backend/src/llm/`). Existing `/api/agent`, `/api/fetch-site`, `/api/github/*`, `/api/health` remain untouched in this phase (frontend still calls them directly as today).
- **Files affected**: new `backend/src/db/` (schema + migrations), `backend/src/auth/`, `backend/src/llm/{openaiProvider,claudeProvider,index}.js`, `backend/src/routes/{auth,users,roles,projects,prompts}.js`, `backend/src/proxy.js` refactored into `backend/src/app.js` (Express app setup) + route modules. Update `backend/package.json` (add ORM — Prisma or Drizzle — bcrypt/argon2, jsonwebtoken or cookie-session), `backend/.env.example` (add `DATABASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DEFAULT_LLM_PROVIDER`, `SESSION_SECRET`).
- **Risks**: this is the largest phase by code volume but **lowest user-facing risk** because the frontend doesn't call any of it yet — it can be built and tested in isolation. Main risk is schema design mistakes that are costly to change after Phase 4 data migration (e.g. getting `agent_assignments`/`project_members` cardinality wrong). Seed data (11 `ROLE_TEMPLATES` + `admin` role, `AGENT_DEFINITIONS` as seed `prompt_defaults`) must be scripted, not manual.
- **Validation**: new backend integration tests (Supertest or similar) against the new endpoints, run against the dev SQLite DB. `/api/health` still returns 200. Manually verify `/api/auth/login` → `/api/auth/me` round-trip with a seeded admin user. Verify Claude provider with a real `ANTHROPIC_API_KEY` (or `testMode`) returns `{text, tokensUsed, model}` matching the OpenAI provider's shape.

### Phase 3 — Frontend consumes the new APIs (parallel old/new)

- **Objective**: frontend adds an API client layer (`frontend/src/services/domainApi.ts`) and a login screen, but Dexie remains the fallback/cache — both paths coexist behind a feature flag (e.g. `VITE_USE_BACKEND_DB=true`) so this can be rolled back instantly.
- **Files affected**: new `frontend/src/services/domainApi.ts` (typed client using `shared/types`), new `frontend/src/components/auth/LoginScreen.tsx` (3.2), `App.tsx` gains an auth-check gate before rendering Dashboard, `Dashboard.tsx`/`ProjectWorkspace.tsx`/`TeamPanel.tsx` etc. switch their `useLiveQuery(...)` Dexie calls to `useEffect`+`domainApi` calls (or a thin SWR/React Query layer) **when the feature flag is on**.
- **Risks**: two parallel data-access patterns in the same components increases complexity and risk of subtle bugs (e.g. optimistic UI updates that assume Dexie's `useLiveQuery` reactivity, which a REST client doesn't provide for free — need polling or a lightweight event mechanism). `pipelineEngine.ts`'s `runAgent` calls `api.callAgent` directly — needs to call `/api/projects/:id/agent-runs/:agentId/run` instead, which changes who "owns" the agent-run loop (still frontend-driven for now, just persisted server-side after each step).
- **Validation**: with the flag off, app behaves exactly as before (regression safety net). With the flag on, manually walk through: login → dashboard loads projects from API → open a project → run an agent → check `agent_runs` row appears in DB with correct `provider`/`model`/`tokens_used`. Existing Vitest component tests likely need flag-aware setup (mock `domainApi` vs. mock Dexie) — expect test file updates, not full rewrites, for the ~10 components touched.

### Phase 4 — Persistence cutover & data migration

- **Objective**: flip `VITE_USE_BACKEND_DB=true` as the default, write a one-time migration script that reads existing per-browser Dexie data (via the existing `exportAllProjects()` JSON format) and imports it into the new DB via `/api/admin/import`.
- **Files affected**: new `backend/src/routes/admin.js` (`/api/admin/import`, `/api/admin/backup` — admin-only), migration script `scripts/migrate-dexie-export.js` (Node script, takes a Dexie export JSON, maps `Project.teamMembers[]`→`project_members`+seed `users`, `Project.agentAssignments[]`→`agent_assignments`, `Project.activeAdminId` holder → first `admin`-role user). `db/projectRepository.ts` functions become thin wrappers or are removed in favor of `domainApi`.
- **Risks**: **this is the highest-risk phase** — it's the actual data cutover. `TeamMember` records have no password/email-verification today; seeded `users` need a "set your password" invite flow (could land in Phase 2 but is exercised for real here). Multiple users may have used the app independently (separate browsers) with overlapping project names/ids — id collisions possible if `Project.id` generation wasn't strictly UUID (verify `createProject` implementation uses UUIDs, not sequential/timestamp ids, before relying on uniqueness across merged exports).
- **Validation**: run the migration against a copy of real exported data (via `exportAllProjects()`) in a staging DB first. Row counts: `projects` count == exported project count; `agent_runs` count == sum of non-empty `agentRuns` entries; spot-check 2-3 projects end-to-end in the UI post-migration (gates, prompts, team). Keep the Dexie export as a rollback artifact for at least one release cycle.

### Phase 5 — UI screens for RBAC & prompt library

- **Objective**: ship the new admin screens from Section 3 (Prompt Library 3.3, User & Role Management 3.5, provider/API-key admin screen) — these were deliberately deferred until the underlying APIs (Phase 2) and auth (Phase 3/4) are live and tested.
- **Files affected**: new `frontend/src/components/admin/{PromptLibrary,UserManagement,ProviderSettings}.tsx` + `.module.css`. `AppSettingsModal.tsx` loses the `prompts`/`api`/`projects` tabs (moved to dedicated admin screens) — `appearance` and `domains` tabs may remain if scoped to non-admin-editable preferences, or also move if `domains` becomes admin-managed per 3.1.
- **Risks**: permission-check bugs — a non-admin reaching an admin screen via direct URL navigation (React Router or view-state) must see the "no permission" empty state (3.5), not a broken/partial UI or, worse, a working UI that calls APIs the backend then correctly 403s on (confusing UX even if secure).
- **Validation**: test as both `admin` and a non-admin role — verify nav items are hidden AND direct navigation is blocked server-side (403 from API) and client-side (empty state). Verify Prompt Library round-trip: edit a prompt → run that agent → confirm the edited prompt was actually used (e.g. via `testMode` echoing the received prompt).

### Phase 6 — Testing, deployment, and hardening

- **Objective**: close out the security/ops findings from Section 5, finalize Docker/Compose (2.8), and bring backend test coverage to a level matching the frontend's existing Vitest thresholds.
- **Files affected**: `docker-compose.yml`/`Dockerfile` (DB service, migration-on-start), `backend/.env.example` (final var list), `.gitignore` (add `.env`, `*.env`, `backend/.env`, `frontend/.env` — currently missing per Section 1 finding), CI config (add backend test job + coverage gate), `backend/src/llm/*` rate-limiting/timeout hardening for the Claude provider (matching existing OpenAI `httpsPost` proxy-tunnel support).
- **Risks**: `/api/settings` no longer writes `backend/.env` (2.7) — any deployment docs/scripts that assume that file is runtime-mutable need updating. CORS currently `origin: '*'` — must be scoped to the actual frontend origin(s) once auth cookies are in play (wildcard CORS + credentials is invalid per spec and browsers will reject it, so this is a forcing function, not optional).
- **Validation**: full `docker compose up` from a clean checkout — healthcheck on `/api/health`, login as seeded admin, create a project, run one agent with each provider (OpenAI + Claude), approve a gate, export a document. Run `npm audit` / equivalent on new backend deps (bcrypt/argon2, ORM, jwt library). Confirm coverage thresholds pass for both frontend and new backend test suite.

---

## 6. Blind Spots & Failure Points

### 5.1 Browser-only vs. server-side code

- **Why it matters**: code being moved to `shared/` (Phase 1) and `backend/` (Phase 2) — especially `AGENT_DEFINITIONS[agentId].buildUserPrompt` and anything in `frontend/src/services/pipelineEngine.ts` — may implicitly assume `window`, `document`, `crypto.randomUUID()` (browser Web Crypto vs. Node `crypto` — Node has it too since v19, but verify the Node version in `docker/Dockerfile`'s base image), `localStorage`, or `fetch` (Node 18+ has global `fetch`, but older Node images don't).
- **How to detect**: grep `shared/` and any code destined for `backend/` for `window.`, `document.`, `localStorage`, `sessionStorage`, `navigator.`. Also check `frontend/src/agents/domainKnowledgeDefaults.ts` and `domainKnowledgeTemplates.ts` (referenced by `AppSettingsModal`) for browser-only assumptions before moving.
- **How to fix**: isolate any browser-only logic behind an injected interface (e.g. pass a `crypto`/`fetch` implementation in, rather than referencing globals) so the same module runs in both environments.
- **How to validate**: run `shared/` package's own unit tests (if any) under Node directly (`node --test` or Vitest with `environment: 'node'`), not just under the frontend's jsdom/browser test environment.

### 5.2 Filesystem assumptions

- **Why it matters**: `backend/src/proxy.js`'s `/api/settings` currently does `fs.writeFileSync` to `backend/.env` (Section 1 finding). In a container, `.env` may be baked into the image (read-only layer) or the container may be ephemeral (changes lost on restart/redeploy).
- **How to detect**: grep `backend/src` for `fs.writeFileSync`, `fs.appendFileSync`, any path relative to `__dirname` used for writes.
- **How to fix**: Section 2.7 — `/api/settings` becomes DB-backed (`settings` table). Any remaining file writes (e.g. logs) should go to a mounted volume or stdout, not the app source tree.
- **How to validate**: run the container with a **read-only root filesystem** (`docker run --read-only` or `read_only: true` in compose) — if `/api/settings` (or anything else) fails, that's the remaining filesystem assumption to fix.

### 5.3 In-memory state

- **Why it matters**: `pipelineEngine.ts`'s `PipelineEngine` instance and its PQueue (concurrency=3) currently live in the frontend's memory — if the backend takes over orchestration in a future phase (not in this plan's Phase 1-6, but a likely Phase 7), a single Node process holding pipeline state in memory won't survive a restart or scale past one instance. Even in this plan (frontend-driven, Phase 3+), the backend's `agent_runs` table is the source of truth, but **rate limiting** (`express-rate-limit`, currently 120 req/min on `/api`) is in-memory per-process — multiple backend replicas would each have their own limit, effectively multiplying the real limit.
- **How to detect**: grep for `express-rate-limit` config and any `new Map()`/module-level mutable state in `backend/src`.
- **How to fix**: for this plan's scope, document that the backend is single-instance (matches current `docker-compose.yml`'s single `app` service). If horizontal scaling is needed later, move rate-limit state to Redis or the DB.
- **How to validate**: not a blocker for Phase 1-6 given single-instance deployment — add a comment in `docker-compose.yml` noting the constraint, and revisit if `replicas > 1` is ever configured.

### 5.4 Hardcoded localhost / URLs

- **Why it matters**: `frontend/vite.config.ts` proxies `/api` → `http://localhost:3001` in dev; `frontend/.env`/`.env.example` has `VITE_API_URL`. New CORS config (5.6) and cookie-based auth (`SESSION_SECRET`, 2.5) are sensitive to the actual origin/domain in non-dev environments.
- **How to detect**: grep for `localhost`, `127.0.0.1`, `http://` (non-https) across `frontend/` and `backend/` configs.
- **How to fix**: ensure `VITE_API_URL` and CORS allow-list are both driven from env vars with no hardcoded fallback to `localhost` in production builds — Vite's dev proxy is dev-only and doesn't affect the built bundle, but double-check `api.ts`'s `API_URL` fallback (`'/api'`, a relative path) is correct for the Docker single-container setup (frontend and backend served from same origin via `serve` + proxy, per `docker/Dockerfile`'s `CMD`).
- **How to validate**: build the Docker image and run it standalone (no dev server) — login, load dashboard, run an agent — confirm no requests go to `localhost:5173` or similar dev-only addresses (check via browser devtools network tab).

### 5.5 CORS / auth boundary

- **Why it matters**: current CORS is `origin: '*'` (Section 1 finding) and `checkToken` is a no-op if `PROXY_TOKEN` is unset. Once real cookie-based sessions exist (2.5), `Access-Control-Allow-Origin: '*'` combined with `credentials: true` is rejected by browsers — but more importantly, an open CORS policy on authenticated endpoints is a CSRF/data-exposure risk even before that.
- **How to detect**: `backend/src/proxy.js` CORS middleware config; check whether `PROXY_TOKEN` is set in the deployment's `.env` (if unset, **all current proxy endpoints are unauthenticated** today).
- **How to fix**: CORS allow-list set to the actual frontend origin(s) via env var (e.g. `ALLOWED_ORIGINS`). `requireAuth` middleware (2.5) replaces/extends `checkToken` and must **fail closed** (reject if session invalid), not no-op if a config var is unset — this is the opposite of the current `checkToken` behavior and should be called out explicitly in code review.
- **How to validate**: integration test that asserts a request without a valid session cookie to any `/api/projects*`, `/api/users*`, `/api/prompts*` endpoint returns 401, and that a request from a non-allow-listed `Origin` header is rejected by CORS preflight.

### 5.6 Database persistence & migrations

- **Why it matters**: Section 2.2's schema is new — migration ordering matters (e.g. `roles`/seed data must exist before `user_roles` foreign keys can be inserted during Phase 4's data migration).
- **How to detect**: review the ORM's migration files for FK ordering; run `prisma migrate diff` (or equivalent) against an empty DB to confirm the full schema applies cleanly in one pass.
- **How to fix**: seed scripts (roles, `AGENT_DEFINITIONS` → `prompt_defaults`) run as part of the migration deploy step in `docker/Dockerfile`'s startup (2.8), idempotently (safe to re-run on every container start).
- **How to validate**: `docker compose up` from scratch (no existing volume) → schema + seed data present → login as seeded admin works on first boot.

### 5.7 File uploads / exports

- **Why it matters**: `exportAllProjects()`/`importProjects()` (Dexie-based, client-side Blob download/upload) and document exports (`ExportMenu.tsx`, using `docx`/`jszip`/`xlsx`/`papaparse` per `frontend/package.json`) currently operate entirely client-side on data already in the browser. Once projects live server-side (Phase 4+), "export all projects" becomes a server endpoint (2.7's `/api/admin/backup`) — but **per-project document exports** (the `docx`/`xlsx` generation) may still happen client-side using data fetched via API, which is fine, OR could move server-side for consistency.
- **How to detect**: review `frontend/src/services/exporters/` for what data each exporter needs — if it's just the already-fetched project + agent outputs, client-side export remains simplest (no change needed beyond the data source).
- **How to fix**: no change required for per-project exports if they only need data the frontend already has via the API. Only the "export ALL projects" (admin backup) function needs to move server-side, since a non-admin frontend session won't have access to all projects' data.
- **How to validate**: after Phase 4, click "Export" on a project's documents — confirm the generated `.docx`/`.xlsx` is identical in content to pre-migration output (same data, different source).

### 5.8 Runtime environment differences (dev vs. Docker vs. prod)

- **Why it matters**: dev uses Vite dev server + `nodemon` backend with SQLite; Docker uses `serve` (static) + Node backend, potentially Postgres. The LLM gateway's `httpsPost` corporate-proxy tunneling (`HTTPS_PROXY`/`HTTP_PROXY` env vars, mentioned in `.env.example`) needs to work identically for both OpenAI and Claude providers — if `claudeProvider.js` doesn't reuse the same `httpsPost` helper, proxy support could silently differ between providers.
- **How to d