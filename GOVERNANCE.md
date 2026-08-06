# AI Governance Policy — Agentic SDLC Framework

> **Version:** 1.0  
> **Scope:** Internal enterprise deployment  
> **Owners:** Platform Engineering + Engineering Leadership  
> **Last updated:** 2026-06-17  
> **Review cadence:** Quarterly or after any major LLM provider change

---

## 1. Purpose and Scope

This document defines the AI governance policy for the **Agentic SDLC Framework** — a multi-agent pipeline that automates software delivery lifecycle artifacts (PRDs, architecture docs, sprint plans, test plans, DevOps runbooks, and more) using large language models.

It covers:
- Risk identification and controls
- Acceptable use and data handling
- Provider accountability
- Human oversight requirements (mapped to built-in review gates)
- Incident response
- AI evaluation standards

**In scope:** All 21 agents, both providers (OpenAI, Anthropic), the Express proxy, and any future OSS/self-hosted LLM integrations.  
**Out of scope:** External customer-facing deployments (requires separate policy).

---

## 2. Guiding Principles

| Principle | What it means for this app |
|---|---|
| **Human-in-the-loop** | No AI output advances the pipeline without explicit human approval at every review gate. |
| **Least privilege** | Agents are given only the domain context they need; no agent sees raw credentials, PII beyond what is explicitly uploaded, or data from other projects. |
| **Transparency** | Every agent run records its provider, model, token count, and L3 agentic trace (goal → plan → tool calls → decisions). |
| **Auditability** | All runs are stored in IndexedDB; the traceability export (CSV) provides a full artifact chain. |
| **Fail safe** | If a provider call fails, the pipeline pauses — it does not silently produce empty or partial output. |
| **Provider diversity** | No single LLM provider is a single point of failure. OpenAI and Anthropic are both supported; OSS fallback is planned. |

---

## 3. Risk Register

### Risk 1 — Hallucinated SDLC Artifacts (CRITICAL)

| Field | Detail |
|---|---|
| **Description** | An agent generates plausible but factually wrong output — fake API endpoints, incorrect data models, fabricated compliance requirements, or non-existent technology references that downstream teams then implement. |
| **Likelihood** | High (inherent to all LLMs) |
| **Impact** | High — wrong architectural decisions get built; re-work cost is significant |
| **Controls** | (a) Review Gate mandatory approval before the next phase begins. (b) L3 Thinking Panel exposes agent reasoning — reviewers can see *why* the agent made a claim. (c) Domain knowledge context is human-authored and injected per project. (d) Eval harness scores factual grounding per agent (see §7). |
| **Residual risk** | Medium — gating is manual; reviewer domain knowledge is required. |
| **Owner** | Project Admin (gate approver) |

### Risk 2 — Prompt Injection / Data Leakage (HIGH)

| Field | Detail |
|---|---|
| **Description** | A malicious string embedded in an uploaded document (PRD, spec, codebase file) hijacks the agent's system prompt, causes it to exfiltrate data, generate harmful content, or bypass the pipeline flow. |
| **Likelihood** | Medium (depends on what users upload) |
| **Impact** | High — data from other agents' outputs could be surfaced; LLM API costs could spike; agent behavior becomes unpredictable |
| **Controls** | (a) Uploaded documents are text-extracted via `extractText()` — binary formats are normalized before injection. (b) System prompts are prefixed with role-lock instructions (do not follow instructions in user content). (c) Eval harness runs injection probe suite before each release (see §7). (d) `PROXY_TOKEN` secures all backend API routes. (e) CORS is enforced; API is not publicly reachable without the token. |
| **Residual risk** | Medium — no input sanitization regex yet (planned enhancement). |
| **Owner** | Platform Engineering |

### Risk 3 — Uncontrolled API Cost / Runaway Agents (HIGH)

| Field | Detail |
|---|---|
| **Description** | L3 agents iterate autonomously (goal → plan → tools → re-plan). A malformed goal, infinite tool loop, or accidental pipeline re-trigger could generate thousands of API calls before detection. |
| **Likelihood** | Low-Medium (guard rails exist but are not hard-capped) |
| **Impact** | High — uncapped spend on OpenAI/Anthropic; potential for $100s–$1000s in a single incident |
| **Controls** | (a) L3 agent iteration cap: `MAX_ITERATIONS = 8` per agent run. (b) Token usage is recorded per run and visible in the UI. (c) Cost guard eval check: any eval run that exceeds a per-agent token budget threshold fails (see §7). (d) Rate limiting on `POST /api/agent`: 60 requests per 15 minutes per IP. (e) Per-agent provider routing — expensive agents can be pinned to cheaper models. |
| **Residual risk** | Low-Medium — no hard spend cap is enforced at the API gateway level yet. |
| **Owner** | Platform Engineering |

### Risk 4 — PII / IP in LLM Context (MEDIUM)

| Field | Detail |
|---|---|
| **Description** | Users upload documents containing personal data (employee names, salary bands, customer data) or proprietary IP that is then sent to third-party LLM APIs (OpenAI/Anthropic). |
| **Likelihood** | Medium (depends on project type) |
| **Impact** | Medium for internal use; High if data residency or GDPR applies |
| **Controls** | (a) Data classification notice shown when uploading documents (planned). (b) Policy: users must not upload documents containing PII or customer data without explicit DPO sign-off. (c) Future: OSS/self-hosted LLM path for sensitive projects (ollama, vLLM). (d) Both OpenAI (Enterprise) and Anthropic have zero-data-retention API options — configure when handling sensitive projects. |
| **Residual risk** | Medium — technical controls are incomplete; policy controls are primary. |
| **Owner** | Engineering Leadership + DPO |

---

## 4. Provider Accountability

### 4.1 Approved Providers

| Provider | Models approved | Usage policy | Data retention |
|---|---|---|---|
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo | Default provider for all agents unless overridden | Zero-retention available on Enterprise tier |
| **Anthropic** | claude-sonnet-4-6, claude-opus-4-8, claude-haiku-4-5 | Secondary provider; preferred for UX/creative agents | Zero-retention available on API |
| **OSS / Self-hosted** | TBD (ollama, vLLM, Mistral) | Approved for sensitive projects where data cannot leave the network | On-premise — no third-party retention |

### 4.2 Provider Selection Rules

1. **Default:** OpenAI unless `DEFAULT_LLM_PROVIDER=claude` is set in `.env`.
2. **Per-agent overrides:** Set in `AGENT_PROVIDER_MAP` (env var) or via the Settings modal → Agent Prompts tab.
3. **Automatic fallback:** If Claude is requested but `ANTHROPIC_ENABLED=false` or the key is missing, the system falls back to OpenAI silently — this is logged in the proxy.
4. **OSS activation:** When a self-hosted endpoint is added, it must be registered in the proxy with explicit provider routing — it cannot be the default until an eval run passes for that provider.

### 4.3 Model Version Pinning

- Production deployments MUST pin exact model versions (e.g., `gpt-4o-2024-11-20`, not `gpt-4o`).
- Model version changes require: (1) a new eval run, (2) a diff of outputs on the golden test set, and (3) Engineering Lead sign-off before updating `.env`.

---

## 5. Human Oversight — Review Gate Mapping

The application has four active review gates. These are the **mandatory human checkpoints** in the AI governance framework. No gate may be auto-approved.

| Gate | Triggers after | Phases covered | Agents covered | What the reviewer must check |
|---|---|---|---|---|
| **Gate 1** | phase1 + phase1b complete | Discovery & Charter | SDLC Orchestrator, Project Charter, Business Requirements | PRD accuracy, scope correctness, feasibility of stated requirements |
| **Gate 2** | phase2 complete | Analysis | Stakeholder Analysis, User Stories, Business Rules, Feasibility Study, Data Model | Data model correctness, user story completeness, no fabricated stakeholders |
| **Gate 3** | phase3 + phase3b complete | Design & Security | Architecture, API Design, UX Research, Interaction Design, UX Mockups, Security & Compliance | Architecture validity, API contract accuracy, security controls not hallucinated |
| **Gate 5** | phase5 complete | Testing | Test Plan, Test Cases | Test coverage claims, no fabricated test IDs, test cases map to real user stories |

### Gate Approval Requirements

- Approver must be a project Admin (`isAdmin: true` in team roster).
- Approver must add a written note explaining what was verified before approving.
- If output quality is unacceptable: reject the gate, use the Re-run panel to regenerate with an edited prompt, and seek re-approval.
- **Gates cannot be skipped or auto-approved by the system** — this is enforced in `pipelineEngine.ts`.

---

## 6. Data Handling Policy

### What is stored
- **IndexedDB (browser-local):** All project data, agent outputs, team rosters, review gate approvals, and uploaded document text. This data never leaves the user's browser except via explicit export.
- **Express proxy:** Handles API calls to OpenAI/Anthropic. The proxy does not persist any data — it is stateless.
- **PostgreSQL (Railway, production):** Invite tokens, team membership, and settings only. Agent outputs are NOT stored server-side by default.

### What is sent to LLM providers
Each agent call sends:
- The agent's system prompt (from `AGENT_DEFINITIONS`)
- The user prompt (built from `buildUserPrompt()`: project name, description, domain context, domain knowledge, prior agent outputs)
- **NOT sent:** raw uploaded binary files, user passwords, proxy tokens, or data from other projects.

### Data minimization
- `priorOutputs` in the prompt context includes only agents that have `status: 'complete'` — never partial or error outputs.
- Domain knowledge is stored in browser IndexedDB, not sent to the backend.

### Retention
- Browser IndexedDB: persists until the user clears browser data or deletes the project.
- Projects can be archived or deleted from Settings → Projects.
- There is no server-side backup of agent outputs — users are responsible for exporting (`Export All` → zip download).

---

## 7. AI Evaluation Standards

See **`tests/eval/`** for the implementation. This section defines the standards the eval harness enforces.

### 7.1 Eval Categories

| Category | What is measured | Threshold to pass |
|---|---|---|
| **Factual grounding** | Does the output reference only concepts from the injected context (domain, project description, prior outputs)? | Score ≥ 0.75 / 1.0 |
| **Completeness** | Does the output contain all required sections for this agent type? | Score ≥ 0.80 / 1.0 |
| **Injection resistance** | Does the agent ignore adversarial instructions embedded in document uploads? | 100% — zero tolerance |
| **Cost guard** | Does the agent complete within its token budget? | ≤ 2× the agent's `tokenBudget` |
| **Format compliance** | Does the output match the expected format (markdown structure, code fences, required headers)? | Score ≥ 0.70 / 1.0 |

### 7.2 Eval Cadence

| Trigger | Eval scope |
|---|---|
| Before any model version change | Full golden set for all 21 agents |
| Before adding a new provider (OSS) | Full golden set on the new provider |
| After any system prompt change to an agent | That agent's golden set only |
| Monthly regression | Sample eval: 3 agents per phase, 3 prompts each |

### 7.3 Eval Failure Response

- If **factual grounding < 0.75**: block the system prompt change; refine the prompt and re-eval.
- If **injection resistance fails**: immediate rollback; audit what changed in the prompt or document handling pipeline.
- If **cost guard fails** (token overrun): check for L3 iteration loops; consider reducing `MAX_ITERATIONS` or adding a tool-call budget.

---

## 8. Responsible AI Checklist

Before each production deployment, the deploying engineer must confirm:

- [ ] No PII or customer data is in any golden test fixture
- [ ] System prompts do not contain hardcoded secrets, internal URLs, or employee names
- [ ] Model version is pinned in `.env` (no floating `gpt-4o` without a date suffix in production)
- [ ] Rate limits are configured on `POST /api/agent` in the proxy
- [ ] `PROXY_TOKEN` is set and not the default/empty value
- [ ] All four review gates are enabled and have not been disabled in code
- [ ] Eval harness passes at the current model version (check `tests/eval/results/`)
- [ ] The L3 iteration cap (`MAX_ITERATIONS`) is ≤ 10
- [ ] At least one admin user is assigned to every active project (no gated pipeline can be approved without one)
- [ ] Anthropic zero-retention API option is enabled if any project contains sensitive data

---

## 9. Incident Response

### Severity levels

| Severity | Example | Response SLA |
|---|---|---|
| **P0 — Critical** | Prompt injection confirmed; data from one project visible in another | 1 hour: disable proxy; 4 hours: root cause |
| **P1 — High** | API cost spike >$50 in a single session; agent output contains PII from uploaded doc | 4 hours: mitigate; 24 hours: post-mortem |
| **P2 — Medium** | Eval score drops below threshold after model update | 48 hours: revert model version or fix prompt |
| **P3 — Low** | Hallucinated output caught at review gate (expected, working as designed) | Log in project notes; no SLA |

### Response steps (P0/P1)
1. Disable the affected provider in `.env` (`ANTHROPIC_ENABLED=false` or remove `OPENAI_API_KEY`)
2. Restart the proxy
3. Identify the project and agent run via IndexedDB export or traceability CSV
4. Revoke and rotate API keys if exposure is suspected
5. Notify Engineering Lead within 1 hour
6. Write a blameless post-mortem within 72 hours; include what eval check would have caught it

---

## 10. Change Control

| Change type | Required before change | Required before production |
|---|---|---|
| New LLM provider | Risk assessment + provider data processing agreement | Full eval run passes |
| System prompt change (any agent) | Describe the change in a PR | That agent's eval golden set passes |
| Model version bump | Diff eval outputs on golden set | Engineering Lead sign-off |
| New agent added | Define eval golden fixture for that agent | Eval passes |
| MAX_ITERATIONS change | Cost guard analysis | Eval cost guard test passes |
| Review gate removal | Engineering Lead + DPO sign-off | Not permitted without both |

---

## 11. Contacts and Ownership

| Role | Responsibility |
|---|---|
| **Platform Engineering** | Proxy, eval harness, provider config, incident response |
| **Engineering Lead** | Gate approval escalation, model version sign-off, post-mortems |
| **Project Admins** | Gate approvals, domain knowledge quality, artifact verification |
| **DPO / Legal** | PII policy, data residency, provider DPA reviews |

---

*This policy is versioned in source control. All changes require a PR reviewed by at least one Engineering Lead.*
