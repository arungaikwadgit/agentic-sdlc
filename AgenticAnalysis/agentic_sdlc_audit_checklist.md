\# Agentic SDLC Application Audit Checklist



\## Purpose

Use this checklist to review an existing agentic SDLC application, assess phase-based artifact generation, evaluate agent orchestration and governance, and produce a prioritized remediation plan.



This version is tailored for a TypeScript/Node-style codebase with GitHub Actions, modular agents, and cloud-friendly deployment patterns.



\## How to use

1\. \*\*Step 0: Review the entire repository first\*\* to understand the overall architecture, folder structure, entry points, dependencies, agent patterns, workflows, configs, prompts, schemas, tests, and deployment setup.

2\. Identify the application’s main execution path, orchestration model, agent inventory, tool inventory, and artifact generation flow before evaluating individual SDLC phases.

3\. After the repo-wide review, run the checklist phase by phase.

4\. Fill `Status`, `Severity`, and `Notes` in each table row.

5\. Log remediation items in Phase 6 and link them to PRs or issues.



\---



\## Step 0A: Repository-wide review and inventory



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 0A.1 | What is the overall architecture of the application? | Repo map, top-level folders, README, architecture docs | `find . -maxdepth 2 -type d | sort` |  |  |  |

| 0A.2 | What is the primary entry point or runtime path? | Main app file, server bootstrap, CLI entry, orchestration start point | `grep -R "main\\\\|bootstrap\\\\|start\\\\|listen" -n src app .` |  |  |  |

| 0A.3 | What agents, tools, prompts, schemas, and workflows exist? | Directory scan, registry files, prompt templates, schemas | `find src app agents tools prompts schemas workflow orchestration -type f 2>/dev/null` |  |  |  |

| 0A.4 | What SDLC phases are currently supported? | Phase folders, routes, UI tabs, workflow modules | `grep -R "requirements\\\\|design\\\\|implementation\\\\|testing\\\\|deployment\\\\|ops" -n src app docs` |  |  |  |

| 0A.5 | What dependencies and integrations are in use? | package.json, SDKs, APIs, CI/CD, cloud services | `cat package.json 2>/dev/null \&\& cat pnpm-workspace.yaml 2>/dev/null \&\& grep -R "azure\\\\|openai\\\\|anthropic\\\\|langgraph\\\\|autogen" -n .` |  |  |  |

| 0A.6 | What tests, evals, logs, and deployment assets exist? | Test folders, eval harness, workflows, infra files | `find tests eval .github/workflows infra -type f 2>/dev/null` |  |  |  |



\---



\## Suggested repo areas to inspect



\- `src/`

\- `app/`

\- `agents/`

\- `orchestration/`

\- `workflow/`

\- `tools/`

\- `prompts/`

\- `schemas/`

\- `.github/workflows/`

\- `config/`

\- `docs/`

\- `tests/`

\- `eval/`

\- `infra/`



\---



\## Phase 0: Scope and inventory



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 0.1 | Is the application intended for one SDLC phase or multiple phases? | README, product docs, UI flows, route definitions | `grep -R "requirements\\\\|design\\\\|test\\\\|deploy\\\\|ops" -n README\* docs/ src/ app/` |  |  |  |

| 0.2 | Are all agent roles documented? | Agent registry, roles file, manifest | `find src agents app -type f | xargs grep -n "role\\\\|agent" 2>/dev/null` |  |  |  |

| 0.3 | Are model choices configurable? | Env vars, config schema, runtime settings | `grep -R "OPENAI\\\\|ANTHROPIC\\\\|CLAUDE\\\\|MODEL" -n src config .env\*` |  |  |  |

| 0.4 | Are tool permissions documented? | Tool registry, allowlists, policy files | `grep -R "tool\\\\|allowlist\\\\|permission\\\\|scope" -n src config docs/` |  |  |  |

| 0.5 | Is there a clear artifact output contract? | Schemas, JSON/YAML outputs, export templates | `find schemas src -type f | xargs grep -n "zod\\\\|schema\\\\|openapi\\\\|artifact" 2>/dev/null` |  |  |  |



\---



\## Phase 1: Architecture and orchestration review



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 1.1 | Single orchestrator, multi-agent, or both? | Workflow engine, orchestration code | `grep -R "orchestrator\\\\|workflow\\\\|dag\\\\|pipeline" -n src app orchestration workflow` |  |  |  |

| 1.2 | Can mode switch by task type? | Routing rules, conditional logic | `grep -R "route\\\\|router\\\\|selector\\\\|policy" -n src config` |  |  |  |

| 1.3 | Independent tasks executed in parallel? | Worker queue, async execution, concurrency controls | `grep -R "Promise.all\\\\|parallel\\\\|concurrent\\\\|queue" -n src` |  |  |  |

| 1.4 | Shared and phase-local contexts separated? | Memory design, session model, context stores | `grep -R "memory\\\\|context\\\\|session\\\\|state" -n src` |  |  |  |

| 1.5 | Merge/reconciliation after parallel work? | Join logic, conflict resolution | `grep -R "merge\\\\|reconcile\\\\|conflict\\\\|join" -n src` |  |  |  |

| 1.6 | Retries, checkpoints, resumability implemented? | Job persistence, checkpoints, retry policies | `grep -R "retry\\\\|checkpoint\\\\|resume\\\\|idempot" -n src` |  |  |  |



\---



\## Phase 2: SDLC phase capability review



\### Requirements



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 2.1.1 | Can the app generate PRDs or equivalent scope documents? | Templates, output samples | `grep -R "PRD\\\\|product requirement\\\\|scope document" -n src docs prompts` |  |  |  |

| 2.1.2 | Can it create user stories and acceptance criteria? | Story templates, generators | `grep -R "user story\\\\|acceptance criteria" -n src docs prompts` |  |  |  |

| 2.1.3 | Does it detect ambiguity or ask clarifying questions? | Clarifier agent code, dialogue flow | `grep -R "clarif\\\\|ambigu\\\\|missing info\\\\|follow-up" -n src` |  |  |  |

| 2.1.4 | Does it capture risks, assumptions, dependencies? | Risk register, dependency list | `grep -R "risk\\\\|assumption\\\\|dependency" -n src docs prompts` |  |  |  |

| 2.1.5 | Does it support stakeholder or compliance review? | Approval workflow, reviewer list | `grep -R "approval\\\\|review\\\\|sign-off" -n src` |  |  |  |



\### Design



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 2.2.1 | Can the app generate UX flows or wireframe-ready outputs? | UX artifacts, diagrams, prompts | `grep -R "ux\\\\|wireframe\\\\|flow\\\\|journey" -n src docs prompts` |  |  |  |

| 2.2.2 | Can it produce architecture notes or ADRs? | ADR folder, generators | `find docs -iname "\*adr\*" -o -iname "\*architecture\*" 2>/dev/null` |  |  |  |

| 2.2.3 | Can it generate API contracts or interface definitions? | OpenAPI specs, interface docs | `find . -iname "openapi.\*" -o -iname "\*api\*contract\*" 2>/dev/null` |  |  |  |

| 2.2.4 | Does it check design consistency against requirements? | Traceability matrix, critique output | `grep -R "traceability\\\\|consisten\\\\|validate design" -n src docs` |  |  |  |

| 2.2.5 | Does it identify unresolved design decisions? | Decision log, open questions | `grep -R "decision\\\\|open question\\\\|TBD" -n docs src` |  |  |  |



\### Implementation



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 2.3.1 | Can it produce task breakdowns or implementation plans? | Task generation, issue templates | `grep -R "task breakdown\\\\|implementation plan\\\\|backlog" -n src docs prompts` |  |  |  |

| 2.3.2 | Is the repo structure understood by agent logic? | Repo indexer, code map | `grep -R "repo scan\\\\|code map\\\\|file index\\\\|indexRepo" -n src` |  |  |  |

| 2.3.3 | Can it scaffold code or prototype assets? | Scaffolding outputs, generators | `grep -R "scaffold\\\\|generate.\*file\\\\|prototype" -n src` |  |  |  |

| 2.3.4 | Does it constrain changes to intended files? | Patch rules, file whitelist | `grep -R "allowlist\\\\|whitelist\\\\|file scope\\\\|sandbox" -n src` |  |  |  |

| 2.3.5 | Does it validate build or compile success? | CI build logs, test runs | `cat .github/workflows/\*.yml 2>/dev/null` |  |  |  |



\### Testing



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 2.4.1 | Can it generate test plans from requirements? | Test plan generator, templates | `grep -R "test plan\\\\|test matrix\\\\|coverage plan" -n src docs prompts` |  |  |  |

| 2.4.2 | Can it generate unit, integration, or e2e tests? | Test files, coverage | `find . -path "\*test\*" -o -path "\*spec\*" | head` |  |  |  |

| 2.4.3 | Does it map tests back to acceptance criteria? | Trace links, metadata | `grep -R "acceptance.\*test\\\\|trace.\*test\\\\|AC-" -n test tests src` |  |  |  |

| 2.4.4 | Does it suggest missing test coverage? | Coverage reports, gap analysis | `find . -iname "coverage\*" -o -iname "\*coverage\*.json" 2>/dev/null` |  |  |  |

| 2.4.5 | Can it triage failures or propose fixes? | Failure analyzer, repair agent | `grep -R "triage\\\\|repair\\\\|fix suggestion\\\\|failure analysis" -n src` |  |  |  |



\### Deployment and operations



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 2.5.1 | Can it generate release checklists? | Release artifacts, templates | `grep -R "release checklist\\\\|release notes" -n src docs prompts` |  |  |  |

| 2.5.2 | Can it generate rollback or recovery steps? | Runbooks, rollback scripts | `grep -R "rollback\\\\|recovery\\\\|runbook" -n src docs` |  |  |  |

| 2.5.3 | Can it produce environment-specific deployment notes? | k8s manifests, env configs | `find infra . -iname "\*deploy\*" -o -iname "values\*.yml" -o -iname "\*.yaml" | head` |  |  |  |

| 2.5.4 | Can it support incident or ops documentation? | Postmortem templates, incident docs | `grep -R "postmortem\\\\|incident\\\\|ops runbook" -n docs src` |  |  |  |

| 2.5.5 | Does it reference telemetry or observability data? | Logs, monitoring integrations | `grep -R "prometheus\\\\|grafana\\\\|otel\\\\|sentry\\\\|datadog" -n src infra` |  |  |  |



\---



\## Phase 3: Agent execution and routing review



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 3.1 | Is there a model-routing layer? | Router code, policies | `grep -R "model.\*router\\\\|semantic router\\\\|model\_selector" -n src` |  |  |  |

| 3.2 | Models selected by complexity, latency, or cost? | Routing rules and metrics | `grep -R "cost\\\\|latency\\\\|quality\\\\|budget" -n src config docs` |  |  |  |

| 3.3 | Tools selected dynamically per task? | Tool registry, JIT injection | `grep -R "tool registry\\\\|inject.\*tool\\\\|availableTools" -n src` |  |  |  |

| 3.4 | System avoids exposing all tools at once? | Prompt assembly, tool loading | `grep -R "load.\*tool\\\\|prompt.\*tool" -n src` |  |  |  |

| 3.5 | Agent role behavior configurable per phase? | Role templates, prompt config | `find prompts config -type f | xargs grep -n "role\\\\|system prompt\\\\|phase" 2>/dev/null` |  |  |  |

| 3.6 | Is there a verifier or critique agent? | Review workflow, scoring logic | `grep -R "critique\\\\|verify\\\\|score\\\\|judge" -n src` |  |  |  |

| 3.7 | Can the system re-route or retry after failure? | Fallback flows, retry policies | `grep -R "fallback\\\\|retry\\\\|reroute" -n src` |  |  |  |



\---



\## Phase 4: Governance, safety, and audit review



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 4.1 | Are agent permissions least-privilege? | IAM, scopes, policy docs | `grep -R "permission\\\\|scope\\\\|least privilege\\\\|IAM" -n src infra docs` |  |  |  |

| 4.2 | Are sensitive actions gated by approval? | Approval workflows, HITL steps | `grep -R "approval\\\\|human-in-the-loop\\\\|sign-off" -n src` |  |  |  |

| 4.3 | Are all agent actions logged? | Audit logs, traces, structured logs | `grep -R "audit\\\\|trace\\\\|logger" -n src` |  |  |  |

| 4.4 | Is there traceability from output to source input? | Lineage metadata, citations | `grep -R "lineage\\\\|sourceId\\\\|citation\\\\|provenance" -n src docs` |  |  |  |

| 4.5 | Are policy checks enforced before execution? | Guards, rules engine | `grep -R "policy\\\\|guard\\\\|precheck\\\\|validator" -n src` |  |  |  |

| 4.6 | Are outputs tagged by confidence or risk? | Metadata in artifacts | `grep -R "confidence\\\\|riskScore\\\\|risk label" -n src` |  |  |  |

| 4.7 | Are data boundaries and PII controls defined? | Redaction, masking, data policy | `grep -R "PII\\\\|redact\\\\|mask\\\\|sensitive data" -n src docs` |  |  |  |



\---



\## Phase 5: Quality, evaluation, and regression review



| Check | Question | Evidence to collect | Command / File hints | Status | Severity | Notes |

|---|---|---|---|---|---|---|

| 5.1 | Are outputs tested against a rubric? | Evaluation harness, scorecards | `find eval tests -type f | xargs grep -n "rubric\\\\|score" 2>/dev/null` |  |  |  |

| 5.2 | Are there regression tests for prompts/workflows? | CI tests, golden datasets | `grep -R "golden\\\\|regression\\\\|snapshot" -n tests eval src` |  |  |  |

| 5.3 | Are artifact outputs versioned? | Artifact store, git tags, snapshots | `git tag --list \&\& find artifacts -maxdepth 2 -type f 2>/dev/null` |  |  |  |

| 5.4 | Is artifact drift detected when context changes? | Invalidation rules, diff checks | `grep -R "stale\\\\|invalidate\\\\|drift\\\\|diff" -n src` |  |  |  |

| 5.5 | Are hallucinations/omissions measured? | QA logs, defect tracking | `grep -R "hallucinat\\\\|omission\\\\|quality issue" -n src docs` |  |  |  |

| 5.6 | Is there a feedback loop from human review into the system? | Review capture, prompt update flow | `grep -R "feedback\\\\|review capture\\\\|human review" -n src` |  |  |  |



\---



\## Phase 6: Remediation planning



| Gap | Severity | Suggested fix | Owner | Target date | PR / Issue |

|---|---|---|---|---|---|

|  |  |  |  |  |  |

|  |  |  |  |  |  |

|  |  |  |  |  |  |



\---



\## Severity guidance



\- Critical: unsafe, non-compliant, or capable of harmful side effects.

\- High: materially reduces reliability, traceability, or artifact quality.

\- Medium: weakens scalability, usability, or maintainability.

\- Low: improvement opportunity without immediate impact.



\---



\## Suggested review order



1\. Review the entire repository (Step 0A).

2\. Architecture and orchestration (Phase 1).

3\. Governance and safety (Phase 4).

4\. SDLC phase capabilities (Phase 2).

5\. Agent routing and execution (Phase 3).

6\. Quality, evaluation, and regression (Phase 5).

7\. Remediation planning (Phase 6).



\---



\## Deliverables to capture



\- Architecture diagram.

\- Agent inventory.

\- Tool inventory.

\- Phase-by-phase artifact samples.

\- Governance and audit evidence.

\- Gap register with severity and PR links.

\- Remediation backlog.



\---



\## Optional automated PR check



If you want to automate the audit in GitHub Actions, add a workflow that:



\- Greps for key agent, model, tool, and governance patterns.

\- Checks presence of phase-specific docs and schemas.

\- Fails if Critical controls are missing.

\- Posts a summary comment with severity and remediation hints.



\---



\## Appendix: quick command bundle



```bash

grep -R "orchestrator\\\\|workflow\\\\|router\\\\|agent" -n src app docs config

grep -R "OPENAI\\\\|ANTHROPIC\\\\|MODEL" -n src config .env\*

grep -R "approval\\\\|audit\\\\|trace\\\\|policy\\\\|guard" -n src docs infra

grep -R "PRD\\\\|user story\\\\|acceptance criteria\\\\|test plan\\\\|rollback" -n src docs prompts

cat .github/workflows/\*.yml 2>/dev/null

```



\## Notes



\- Add project-specific file paths once the repo structure is confirmed.

\- Replace generic grep commands with exact code paths if your app uses a monorepo or nonstandard layout.

\- Update the checklist after each architecture change so the audit remains current.

