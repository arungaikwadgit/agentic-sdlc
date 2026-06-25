# Agentic SDLC — Deployment & Agentic Maturity Assessment

**Date:** June 2026  
**Scope:** Cloud deployment readiness + agent autonomy maturity analysis

---

## Part 1: Deployment Assessment

### Current Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18, Vite, TypeScript | SPA, CSS Modules |
| Local DB | Dexie (IndexedDB wrapper) | Browser-only, no server sync |
| LLM Proxy | Node.js (`backend/src/proxy.js`) | Forwards calls to OpenAI/Anthropic |
| Runtime API | Express + TypeScript (`backend/src/index.ts`) | Agent runs, jobs, health endpoints |
| Database | PostgreSQL 15 | Migrations via node-pg-migrate |
| Containerization | Docker (multi-stage), Docker Compose | Separate services: db, proxy, runtime |
| Shared Types | `/shared-types` package | Cross-service TypeScript contracts |

### What's Already Done Right

The app has a production-ready foundation in several areas:

**Docker:** A multi-stage Dockerfile exists that builds the frontend (`npm run build`), bundles the backend, and produces a lean Alpine image. `docker-compose.yml` wires up Postgres, the proxy, and the runtime API with health checks and environment variable injection.

**Environment config:** `.env.example` exists. Secrets (API keys, DB credentials) are passed as environment variables — not hardcoded.

**PostgreSQL:** The backend uses a connection pool (`pg.Pool`) pointed at `POSTGRES_URL`. Migrations are managed by `node-pg-migrate`, so schema changes are repeatable and versioned.

**TypeScript across the stack:** Both frontend and backend are fully typed, which reduces runtime surprises in deployment.

### What Needs to Be Fixed Before External Deployment

#### 1. Dexie (IndexedDB) — the biggest blocker

The frontend currently stores all project data in the browser's IndexedDB via Dexie. This means:
- Data is siloed per browser/device — no sharing, no sync
- Zero durability — clearing browser storage loses everything
- Multi-user is impossible

**What to do:** Migrate project storage from Dexie to the PostgreSQL backend. The repository layer (`backend/src/repositories/`) already exists. Wire `db.projects` Dexie queries to REST calls against the runtime API, or replace Dexie with React Query + fetch calls.

#### 2. Frontend is served as a static SPA but the proxy and runtime are separate services

Right now the Dockerfile COPYs the built frontend into `/app/dist` and serves it with `serve`. The proxy runs on port 3001, the runtime on 4000. The frontend needs to know which URL to call at runtime — this must be injected via environment variable at build time (`VITE_API_BASE_URL`) or via a runtime config endpoint.

**What to do:** Add `VITE_API_BASE_URL` to `.env.example` and `vite.config.ts`. Alternatively, put nginx in front to proxy `/api/*` to the backend and serve static files — cleaner for production.

#### 3. No CI/CD pipeline yet

There is a `.github/workflows/ci.yml` started (from the P0 phase), but it needs:
- Frontend build + lint + test steps
- Docker image build + push to a registry (GitHub Container Registry or Docker Hub)
- Deploy step (varies by platform)

#### 4. No health check on the frontend container

The backend has `/health` and `/ready` endpoints. The frontend static server does not. Add a simple nginx `location /health { return 200; }` or use `serve`'s built-in health probe.

#### 5. No HTTPS/TLS config

For external deployment, TLS termination needs to happen either at the load balancer (recommended for cloud platforms) or via nginx with Let's Encrypt. Currently nothing handles this.

---

### Recommended Deployment Platform

Given the stack (Node, React, Postgres, Docker), here are the top three options ranked by operational simplicity:

**Option A: Railway** *(recommended for speed)*
- Deploys directly from a Dockerfile or from a `railway.toml`
- Postgres is a first-class managed service — no setup
- Environment variables set in the dashboard
- Zero-downtime deploys on push to `main`
- Cost: ~$5–20/month for this workload

**Option B: Render**
- Very similar to Railway — web services + managed Postgres
- Free tier available (cold starts on free)
- Static site hosting for the frontend at no cost
- Good fit if you want frontend and backend on separate services

**Option C: AWS ECS + RDS** *(recommended for scale)*
- Push Docker images to ECR, run on ECS Fargate
- RDS Postgres for production-grade DB (auto-backups, read replicas)
- ALB for HTTPS termination and routing
- Higher setup cost but scales horizontally with no rearchitecting
- Cost: ~$50–150/month baseline

---

### Deployment Checklist (ordered by priority)

1. **Migrate from Dexie to backend API** — without this, the app isn't multi-user or cloud-native
2. **Add `VITE_API_BASE_URL` env var** to frontend build + update `api.ts` to use it
3. **Add nginx** as a reverse proxy (serves static files + proxies `/api` to backend)
4. **Wire up CI/CD** — build, test, push Docker image on PR merge
5. **Add secrets management** — use Railway/Render secrets or AWS Secrets Manager, never commit `.env`
6. **Add rate limiting** to the LLM proxy (protect API keys from abuse)
7. **Add structured logging** (pino or winston) — currently using `console.log`
8. **Database backups** — enable auto-backups on managed Postgres
9. **Horizontal scaling** — the backend is stateless so ECS can run multiple replicas; just ensure DB connections are pooled (already done with `pg.Pool`)

---

## Part 2: Agentic Autonomy Assessment

### Agentic Levels Reference

Based on research into agentic AI frameworks (Anthropic's agent taxonomy, LangChain's autonomy ladder, and Shyamal Anadkat's 5-level framework):

| Level | Name | Description |
|---|---|---|
| **L0** | Static / No Agency | Fixed prompts, no tool use, no decision-making. LLM is a text transformer only. |
| **L1** | Tool-Augmented | Agent can call tools (search, calculator, API) but human initiates every action. |
| **L2** | Directed Automation | Agent executes a defined workflow step-by-step with human approval at gates. Decisions are pre-scripted. |
| **L3** | Goal-Directed | Agent receives a goal, breaks it into sub-tasks, makes decisions about approach, retries on failure, but operates within a bounded context. |
| **L4** | Multi-Agent Orchestration | Agents spawn sub-agents, delegate tasks, and synthesize results. Feedback loops between agents. Minimal human checkpoints. |
| **L5** | Fully Autonomous | Self-improving agents that update their own goals, tools, and memory. Long-horizon operation without human input. Not yet production-viable at scale. |

---

### Agent Autonomy Table

| # | Agent ID | Display Name | Phase | Active? | Current Level | Current Description | Target Level | Path to Pure Agentic |
|---|---|---|---|---|---|---|---|---|
| 1 | `manager` | SDLC Orchestrator | Phase 1 | ✅ Yes | **L2** | Directed Automation — runs first, no tool use, synthesizes a PRD from user inputs. Human triggers it; no decisions about what to do next. | L3 | Give it access to project history, previous PRDs, and the ability to propose its own scope refinements. Add a self-critique step where it evaluates output quality before passing to phase 1b. |
| 2 | `projectCharter` | Project Charter | Phase 1b | ✅ Yes | **L2** | Directed Automation — consumes manager output, generates a charter doc. No branching, no tool calls. | L3 | Add web search tool to validate market assumptions. Allow it to request clarification from the manager agent if PRD is ambiguous rather than silently proceeding. |
| 3 | `brd` | Business Requirements | Phase 1b | ✅ Yes | **L2** | Same as projectCharter — sequential, prompt-in/doc-out. | L3 | Cross-reference against projectCharter output to flag contradictions automatically. Add stakeholder interview synthesis capability. |
| 4 | `stakeholder` | Stakeholder Analysis | Phase 2 | ✅ Yes | **L2** | Parallel phase 2 agent. Prompt-in/doc-out. No tool use. | L3 | Integrate CRM/org chart lookup tool. Allow it to query real stakeholder data rather than inferring from project description. |
| 5 | `userStory` | User Stories | Phase 2 | ✅ Yes | **L2** | Parallel phase 2. Generates stories from PRD. | L3 | Auto-score stories against INVEST criteria and self-revise failing stories before output. Add Jira/Linear tool to push stories directly. |
| 6 | `businessRules` | Business Rules | Phase 2 | ✅ Yes | **L2** | Sequential within phase 2. Extracts business rules. | L3 | Add conflict detection — check new rules against existing ones and flag contradictions. |
| 7 | `feasibility` | Feasibility Study | Phase 2 | ✅ Yes | **L2** | Prompt-in/doc-out. No cost modelling or external data. | L3 | Add web search for vendor pricing, technology benchmarks. Allow it to revise scope if feasibility score is below threshold. |
| 8 | `dataModel` | Data Model | Phase 2 | ✅ Yes | **L2** | Generates ER diagrams in Mermaid. No validation against real DB. | L3 | Validate generated schema against existing migrations. Flag tables that already exist in the DB schema. |
| 9 | `architecture` | Architecture | Phase 3 | ✅ Yes | **L2** | Parallel phase 3. Generates Mermaid architecture diagrams. | L3 | Add ADR generation for each architectural decision. Allow it to query existing ADRs and reject contradictions. |
| 10 | `apiDesign` | API Design | Phase 3 | ✅ Yes | **L2** | Generates OpenAPI-style specs in Mermaid. | L3 | Validate generated endpoints against existing codebase routes. Auto-detect conflicts with existing APIs. |
| 11 | `uxResearch` | UX Research | Phase 3 | ✅ Yes | **L2** | Synthesises UX research from project context. No real user data. | L3 | Integrate analytics/feedback tool (Amplitude, Intercom) to pull real usage signals. |
| 12 | `interaction` | Interaction Design | Phase 3 | ✅ Yes | **L2** | Generates interaction flows from UX research output. | L3 | Add accessibility audit step (WCAG check) on generated flows before output. |
| 13 | `uxMockups` | UX Mockups | Phase 3 | ✅ Yes | **L2+** | Generates HTML mockups with live style editor. Has retry logic on format failure — the only agent with self-correction today. Closest to L3 in the suite. | L3 | Add screenshot-and-evaluate loop (render the HTML, take a screenshot via Puppeteer, evaluate quality, regenerate if below threshold). |
| 14 | `securityCompliance` | Security & Compliance | Phase 3b | ✅ Yes | **L2** | Runs after phase 3, feeds into taskBreakdown. No real CVE lookup. | L3 | Add OWASP/CVE database lookup tool. Allow it to auto-classify findings by severity and push P0 findings back upstream to architecture agent. |
| 15 | `sprintPlanner` | Sprint Planner | Phase 4 | ✅ Yes | **L2** | Generates sprint plan from task breakdown. No calendar awareness. | L3 | Integrate calendar API to schedule sprints against real team availability. |
| 16 | `taskBreakdown` | Task Breakdown | Phase 4 | ✅ Yes | **L2** | Sequential. Breaks epics into tasks from previous outputs. | L3 | Add effort estimation validation — compare estimates against historical velocity data. |
| 17 | `techDebt` | Tech Debt Register | Phase 4 | ✅ Yes | **L2** | Generates tech debt items from architecture/code structure. | L3 | Connect to real codebase analysis (ESLint, SonarQube) rather than inferring from documents. |
| 18 | `codeStructure` | Code Structure Generator | Phase 4 | ✅ Yes | **L2** | Generates suggested folder/file structure. No validation against actual repo. | L3 | Compare generated structure against existing repo layout. Flag conflicts and propose merges. |
| 19 | `codeSnippets` | Code Snippet Generator | Phase 4 | ✅ Yes | **L2** | Generates code samples. No compilation/execution. | L3 | Add a code execution sandbox (e.g. E2B, Modal) — run generated snippets and verify they compile/pass basic tests before output. |
| 20 | `uiComponentLibrary` | UI Component Library | Phase 4 | ✅ Yes | **L2** | Generates component specs. No Storybook integration. | L3 | Auto-generate Storybook stories from the component spec and verify they render. |
| 21 | `codeReviewStandards` | Code Review & CI Standards | Phase 4 | ✅ Yes | **L2** | Generates code review guidelines. No integration with actual PR workflow. | L3 | Push generated standards as a `.github/CODEOWNERS` and `pr_template.md` file directly to the repo via GitHub API. |
| 22 | `roadmapPlanner` | Roadmap Planner | Phase 4 | ✅ Yes | **L2** | Generates a release roadmap doc. No tracking system integration. | L3 | Push milestones directly to GitHub/Jira/Linear via API. |
| 23 | `testPlan` | Test Plan | Phase 5 | ✅ Yes | **L2** | Generates test strategy doc. No test runner integration. | L3 | Generate a `vitest.config.ts` or `jest.config.ts` skeleton and validate it parses correctly before output. |
| 24 | `testCases` | Test Cases | Phase 5 | ✅ Yes | **L2** | Generates test case descriptions. No actual test file output. | L3 | Generate runnable test files (`.test.ts`) and execute them in a sandbox — fail and regenerate if tests don't pass. This is the highest-value L3 upgrade. |
| 25 | `devopsEngineer` | DevOps Engineer | Phase 7 | ✅ Yes | **L2** | Generates CI/CD pipeline YAML. Not validated against actual CI. | L3 | Lint generated YAML (yamllint, actionlint for GitHub Actions). Push directly to `.github/workflows/` via GitHub API. |
| 26 | `infraEngineer` | Infrastructure Engineer | Phase 7 | ✅ Yes | **L2** | Generates IaC docs (Terraform/CDK concepts). No actual provisioning. | L3 | Generate valid Terraform HCL, run `terraform validate`, flag errors and self-correct. |
| 27 | `observabilityEngineer` | Observability Engineer | Phase 8 | ✅ Yes | **L2** | Generates observability runbooks and alert configs. | L3 | Push alert rules to Datadog/Grafana via API. Validate dashboards render correctly. |
| 28 | `onCallEngineer` | On-Call Engineer | Phase 8 | ✅ Yes | **L2** | Generates on-call runbooks and escalation policies. | L3 | Push runbooks to PagerDuty/OpsGenie. Auto-schedule rotations via API. |

**Note:** Phase 6 has no active agents (intentionally empty — `securityCompliance` was moved to Phase 3b).

---

### Summary

**Current state: All 28 agents are active at Level 2 (Directed Automation).**

They execute sequentially/in parallel within a defined pipeline, produce structured document output, and require human approval at 5 review gates. There is no tool use, no self-correction (except `uxMockups`), and no cross-agent feedback loops at runtime.

**To reach L3 (Goal-Directed) across the suite, the three highest-impact investments are:**

1. **Add a code execution sandbox** (E2B, Modal, or a Docker sidecar) so `codeSnippets` and `testCases` can validate their output before delivery. These two agents have the highest risk of producing unusable output without execution feedback.

2. **Add web search + external data tools** to `feasibility`, `securityCompliance`, and `uxResearch` — agents that currently hallucinate market/threat data because they have no access to real-world information.

3. **Add cross-agent feedback loops** — specifically, allow `securityCompliance` to push findings back to `architecture`, and allow `testCases` to push coverage gaps back to `codeStructure`. This is the first step toward L4 multi-agent orchestration.

**L4 requires:** The `manager` agent orchestrating sub-agents dynamically (spawning them based on project type rather than running a fixed pipeline), with agents able to request re-runs of upstream agents when they detect insufficient input quality.

**L5 is not production-viable** for this use case — it would require agents to rewrite their own prompts and pipeline structure, which creates unpredictability in a professional SDLC context.
