# Agentic AI SDLC Common Audit and Gap Checklist

## Purpose

This file consolidates the following three Agentic SDLC analysis/checklist files into one non-duplicated audit guide:

- `C:\Projects\SLDC - AI\agentic-gap-analysis.md`
- `C:\Projects\SLDC - AI\agentic_sdlc_step_by_step_checklist.md`
- `C:\Projects\SLDC - AI\agentic-sdlc\AgenticAnalysis\agentic_sdlc_audit_checklist.md`

Use this checklist to determine whether the current codebase is a true governed agentic SDLC platform or only a prompt/artifact generation workflow. Each step is unique and includes a way to identify gaps in the current implementation.

## Audit Outputs

At the end of the audit, produce these artifacts:

| Output | Description |
|---|---|
| Architecture summary | What runtimes, APIs, data stores, and deployment targets are actually used |
| Agent inventory | Agent ID, name, role, phase, inputs, outputs, tools, dependencies, and owner |
| Tool inventory | Tool name, schema, permission, side effects, retry policy, and auditability |
| Data-source map | Which data is in Postgres, which is still in files, env vars, localStorage, or IndexedDB |
| Gap register | Every gap with severity, evidence, fix owner, and target state |
| Maturity score | Current and target maturity level from 0 to 5 |
| Remediation backlog | Ordered fixes with dependencies and validation steps |

## Scoring Guide

| Score | Meaning | Evidence Standard |
|---:|---|---|
| 0 | Not present | No implementation found |
| 1 | Hardcoded or superficial | Static config, prompt-only behavior, or unused scaffold |
| 2 | Present but incomplete | Works partially, lacks persistence/governance/observability |
| 3 | Implemented and usable | Works in the live execution path with tests or clear evidence |
| 4 | Production-ready | Durable, governed, observable, tested, secure, and documented |

## Severity Guide

| Severity | Meaning |
|---|---|
| Critical | Blocks safe agentic execution, data integrity, security, or production operation |
| High | Materially weakens traceability, reliability, governance, or artifact quality |
| Medium | Limits scalability, maintainability, usability, or operational confidence |
| Low | Improvement opportunity without immediate production risk |

## Step 0: Repository and Runtime Inventory

Goal: understand what actually runs before judging agentic maturity.

| Check | Evidence to Collect | Gap Signal | Severity Default |
|---|---|---|---|
| Top-level architecture | README, architecture docs, deployment files, package.json files | Multiple runtimes exist but only one is wired to production | High |
| Primary app entry points | Frontend bootstrap, backend server start files, Railway/Vercel configs | More than one backend owns overlapping routes | High |
| Active API path | Frontend API client, proxy routes, server routes, env variables | Frontend bypasses backend or calls different APIs per environment | Critical |
| Data stores | Postgres tables, Supabase schema, IndexedDB/Dexie usage, localStorage usage | Project/master data exists outside Postgres | Critical |
| Deployment topology | Vercel, Railway services, Supabase project, env vars | Runtime URLs and API responsibilities are unclear | High |

Commands:

```bash
rg -n "createRoot|listen|app.use|router|fetch\\(|axios|VITE_API_URL|SERVER_API_URL|POSTGRES_URL|Dexie|indexedDB|localStorage" .
rg --files -g "package.json" -g "railway.json" -g "vercel.json" -g "*.sql"
```

## Step 1: Explicit Agent Model

Goal: confirm agents are first-class domain objects, not just prompt strings.

| Check | Evidence to Collect | Pass Criteria | Gap Signal |
|---|---|---|---|
| Agent registry exists | Agent definitions, DB tables, manifests | Every agent has ID, name, role, phase, goal, input contract, output contract, dependencies, tools, and lifecycle state | Agents are only prompt templates or hardcoded arrays |
| SDLC roles are modeled | Analyst, PO, architect, UX, QA, security, DevOps, PM roles | Agent roles map clearly to SDLC responsibilities | Agent names are generic or do not match actual responsibility |
| Inputs are explicit | `dependsOn`, prompt builders, API payloads | Each agent declares required upstream outputs and optional context | Agent silently reads global context or misses dependencies |
| Outputs are explicit | artifact label, schema, expected sections | Output shape is documented and validated | Output is free-form markdown with no contract |
| Agent metadata source | Postgres master tables or registry | Master agent data is loaded from Postgres/backend API | Agent sequence/names/dependencies are only in files |

Gap test:

```bash
rg -n "AgentDefinition|AgentId|dependsOn|phase|tools|maxIterations|buildUserPrompt|goal" frontend/src backend server
rg -n "master_agents|master_phase_agents|agent_dependencies|agent_runs" backend server migrations
```

## Step 2: Goal, Plan, and State Management

Goal: verify that high-level user goals become persisted, inspectable plans.

| Check | Evidence to Collect | Pass Criteria | Gap Signal |
|---|---|---|---|
| Goal decomposition | Planner, workflow engine, phase graph | Project goal becomes ordered executable steps | Phase order is hardcoded and not inspectable as a plan |
| Plan persistence | Agent run tables, plan steps, checkpoints | Plan and step state are stored in Postgres | Plan exists only in memory/browser state |
| Replanning | retry/replan code, review feedback handling | Failures or feedback create a new plan revision with reason | Re-run resets output but does not record plan revision |
| Dependencies | graph/DAG, blocking logic | Agent cannot run until dependencies are complete | Same-phase dependencies race each other |
| Human approval | approval tables/UI/state | Risky phase transitions require explicit approval | Approval state is not durable or not enforced |

Gap test:

```bash
rg -n "PHASE_ORDER|PHASE_AGENTS|REVIEW_GATES|dependsOn|getDownstream|reviewGates|plan_steps|checkpoint|revision|approvedBy" .
```

## Step 3: Tool Registry, Execution, and Governance

Goal: confirm tool use is typed, permissioned, observable, and recoverable.

| Check | Evidence to Collect | Pass Criteria | Gap Signal |
|---|---|---|---|
| Typed tool registry | tool definitions, JSON schema, Zod schema | Tools have name, description, input schema, output schema, and handler | LLM calls arbitrary functions or parses loose text |
| Permission gateway | allowlist, RBAC, policy engine | Agent tool calls pass through policy and tenant checks | Tools execute directly from runtime loop |
| Tool observability | trace table, logs, UI trace | Every tool call logs agent, run, args, result, duration, user/project | Trace is browser-only or not persisted |
| Retry and timeout | retry policy, rate-limit handling | Tool failures retry/escalate consistently | Errors become unstructured text |
| Side-effect control | action proposal table, approval gate | Write/deploy/email/repo actions require approval | Read and write tools share same path |

Gap test:

```bash
rg -n "AgentTool|inputSchema|TOOL_CALL|toolTrace|execute\\(|ActionProposal|policy|allowlist|denylist|timeout|retry" .
```

## Step 4: Memory, RAG, and Context Boundaries

Goal: verify that agents use scoped, durable, evidence-backed context.

| Check | Evidence to Collect | Pass Criteria | Gap Signal |
|---|---|---|---|
| Short-term memory | current run context, prior outputs | Agent can access current run decisions and prior artifacts | Context is rebuilt ad hoc without trace |
| Long-term memory | memory tables, retrieval APIs | Project and domain memory persist across runs in Postgres | Memory tables exist but are never used |
| RAG ingestion | document chunking, embeddings, retriever | Uploaded docs/code are chunked, embedded, retrieved, and cited | Docs are pasted into prompts directly |
| Context scoping | project ID, tenant ID, user roles | Retrieval filters enforce project and role boundaries | Shared context can leak across projects |
| Provenance | source document IDs, page/section, confidence | Derived fields trace to source and confidence | No field-level source metadata |

Gap test:

```bash
rg -n "memory_records|embedding|vector|chunk|retriever|RAG|citation|provenance|sourceDocument|contextDocuments|domainKnowledge" .
```

## Step 5: Reasoning, Reflection, and Self-Correction

Goal: confirm the app has agentic loops rather than one-shot generation.

| Check | Evidence to Collect | Pass Criteria | Gap Signal |
|---|---|---|---|
| Reasoning loop | Plan-Act-Observe-Reflect/ReAct runtime | Agent can plan, call tools, observe, revise, and finalize | Agent only sends one prompt to model |
| Self-review | validation tools, artifact rubrics | Agent checks output against rubric before finalizing | Output completeness is unchecked |
| Multi-pass improvement | draft/review/revise states | Artifacts can move through quality lifecycle | Re-run overwrites output without lifecycle |
| Failure-driven replanning | confidence thresholds, missing-input detection | Validation failure triggers clarification/retry/escalation | Agent continues despite weak output |
| Confidence exposure | UI metadata, output fields | User can see confidence, caveats, and risk | Output appears authoritative without uncertainty |

Gap test:

```bash
rg -n "FINAL_OUTPUT|PLAN_REVISION|validate_output|completeness|confidence|caveat|draft|reviewed|revised|self-check|critic|reflect" .
```

## Step 6: Multi-Agent Collaboration and Handoffs

Goal: verify that agents collaborate through typed handoffs and not just shared prompt text.

| Check | Evidence to Collect | Pass Criteria | Gap Signal |
|---|---|---|---|
| Coordinator/supervisor | orchestrator agent, routing engine | Coordinator assigns tasks and tracks progress | Orchestrator output is advisory only |
| Handoff contracts | required input/output schemas | Downstream agents validate upstream artifacts | Downstream agents slice text blindly |
| Parallel work merge | join/reconcile logic | Parallel outputs are reconciled and conflicts flagged | Parallel phase outputs never cross-check |
| Reviewer/critic role | review agent or critique service | Agents can challenge or validate each other | Human is the only reviewer |
| Collaboration trace | run timeline, handoff log | Handoffs and decisions are visible and durable | Trace exists only per-agent or browser-local |

Gap test:

```bash
rg -n "orchestrator|handoff|priorOutputs|get_agent_output|parallel|reconcile|critic|reviewer|timeline|decision" .
```

## Step 7: SDLC Lifecycle Coverage

Goal: confirm the platform covers SDLC end-to-end with real artifacts and controls.

| SDLC Area | Required Capability | Gap Signal |
|---|---|---|
| Intake | Upload docs, extract fields, ask clarifying questions, validate completeness | Upload text is prompt-stuffed without extraction provenance |
| Discovery | domain brief, assumptions, scope, stakeholder map | Discovery output is not source-linked |
| Requirements | PRD, BRD, user stories, acceptance criteria, traceability | IDs are generated but not structurally linked |
| UX | user journeys, flows, mockups, accessibility checks, style controls | Mockups lack distinct research/layout constraints |
| Architecture | options, ADRs, NFRs, integration map, tradeoffs | Diagrams exist but ADR/NFR scoring is missing |
| Development | tasks, code structure, code snippets, dependency analysis | Generated code is not compiled or validated |
| Testing | test plan, test cases, coverage gaps, automation map | Tests are generated as docs only |
| Security | threat model, secrets scan, auth/RBAC review, vulnerability scan | Security agent lacks real scanner/tool integration |
| DevOps | CI/CD, env readiness, rollback, runbooks | Infra output is not validated by tooling |
| Delivery | roadmap, RAID, status report, go-live checklist | Roadmap is narrative and not linked to sprint/risks |
| Governance | approvals, audit, policy, responsible AI rubric | Governance exists in UI but not durable/server-enforced |

Gap test:

```bash
rg -n "PRD|BRD|user story|acceptance criteria|UX|mockup|ADR|NFR|test plan|threat|rollback|roadmap|RAID|go-live|approval" frontend/src docs tests
```

## Step 8: Data Source and Master Data Validation

Goal: verify that application data comes from Postgres through APIs.

| Data Category | Expected Source | Gap Signal |
|---|---|---|
| Projects | Supabase/Postgres `projects` via backend API | Dashboard reads sample files, Dexie, or local fixtures |
| Project members | `project_members` or equivalent Postgres table | Team data stored inside JSON files only |
| Agents | `master_agents` and related phase/dependency tables | Agent names/sequence only in TypeScript constants |
| Domains | `master_domains` | Domain templates only in frontend files |
| Settings | Postgres app config via backend API | Settings stored only in env/localStorage |
| Agent runs | `agent_runs` or equivalent | Runs stored only in browser state |
| Tool traces | durable tool trace table/JSONB | Tool trace only in transient UI |
| Review gates | durable gate decisions table/JSONB | Approval state only in client object |

Gap test:

```bash
rg -n "Dexie|indexedDB|localStorage|sampleProjects|demoProjects|master_agents|master_domains|app_config|agent_runs|project_members" frontend/src backend server
```

## Step 9: Evaluation and Quality Metrics

Goal: confirm agent quality is measured continuously.

| Check | Evidence to Collect | Pass Criteria | Gap Signal |
|---|---|---|---|
| Eval datasets | golden fixtures, expected artifacts | Each major agent has eval cases | Evals cover only subset of agents |
| Task success | pass/fail criteria, acceptance checks | Agent success maps to workflow outcome | Only text contains expected words |
| Tool accuracy | schema failures, call success rate | Tool reliability metrics are captured | Tool errors are not aggregated |
| Retrieval quality | groundedness, citation matching | RAG outputs are checked against source | No RAG means no retrieval quality metric |
| Artifact quality | reviewer scores, revision count | Artifact acceptance and defects are measured | Review notes are free text only |

Gap test:

```bash
rg -n "eval|golden|score|rubric|grounded|coverage|acceptance|revision|defect|tool accuracy" tests frontend/src backend
```

## Step 10: Safety, Security, and Governance

Goal: confirm agent behavior is bounded, auditable, and safe.

| Check | Evidence to Collect | Pass Criteria | Gap Signal |
|---|---|---|---|
| Policy engine | action rules, risk levels | Tool/action decisions pass policy before execution | Policy exists but is not called |
| Sensitive approvals | deploy/delete/email/repo/ticket actions | Approval is enforced in backend before execution | UI-only approval can be bypassed |
| Prompt injection defense | instruction hierarchy, input isolation | Uploaded docs cannot override system/tool rules | Regex-only check or no document isolation |
| Secret protection | vault, redaction, scanning | Secrets never reach browser/model/logs | API keys stored in frontend/env exposed to browser |
| Audit trail | append-only events | Plans, decisions, approvals, tools, artifacts are reconstructable | Audit is split across browser and DB |
| RBAC and tenant isolation | middleware, RLS, API checks | User only accesses authorized project data | Frontend hides buttons but API lacks checks |

Gap test:

```bash
rg -n "policy|risk_level|approval|required|audit|prompt injection|sanitize|secret|redact|RLS|requireAuth|requireProjectRole|ADMIN_EMAIL_ALLOWLIST" .
```

## Step 11: Framework and Platform Alignment

Goal: verify whether the app intentionally uses or replaces known agentic patterns.

| Pattern | What to Verify | Gap Signal |
|---|---|---|
| ReAct | Thought/action/observation loop or equivalent | Tool calls are not observation-driven |
| Plan-Execute | Planner creates steps and executor performs them | Plan is fixed constants only |
| Reflection | Critic/reviewer improves output | No automated critique loop |
| Agentic RAG | Retrieval informs planning and artifact generation | Retrieval is absent or prompt stuffing |
| Multi-agent crew | Role agents collaborate with handoffs | Agents run sequentially without validation contracts |
| MCP/tool protocol | Standard discoverable tools if needed | Custom tools lack governance/discovery |
| Enterprise workflow | queues, retries, approval, audit | Durable backend exists but is disconnected |

Gap test:

```bash
rg -n "LangChain|LlamaIndex|CrewAI|AutoGen|SemanticKernel|MCP|ReAct|Plan|Observe|Reflect|AgentJob|ActionProposal" .
```

## Step 12: Maturity Classification

Use the scoring evidence to assign the current maturity level.

| Level | Description | Criteria |
|---:|---|---|
| 0 | LLM Wrapper | Sends prompt to model and returns response |
| 1 | Assisted Workflow | Generates artifacts with limited planning/state |
| 2 | Tool-Using Agent | Calls tools/APIs with some structured execution |
| 3 | Planned Agentic Workflow | Decomposes goals, tracks state, handles some failures |
| 4 | Multi-Agent SDLC System | Role agents collaborate across lifecycle with typed handoffs |
| 5 | Governed Enterprise Agentic Platform | Full Postgres source of truth, RAG, approvals, audit, safety, evals, observability |

Recommended classification method:

1. Score each checklist step from 0 to 4.
2. Any Critical item scored 0 blocks Level 4+.
3. Any source-of-truth or auth/RBAC Critical gap blocks production Level 5.
4. Use the lowest maturity area as the limiting maturity level.
5. Record both current maturity and target maturity.

## Gap Register Template

Use this table while auditing the codebase.

| Gap ID | Step | Gap | Evidence File/Line | Current Score | Target Score | Severity | Dependency | Fix Plan | Validation |
|---|---|---|---|---:|---:|---|---|---|---|
| GAP-001 | Step 8 | Example: agent master data still hardcoded | `frontend/src/agents/constants.ts` | 1 | 4 | Critical | master tables seeded | Load agents from backend API/Postgres | Build, API test, UI verifies names/sequence |

## Prioritized Remediation Backlog Template

| Priority | Fix | Why It Matters | Depends On | Validation |
|---:|---|---|---|---|
| 1 | Make Postgres the only source of truth for project/master/run data | Required for multi-user, auditable agentic platform | Supabase schema and APIs | No Dexie/project fixture reads in production path |
| 2 | Wire durable agent runs, plans, steps, and tool traces | Required for traceability and replay | Backend run APIs | Agent run visible in DB and UI timeline |
| 3 | Add permissioned ToolGateway and policy engine | Required before write-capable tools | RBAC and action policy | Sensitive actions require backend approval |
| 4 | Add RAG ingestion, retrieval, citations, and provenance | Required for grounded SDLC output | document storage and embeddings | Output cites uploaded sources |
| 5 | Add reflection/reviewer lifecycle | Required for quality beyond first draft | artifact schemas | Draft/review/revise/approve states visible |
| 6 | Add eval and quality dashboards | Required for measurable improvement | eval fixtures and telemetry | Metrics appear by agent and phase |

## Final Go/No-Go Checklist

| Final Check | Go Criteria |
|---|---|
| Agent model | Agents are explicit, role-based, dependency-aware, and loaded from governed source |
| Planning | Plans and steps are persisted, inspectable, and revisable |
| Tools | Tools are typed, permissioned, observable, retried, and policy-gated |
| Memory | Short-term and long-term memory are scoped and durable |
| RAG | Outputs cite project documents/code and enforce project scoping |
| Reflection | Major artifacts are reviewed, revised, and scored before approval |
| Multi-agent flow | Agents collaborate through typed handoffs and validation contracts |
| Human approval | Sensitive actions require enforced backend approval |
| Governance | Audit, RBAC, prompt-injection defense, and secret protection are implemented |
| Evaluation | Quality, groundedness, tool accuracy, and task success are measured |

## Recommended Audit Order for This Codebase

1. Confirm production runtime and API path: Vercel -> Railway proxy -> server/admin API -> Supabase.
2. Confirm all project/master/run data is read from Supabase/Postgres through backend APIs.
3. Inventory all agents and compare file-based definitions against database master tables.
4. Trace one full pipeline run from project creation through agent run persistence.
5. Verify tool calls are captured in durable traces and policy-gated.
6. Verify review gates are durable and enforce phase blocking.
7. Verify uploaded documents are isolated, retrievable, cited, and not prompt-stuffed.
8. Score every checklist step and fill the gap register.
9. Sort gaps by severity and dependency.
10. Create an implementation plan that fixes upstream architecture gaps before UI-only gaps.

