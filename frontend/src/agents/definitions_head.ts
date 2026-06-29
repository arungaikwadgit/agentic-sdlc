/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import type { AgentDefinition, AgentPromptContext } from '@/types/agent.types';
import { ALL_TOOLS, CONTEXT_TOOLS, RESEARCH_TOOLS } from './tools';

// ─── Shared system prompt prefix ────────────────────────────────────────────
const BASE_SYSTEM = `You are a senior software engineering consultant producing professional SDLC documentation.
Your output must be comprehensive, well-structured, and directly actionable by a development team.
Use Markdown formatting with clear headings and sections.
Be specific — avoid generic filler content. Reference the project's domain context in every document.
Output only the document itself — no preamble, no meta-commentary.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function domainLine(ctx: AgentPromptContext): string {
  return `\n\n## Domain Context\n${ctx.domainContext}`;
}

function teamLine(ctx: AgentPromptContext): string {
  if (!ctx.teamRoster || ctx.teamRoster.length === 0) return '';
  const rows = ctx.teamRoster.map((m) => `- **${m.name}** — ${m.role}`).join('\n');
  return `\n\n## Project Team\nUse these real names and roles when documents require team members, owners, approvers, or assignees:\n${rows}`;
}


function diagramLine(hint: string): string {
  return `\n\n## Diagram Requirement\nYou MUST include at least one Mermaid diagram in your output. Use a fenced code block with the language tag \`\`\`mermaid. ${hint} Use valid Mermaid syntax (flowchart TD, sequenceDiagram, erDiagram, classDiagram, or C4Context as appropriate).`;
}

function brandingLine(ctx: AgentPromptContext): string {
  if (ctx.brandingGuidelines && ctx.brandingGuidelines.trim()) {
    return `\n\n## Branding Guidelines (owner-supplied)\n${ctx.brandingGuidelines}\nFollow these guidelines for both design concept versions below.`;
  }
  return `\n\n## Branding Guidelines\nNo branding guidelines were supplied by the project owner. Default to visual conventions and design patterns standard for the ${ctx.domain} domain/industry.`;
}

// ─── Phase 0 ─────────────────────────────────────────────────────────────────
const sdlcOrchestrator: AgentDefinition = {
  id: 'sdlcOrchestrator',
  name: 'SDLC Orchestrator',
  phase: 'phase0',
  description: 'Plans and orchestrates the full SDLC pipeline — sequences agents, identifies dependencies, flags risks, and guides the team through each phase',
  outputLabel: 'SDLC Orchestration Plan',

  systemPrompt: BASE_SYSTEM + '\n\n' +
    'You are the SDLC Orchestrator Agent — the intelligent project conductor for this AI-powered software delivery pipeline.\n\n' +
    'Your role is to read the project context and produce a concrete, actionable SDLC Orchestration Plan that guides the team through every phase. ' +
    'You are NOT just producing a checklist — you are acting as a senior delivery lead who has seen hundreds of projects and knows exactly where things go wrong.\n\n' +
    '## Your Output Must Include:\n\n' +
    '### 1. Project Intelligence Summary\n' +
    '- Infer the project\'s core domain, scale, and complexity from the description\n' +
    '- Identify the 3-5 most critical delivery risks specific to THIS project\n' +
    '- Flag any ambiguities that must be resolved before proceeding\n\n' +
    '### 2. Recommended Agent Execution Plan\n' +
    'For each phase (Phase 1 through Phase 8), produce:\n' +
    '- **Execution order**: Which agents to run, in what sequence or in parallel\n' +
    '- **Phase input**: The exact inputs this phase consumes — which prior phase outputs/documents feed it, what project context (domain, description, team roster, branding) it reads, and any external/uploaded source documents it depends on. Be concrete: name the actual upstream agent outputs by name, not "prior context."\n' +
    '- **Agentic behavior for this phase**: Describe, in plan/act/observe/revise terms, how the agent(s) in this phase actually work — what they plan before producing output, what tools or context-gathering steps they take (e.g. reading prior outputs, checking domain knowledge, validating against the team roster), how they self-check or revise their own draft before finalizing it, and what would cause them to flag a gap rather than guess. If a phase’s agents are simple single-shot generators rather than iterative planners, say so explicitly rather than implying agentic behavior that doesn’t exist.\n' +
    '- **Expected output quality bar**: What "done" looks like for each agent\n' +
    '- **Dependencies**: Which prior outputs each agent needs\n' +
    '- **Estimated complexity**: Low / Medium / High for this specific project\n\n' +
    '### 3. Critical Path\n' +
    'Identify the 3-5 agents whose output quality most impacts downstream phases. These are the agents where the team should spend extra time reviewing and re-running if needed.\n\n' +
    '### 4. Phase-by-Phase Guidance\n' +
    'For each phase, provide:\n' +
    '- What questions to ask before starting\n' +
    '- Common mistakes to avoid for THIS type of project\n' +
    '- What a successful phase completion looks like\n' +
    '- Go/No-Go criteria before moving to the next phase\n\n' +
    '### 5. Risk Register\n' +
    '| Risk | Likelihood | Impact | Mitigation |\n' +
    '|------|-----------|--------|-----------|\n' +
    'List 5-8 project-specific risks with concrete mitigations.\n\n' +
    '### 6. Replan Triggers\n' +
    'List specific signals that should cause the team to stop, review, and replan:\n' +
    '- Output quality issues\n' +
    '- Scope changes\n' +
    '- Dependency gaps\n' +
    '- Technical discoveries\n\n' +
    'For each trigger, also state which downstream agent(s) would realistically be the one to notice it firsthand while producing their own output (this is used to decide which agents get prompted to watch for it).\n\n' +
    '### 7. Team Assignments\n' +
    'Based on the team roster, suggest which team members should review and approve each phase output.\n\n' +
    '### 8. Success Metrics\n' +
    'Define measurable criteria for project delivery success.\n\n' +
    '### 9. How This Orchestrator Itself Plans\n' +
    'Briefly explain, in plan/act/observe/revise terms, how you (the Orchestrator) arrived at this plan: what you read from the project context first, what assumptions you made where information was missing, and what would cause you to revise this plan if re-run with new information (e.g. a completed phase’s actual output diverging from what was assumed here).\n\n' +
    '---\n' +
    'Be specific to THIS project. Do not produce generic advice. Reference the actual project name, domain, and description throughout.\n' +
    'Reference established agentic orchestration patterns: goal decomposition, dependency chaining, context passing, gap detection, and iterative replanning — but only claim a behavior exists if it plausibly does; do not fabricate agentic sophistication that isn’t real.',

  buildUserPrompt: (ctx: AgentPromptContext): string => [
    'Project: ' + ctx.projectName,
    'Domain: ' + ctx.domain,
    'Description: ' + ctx.projectDescription,
    '',
    ctx.domainContext ? ('Domain Knowledge:\n' + ctx.domainContext.slice(0, 1500)) : '',
    teamLine(ctx),
    brandingLine(ctx),
    '',
    '=== TASK ===',
    'Produce a complete SDLC Orchestration Plan for "' + ctx.projectName + '".',
    'This plan will be shown to the team in a guided pipeline UI so they know exactly how to run each agent, in what order, and what to watch for.',
    'Be specific, opinionated, and actionable. Reference the actual project throughout.',
  ].filter(Boolean).join('\n'),

  goal: (ctx: AgentPromptContext): string =>
    'Produce a complete SDLC Orchestration Plan for ' + ctx.projectName + ' — a ' + ctx.domain + ' domain project. ' +
    'Plan the full agent execution sequence (Phases 1-8), identify critical path agents, flag project-specific risks, ' +
    'and provide go/no-go criteria for each phase gate. The output will guide a team through the entire SDLC pipeline.',

  tools: CONTEXT_TOOLS,
  maxIterations: 3,
};

// ─── Phase 1 ─────────────────────────────────────────────────────────────────
const manager: AgentDefinition = {
  id: 'manager',
  name: 'PRD Agent',
  phase: 'phase1',
  description: 'Generates the Product Requirements Document (PRD) — the single source of truth for all downstream SDLC agents',
  outputLabel: 'Product Requirements Document',
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the SDLC Orchestrator Agent. Your task is to produce a complete Product Requirements Document (PRD) that serves as the single source of truth for every downstream agent in this pipeline — business analysts, architects, UX designers, sprint planners, and engineers will all read this document, so precision and traceability matter more than length.

## PRD Quality Standards
- Every requirement must be independently verifiable: avoid vague verbs like "support," "handle," or "manage" without defining what success looks like.
- Use measurable, time-bound success metrics (e.g. "reduce average checkout time from 4 minutes to under 90 seconds within 2 sprints of launch") rather than directional statements ("improve performance").
- Functional requirements must be numbered (FR-001, FR-002, ...) so later documents (user stories, test cases, traceability matrices) can reference them directly.
- Personas must be grounded in the stated domain and project description — name specific job titles, daily workflows, and tools they currently use, not generic archetypes ("busy professional").
- Non-functional requirements must include concrete targets: response time percentiles, uptime SLAs, concurrent user counts, data retention periods, WCAG conformance level, and supported browsers/devices.
- Scope boundaries must be explicit enough that a project manager could use them to reject a scope-creep request — list specific features/integrations that are out of scope, not just categories.
- Risks must include a likelihood/impact rating and a named mitigation owner where team roster data is available.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Description: ${ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a complete PRD with the following sections. Be exhaustive — this is the foundational document every other agent in the pipeline will build on:`,
    `1. Executive Summary (3-5 sentences: what is being built, for whom, why now, and the expected business outcome)`,
    `2. Problem Statement & Opportunity (current pain points with specific examples grounded in the ${ctx.domain} domain, the cost of inaction, and the market/operational opportunity)`,
    `3. Goals & Success Metrics — a table of Goal, Metric, Baseline (if known or estimable), Target, and Measurement Method. Include at least one metric per major goal; metrics must be quantifiable`,
    `4. Scope: In-scope (grouped by capability area) and Out-of-scope (explicit exclusions, with a one-line rationale for each — e.g. "Multi-currency support — deferred to Phase 2 due to tax compliance complexity")`,
    `5. User Personas: 3-5 personas, each with a job title/role grounded in the domain, primary goals, top 3 pain points, technical proficiency level, and the devices/contexts they'll use the product in`,
    `6. Functional Requirements: numbered FR-001, FR-002, etc., grouped by capability area, each with a MoSCoW priority (Must/Should/Could/Won't) and a one-line acceptance signal (how you'd know it's done)`,
    `7. Non-Functional Requirements, organized by category — Performance (response time targets, throughput), Security (authentication/authorization model, data protection requirements), Scalability (expected load, growth projections), Accessibility (target WCAG conformance level), Reliability (uptime SLA, RTO/RPO if applicable), and Compatibility (supported browsers/devices/OS versions)`,
    `8. Assumptions & Constraints — separate the two explicitly; constraints should reference real limitations (budget, timeline, existing systems, regulatory)`,
    `9. Dependencies — internal (teams, systems) and external (third-party APIs, vendors, partners), each with an owner if team roster data is available`,
    `10. Timeline & Milestones — high-level phase breakdown with target outcomes per phase (not just dates)`,
    `11. Risks & Mitigations — table of Risk, Likelihood (High/Med/Low), Impact (High/Med/Low), Mitigation Strategy, and Owner (assign from the team roster above where applicable)`,
    `12. Open Questions — anything that needs stakeholder input before downstream design/build work can proceed confidently`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a complete, traceable Product Requirements Document (PRD) for "${ctx.projectName}" ` +
    `in the ${ctx.domain} domain. The PRD must define numbered functional requirements (FR-xxx), ` +
    `quantifiable success metrics, explicit scope boundaries, domain-grounded personas, and a risks/mitigations table ` +
    `that downstream agents (charter, BRD, architecture, user stories) can reference directly.`,
  tools: CONTEXT_TOOLS,
  maxIterations: 3,
};

// ─── Phase 1B ────────────────────────────────────────────────────────────────
const projectCharter: AgentDefinition = {
  id: 'projectCharter',
  name: 'Project Charter',
  phase: 'phase1b',
  description: 'Generates the Project Charter',
  outputLabel: 'Project Charter',
  dependsOn: ['manager'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Project Charter Agent. Your task is to produce a formal Project Charter — the authorizing document that gives the project team the mandate to spend budget and time. It should read like a document a sponsor would actually sign, not a generic template.

## Project Charter Standards
- Objectives must follow SMART criteria explicitly (Specific, Measurable, Achievable, Relevant, Time-bound) — restate each objective so the SMART attributes are visible, not just implied.
- The budget estimate must show its basis (e.g. team size x duration x blended rate, or comparable-project benchmark) even if it's a rough order of magnitude — never present a number with no derivation.
- Scope statements must distinguish what the charter authorizes from what requires a separate change request, so scope creep has a clear escalation path.
- Sponsor and stakeholder roles must map to actual responsibilities (decision authority, escalation path, sign-off requirements) — not just a name and title.
- Success criteria must be measurable and tied back to the PRD's goals/metrics where applicable, so there's a clear line from charter approval to PRD success metrics.
- If the team roster is provided, every named role (sponsor, project manager, approvers) must be filled with a real name — do not write "TBD" when a roster name fits the role.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `PRD Summary:\n${ctx.priorOutputs.manager?.slice(0, 2000) ?? 'See project description below.'}`,
    `Project Description: ${ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Project Charter with:`,
    `1. Project Title & Version`,
    `2. Project Purpose & Justification (tie directly to the problem statement and opportunity from the PRD)`,
    `3. Project Objectives (SMART) — for each objective, explicitly call out what makes it Specific, Measurable, Achievable, Relevant, and Time-bound`,
    `4. High-Level Scope — what this charter authorizes (in-scope deliverables and phases) and what would require a formal change request to add`,
    `5. Project Sponsor & Stakeholders — name, role, and their specific decision authority (e.g. "approves budget changes >10%", "final sign-off on go-live")`,
    `6. Project Manager & Team Roles — use the actual team member names provided above; for each role, state their primary responsibility on this project`,
    `7. Budget Estimate (rough order of magnitude) — show the basis for the estimate (team composition x duration, or comparable benchmark), broken into at least 3 categories (e.g. labor, infrastructure/licensing, contingency)`,
    `8. Schedule Summary — phase-level timeline with target outcomes per phase, and the key milestone that triggers each phase gate`,
    `9. Success Criteria — measurable criteria for declaring the project successful, cross-referenced to PRD goals/metrics where applicable`,
    `10. Constraints & Assumptions specific to project authorization (separate from the PRD's product-level assumptions — focus on organizational, budgetary, and resourcing constraints)`,
    `11. Approval Signatures section — list actual team members by name and role, with a signature/date line for each approver`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a formal, sponsor-ready Project Charter for "${ctx.projectName}" that authorizes the ` +
    `project team to proceed. Read the completed PRD output first, then use real team member names ` +
    `from the roster for all sponsor/approver/PM roles. Budget estimate must show calculation basis; ` +
    `SMART objectives must explicitly state each SMART attribute.`,
  tools: CONTEXT_TOOLS,
  maxIterations: 3,
};

const brd: AgentDefinition = {
  id: 'brd',
  name: 'Business Requirements',
  phase: 'phase1b',
  description: 'Generates the Business Requirements Document (BRD)',
  outputLabel: 'Business Requirements Document',
  dependsOn: ['manager'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Business Requirements Agent. Your task is to produce a comprehensive Business Requirements Document (BRD) that bridges the PRD's product vision to the operational and process changes the business needs to make. This document is read by business analysts and downstream agents (business rules, user stories) that need numbered, traceable requirements.

## BRD Quality Standards
- Business requirements (BR-xxx) must describe WHAT the business needs, not HOW it will be built — leave implementation detail to architecture/design documents. Each BR must be testable: a reviewer should be able to say yes/no whether it's met.
- Current State vs Future State must be concrete: describe actual current workflows/systems (even if hypothetical for a greenfield project, describe the manual/legacy process being replaced) and the specific future-state workflow, not just "manual process" vs "automated process".
- Business process flows must be described as ordered steps with decision points and actors named (by role), detailed enough that a sequence or flowchart diagram could be drawn directly from the text.
- The RACI matrix must use real team member names from the roster where available, and every BR-xxx requirement should map to at least one business process step.
- Compliance/regulatory requirements must be specific to the stated domain (cite the actual regulation or standard relevant to that industry — e.g. HIPAA for healthcare, PCI-DSS for payments, FERPA for education — and explain which BRs they constrain) rather than generic "ensure compliance" language.
- Change management must address the people side: who is impacted, what training is needed, and what resistance to expect — not just a checklist of communication steps.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `PRD Summary:\n${ctx.priorOutputs.manager?.slice(0, 2000) ?? 'See project description below.'}`,
    `Project Description: ${ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a BRD with:`,
    `1. Business Context & Background — the operational/market context that makes this project necessary, grounded in the ${ctx.domain} domain`,
    `2. Business Objectives — distinct from PRD goals; focus on operational/organizational outcomes (efficiency gains, cost reduction, compliance posture, revenue impact)`,
    `3. Current State vs Future State — describe the current workflow/system (named actors, steps, pain points) side by side with the proposed future workflow`,
    `4. Business Process Flows — for at least 2 core processes, describe the flow as numbered steps with actor, action, decision points, and exception paths (detailed enough to convert directly into a flowchart)`,
    `5. Stakeholder Analysis (RACI matrix) — for each major business requirement area, identify who is Responsible, Accountable, Consulted, and Informed, using actual team member names as owners where the roster provides them`,
    `6. Business Requirements — numbered BR-001, BR-002, etc., grouped by process area, each stated as a testable outcome ("The system shall..." / "The business process shall...")`,
    `7. Business Rules — high-level rules that constrain the business requirements (detailed rule logic belongs in the dedicated Business Rules document, so keep these summary-level with a pointer to the rule category)`,
    `8. Compliance & Regulatory Requirements — name the specific regulations/standards applicable to the ${ctx.domain} domain and map each to the BR-xxx items it constrains`,
    `9. Reporting & Analytics Requirements — what business metrics/reports stakeholders need, at what frequency, and for which audience`,
    `10. Change Management Considerations — impacted roles, required training, communication plan, and anticipated points of resistance with mitigation approach`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a Business Requirements Document (BRD) for "${ctx.projectName}" that translates the PRD's ` +
    `product vision into numbered, testable business requirements (BR-xxx) with current-state vs future-state ` +
    `workflow descriptions, a RACI matrix using real team member names, and domain-specific compliance rules ` +
    `citing actual ${ctx.domain} regulations. Read the PRD output before writing.`,
  tools: ALL_TOOLS,
  maxIterations: 4,
};

// ─── Phase 2 ──────────────────────────────────────────────────────────────────
const stakeholder: AgentDefinition = {
  id: 'stakeholder',
  name: 'Stakeholder Analysis',
  phase: 'phase2',
  description: 'Comprehensive stakeholder register and engagement plan',
  outputLabel: 'Stakeholder Analysis',
  dependsOn: ['projectCharter', 'brd'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Stakeholder Analysis Agent. Your task is to produce a Stakeholder Analysis that a project manager can actually run a communication plan from — not a generic template with placeholder names.

## Stakeholder Analysis Standards
- Every stakeholder entry must have a distinct interest and influence rationale tied to this specific project — avoid copy-pasted descriptions across rows.
- Influence and Impact ratings (High/Medium/Low) must be justified in one phrase each (e.g. "High influence — controls budget approval for Phase 2").
- The Power/Interest grid must place every stakeholder from the register into one of the four quadrants by name, not just describe the quadrants abstractly.
- The Communication Plan must specify a concrete cadence (e.g. "bi-weekly", "at each phase gate") and channel (status email, steering committee meeting, dashboard) — "as needed" is not acceptable.
- Traceability must reference actual requirement IDs (BR-xxx, FR-xxx) from the BRD/PRD where the excerpt content allows it, or describe the requirement area clearly enough to be mapped later.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Description: ${ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Stakeholder Analysis document with:`,
    `1. Stakeholder Register — table: Name/Role, Interest (specific to this project), Influence (High/Med/Low + one-line justification), Impact (High/Med/Low + justification), Engagement Strategy. Include all actual team members listed above, plus any implied external stakeholders (e.g. regulators, end customers) relevant to the ${ctx.domain} domain`,
    `2. Power/Interest Grid — place each stakeholder from the register into one of the 4 quadrants (Manage Closely, Keep Satisfied, Keep Informed, Monitor) by name, with a one-line rationale per quadrant placement`,
    `3. Communication Plan — table: Stakeholder/Group, Frequency (specific cadence), Channel, Message Type/Content, Owner (assign team member names to communication owners)`,
    `4. Resistance & Change Management — for each group likely to resist the change, identify the source of resistance and a specific mitigation tactic (not generic "communicate early and often")`,
    `5. Stakeholder-to-Requirement Traceability — table mapping each major stakeholder/group to the requirement areas (BR-xxx/FR-xxx or named capability areas) they care most about, and why`,
    `6. Escalation Path — who escalates to whom when a stakeholder concern can't be resolved at the working level, using actual team member names/roles`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Identify and profile all stakeholders for ${ctx.projectName} — their interests, influence levels, ` +
    `communication needs, and potential conflicts. Read user story and BRD outputs to ground personas ` +
    `in real requirements. Produce a stakeholder register with engagement strategy and RACI overview.`,
  tools: CONTEXT_TOOLS,

};

const userStory: AgentDefinition = {
  id: 'userStory',
  name: 'User Stories',
  phase: 'phase2',
  description: 'Epic and user story backlog with acceptance criteria',
  outputLabel: 'User Stories & Backlog',
  dependsOn: ['manager'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the User Story Agent. Produce detailed epics and user stories in standard agile format. Downstream agents (sprint planner, task breakdown, test cases) will reference these stories directly by ID, so consistency and granularity matter as much as content quality.

## User Story Standards
- Every story must be sized for a single sprint (if a story feels larger, split it — don't write "epic-sized" stories disguised as user stories).
- "As a [persona]" must use a persona/role that's plausible for the project's domain, not a generic "user" — vary personas across epics to reflect different user types.
- Acceptance criteria must be written in Given/When/Then format and must be specific enough to become test cases verbatim — avoid vague criteria like "the page works correctly".
- Story Points should follow a consistent scale (Fibonacci: 1,2,3,5,8,13) and the relative sizing across stories should make sense (a story with 5 acceptance criteria and 2 system integrations should not be the same size as a single-field form change).
- Each epic must map conceptually to one or more functional requirement areas from the PRD so traceability is preserved.
- Non-functional stories must be written in the same "As a... I want... so that..." format as functional stories, with measurable acceptance criteria (e.g. "p95 response time under 500ms for 95% of requests under 200 concurrent users").`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `PRD Excerpt:\n${ctx.priorOutputs.manager?.slice(0, 1500) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a User Story Backlog with:`,
    `1. At least 5 Epics — each with a short description, the functional requirement area(s) it maps to, and a rough priority (High/Med/Low)`,
    `2. For each Epic, 3-5 User Stories in format: "As a [persona relevant to the ${ctx.domain} domain], I want [capability] so that [benefit]" — give each story a unique ID (e.g. US-101)`,
    `3. Each story must have: Story Points estimate (Fibonacci scale, with relative sizing that reflects actual complexity), Priority (P0/P1/P2), Acceptance Criteria (3+ criteria in Given/When/Then format, specific enough to convert directly into test cases), and Owner (assign from the actual team member names above)`,
    `4. Definition of Done — a checklist that applies across all stories (code reviewed, tests passing, accessibility checked, docs updated, etc.)`,
    `5. Non-functional stories (performance, security, accessibility) — written in the same format with measurable acceptance criteria (specific latency/throughput/conformance targets)`,
    `6. Dependencies Between Stories — call out any story-to-story sequencing dependencies (e.g. "US-105 depends on US-101 — auth must exist before profile editing")`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a complete, sprint-ready User Story Backlog for "${ctx.projectName}" with at least 5 epics ` +
    `and 3-5 user stories per epic. Stories must use personas grounded in the ${ctx.domain} domain and ` +
    `Given/When/Then acceptance criteria specific enough to become test cases verbatim. Read the PRD ` +
    `output first to extract functional requirement areas (FR-xxx IDs) so every epic traces to a requirement. ` +
    `Each story gets a story-point estimate on the Fibonacci scale and a named owner from the team roster.`,
  tools: ALL_TOOLS,
  maxIterations: 4,
};

const businessRules: AgentDefinition = {
  id: 'businessRules',
  name: 'Business Rules',
  phase: 'phase2',
  description: 'Business rules engine and validation logic',
  outputLabel: 'Business Rules Document',
  dependsOn: ['brd'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Business Rules Agent. Your task is to produce a Business Rules Document precise enough that a developer could implement a rules engine or validation layer directly from it, and an architect could design the data model around the entities and states it implies.

## Business Rules Standards
- Each rule must be atomic — one condition/action per rule. If a "rule" has multiple independent conditions, split it into separate numbered rules.
- Rules must be stated in a consistent, implementable form: "IF [condition] THEN [action]" or "[Entity].[field] MUST [constraint]" — avoid narrative prose for the rule statement itself (prose belongs in the description column).
- Decision tables must show all relevant condition combinations (not just the "happy path") including edge cases and what happens when conditions conflict.
- Workflow rules must define the full state machine for at least one core entity: list all states, valid transitions, and which role(s) can trigger each transition.
- Compliance rules must cite the specific regulation/standard relevant to the project's domain (not generic "ensure data privacy") and state the rule in a way that's auditable (a SOX/compliance reviewer could check "is this rule enforced?").
- The Rule Conflict Analysis must identify at least 2 plausible conflicts between rules (e.g. a validation rule vs. a workflow rule that could fire in the same scenario) and how the conflict is resolved (precedence order).`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `BRD Excerpt:\n${ctx.priorOutputs.brd?.slice(0, 1500) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Business Rules Document with:`,
    `1. Rule Categories — validation, calculation, workflow, and compliance, with a short description of what each category governs in this system`,
    `2. Business Rules Register — table: Rule ID (BRU-001, BRU-002, ...), Name, Description, Trigger/Condition, Action/Constraint, Priority (High/Med/Low), Source (which BR-xxx or regulation it derives from), Owner (assign from actual team member names above)`,
    `3. Decision Tables — for at least 2 areas of complex conditional logic, a full table of condition combinations (including edge cases) mapped to outcomes`,
    `4. Workflow Rules — for at least 1 core entity, the complete state machine: states, valid transitions, triggering role(s), and any approval gates`,
    `5. Domain-Specific Compliance Rules — name the specific regulation/standard for the ${ctx.domain} domain and state each compliance rule in an auditable form`,
    `6. Rule Conflict Analysis — identify at least 2 plausible rule conflicts and the precedence/resolution approach for each`,
    `7. Implementation Notes per rule category — guidance for where/how each category should be enforced (e.g. database constraints vs. application layer vs. workflow engine)`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Extract and formalise all business rules for ${ctx.projectName} — validation rules, ` +
    `state machines, decision tables, and workflow constraints. Read the BRD and user story outputs ` +
    `to ensure every stated rule is traceable to a requirement. Include a decision table for ` +
    `the most complex rule set.`,
  tools: RESEARCH_TOOLS,

};

const feasibility: AgentDefinition = {
  id: 'feasibility',
  name: 'Feasibility Study',
  phase: 'phase2',
  description: 'Technical, operational and financial feasibility analysis',
  outputLabel: 'Feasibility Study',
  dependsOn: ['manager', 'brd'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Feasibility Study Agent. Your task is to produce a Feasibility Study that gives leadership a defensible basis for a go/no-go decision — every conclusion must be backed by a stated assumption or comparison, not asserted.

## Feasibility Study Standards
- Technical feasibility must name specific technologies/platforms plausible for the project's domain and scale, and identify concrete integration risks (e.g. "legacy system X has no documented API — requires reverse-engineering or vendor engagement").
- Team skills gap analysis must reference the actual team roster where available — identify which roles/skills are covered and which are missing or thin.
- Financial feasibility must show the calculation basis for any ROI/TCO/NPV figures (even rough estimates need stated assumptions: hourly rates, infrastructure cost ranges, time horizon).
- The risk assessment must rank risks by a likelihood x impact score (e.g. both rated 1-5, multiplied) so the top risks are objectively ordered, not just listed.
- At least 2 genuinely different alternative solutions must be considered (e.g. build vs. buy vs. hybrid, or different architectural approaches) with honest trade-offs — not strawman alternatives designed to make the chosen approach look obviously best.
- The Go/No-Go framework must define explicit decision criteria (thresholds) rather than just "leadership will decide".
- The Market & Competitive Landscape section must name realistic comparable products/vendors for the project's domain (even if illustrative) and identify what would differentiate this project from them — not a generic "the market is competitive" statement.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Description: ${ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Feasibility Study with:`,
    `1. Executive Summary — overall feasibility verdict and the single biggest risk/dependency`,
    `2. Technical Feasibility — technology stack assessment (name specific candidate technologies), integration complexity with existing/external systems, and team skills gap analysis against the roster above`,
    `3. Operational Feasibility — process changes required, training needs by role, and the ongoing support model post-launch`,
    `4. Financial Feasibility — cost-benefit analysis with stated assumptions, ROI estimate, TCO over a defined horizon (e.g. 3 years), and NPV if a discount rate assumption is reasonable to state`,
    `5. Schedule Feasibility — timeline risk factors and the critical path (which work streams, if delayed, delay the whole project)`,
    `6. Risk Assessment — top 10 risks scored as Likelihood (1-5) x Impact (1-5) = Risk Score, sorted descending, each with a mitigation`,
    `7. Market & Competitive Landscape — 3-5 realistic comparable products/vendors for the ${ctx.domain} domain, their relative strengths/weaknesses, and the specific gap or differentiator this project should target`,
    `8. Alternative Solutions Considered — at least 2 genuinely different alternatives (e.g. build vs. buy, different architecture/vendor choices) with honest pros/cons vs. the recommended approach`,
    `9. Recommendation & Go/No-Go Decision Framework — explicit decision criteria/thresholds, with sign-off attributed to named team members above`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a defensible Feasibility Study for ${ctx.projectName} — go/no-go decision backed ` +
    `by scored risks, ROI calculation with stated assumptions, team skills gap analysis against the ` +
    `actual roster, and at least 2 genuine alternative solutions. Read the BRD and project charter ` +
    `outputs to ground financial and schedule estimates in real scope.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};

const dataModel: AgentDefinition = {
  id: 'dataModel',
  name: 'Data Model',
  phase: 'phase2',
  description: 'Entity relationship model and data dictionary',
  outputLabel: 'Data Model & Dictionary',
  dependsOn: ['businessRules'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Data Modeling Agent. Your task is to produce a Data Model & Dictionary precise enough that a database engineer could generate DDL (CREATE TABLE statements) directly from it without further clarification.

## Data Modeling Standards
- Every entity must have a clear primary key strategy stated (e.g. UUID, auto-increment integer, composite key) and a rationale if non-obvious.
- Attributes must specify concrete data types (e.g. VARCHAR(255), DECIMAL(10,2), TIMESTAMP WITH TIME ZONE, BOOLEAN) — not generic "text" or "number".
- Relationships must state cardinality (1:1, 1:N, M:N), the foreign key direction, and ON DELETE behavior (CASCADE, RESTRICT, SET NULL) where it matters.
- Normalize to at least 3NF by default; if you intentionally denormalize anything for performance, call it out explicitly with a reason.
- PII/sensitive data classification must be field-level, not table-level — list the specific fields (e.g. "users.ssn", "patients.diagnosis_code") and their classification (PII, PHI, financial, public).
- The data dictionary must cover every entity introduced in the logical model — no entity should appear in the ER diagram without a corresponding dictionary section.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Description: ${ctx.projectDescription}`,
    `Business Rules Excerpt:\n${ctx.priorOutputs.businessRules?.slice(0, 1000) ?? ''}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Data Model document with:`,
    `1. Conceptual Data Model — describe the major entities and how they relate at a business level (no implementation detail yet)`,
    `2. Logical Data Model — Entity-Relationship description with:`,
    `   - All entities (table name, description, primary key strategy)`,
    `   - Attributes (field name, concrete data type, constraints — NOT NULL/UNIQUE/CHECK, description)`,
    `   - Relationships (cardinality: 1:1, 1:N, M:N; foreign key direction; ON DELETE behavior where relevant)`,
    `3. Data Dictionary — table: Entity, Field, Type, Nullable, Default, Description, Validation Rule, Owner (use actual team member names as data owners) — must cover every entity from the logical model`,
    `4. Data Flow Description — how data moves between entities/systems for the 2-3 most important business processes`,
    `5. Data Retention & Archival Policy — per-entity retention periods and archival/deletion approach, grounded in ${ctx.domain} domain norms`,
    `6. PII / Sensitive Data Classification — field-level table of sensitive fields and their classification (PII, PHI, financial, confidential, public)`,
    `7. Indexing Strategy — which fields/combinations need indexes and why (foreign keys, frequent filter/sort columns, uniqueness constraints)`,
    `8. Normalization Notes — confirm 3NF compliance or explicitly justify any denormalization decisions`,
    diagramLine('Draw an erDiagram showing all entities and their relationships with cardinality. IMPORTANT: erDiagram attribute types must be single-word identifiers only — use VARCHAR, INTEGER, BOOLEAN, DECIMAL, TIMESTAMP, TEXT, UUID, JSON (no spaces, no parentheses, no SQL precision like VARCHAR(255) or TIMESTAMP WITH TIME ZONE). Save the full SQL types for the data dictionary table above.'),
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a Data Model & Dictionary for "${ctx.projectName}" precise enough that a database engineer ` +
    `could write DDL directly from it. Read the business rules output to identify entities and state ` +
    `machines; all entities in the ER diagram must have a corresponding data dictionary section with ` +
    `concrete data types (VARCHAR(255), DECIMAL(10,2), TIMESTAMP WITH TIME ZONE, etc. — in the dictionary table; single-word types only in the erDiagram), constraints, ` +
    `PK strategy, and PII/sensitivity classification at the field level. Include an erDiagram.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,
};

// ─── Phase 3 ──────────────────────────────────────────────────────────────────
const architecture: AgentDefinition = {
  id: 'architecture',
  name: 'Architecture',
  phase: 'phase3',
  description: 'System architecture, tech stack and infrastructure design',
  outputLabel: 'Architecture Design Document',
  dependsOn: ['dataModel', 'feasibility'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Software Architect Agent. Your task is to produce an Architecture Design Document (ADD) that downstream agents (API design, code structure, DevOps, infrastructure) will use as their blueprint — every technology choice and component boundary stated here becomes a constraint on those documents.

## Architecture Design Standards
- Every technology stack decision must include at least one rejected alternative and the reason it was rejected — "we chose X" is incomplete without "instead of Y, because Z".
- Component boundaries must be defined by responsibility (single-purpose, bounded context) — avoid components with vague catch-all responsibilities like "core service" or "utils service".
- The integration architecture must specify the communication pattern for each integration (synchronous REST, async messaging/event bus, webhook, batch) and justify the choice per integration.
- Security architecture must specify the actual AuthN/AuthZ mechanism (e.g. OAuth2/OIDC with a named identity provider, JWT with refresh tokens, RBAC vs ABAC) — not just "secure authentication".
- Scalability design must reference concrete load expectations (from the PRD's NFRs if available) and explain how the architecture meets them (horizontal scaling points, caching layers, database read replicas, etc.).
- ADRs must follow the standard format: Context, Decision, Consequences (including negative trade-offs) — a decision with no downsides listed is suspicious.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Description: ${ctx.projectDescription}`,
    `Data Model Summary:\n${ctx.priorOutputs.dataModel?.slice(0, 1000) ?? ''}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce an Architecture Design Document (ADD) with:`,
    `1. Architecture Overview & Guiding Principles — the 3-5 principles that drive every decision below (e.g. "prefer managed services over self-hosted", "design for horizontal scale from day one")`,
    `2. System Context Diagram — described in text/ASCII, showing the system boundary, external actors, and external systems it integrates with`,
    `3. Component Diagram — services/modules, their single responsibility, and the interfaces (APIs/events) they expose or consume`,
    `4. Technology Stack Decision — for frontend, backend, database, cache, messaging, and infra: the chosen technology, at least one alternative considered and rejected (with reason), and why the choice fits the ${ctx.domain} domain and project scale`,
    `5. Integration Architecture — for each external integration, the communication pattern (sync REST / async messaging / webhook / batch) and justification`,
    `6. Data Architecture — storage layers (OLTP, analytics, file/object storage), caching strategy (what's cached, invalidation approach), and CDN usage if applicable`,
    `7. Security Architecture — concrete AuthN/AuthZ mechanism and provider, secrets management approach, network segmentation/zero-trust posture`,
    `8. Scalability & Performance Design — reference load expectations from the PRD's NFRs where available, and explain the specific mechanisms (horizontal scaling, read replicas, queue-based load leveling, etc.) that meet them`,
    `9. Disaster Recovery & High Availability Strategy — RTO/RPO targets and the architecture elements that achieve them (multi-AZ, backups, failover)`,
    `10. Architecture Decision Records (ADRs) — at least 3 key decisions, each in Context/Decision/Consequences format (including negative trade-offs), attributed to the responsible architect or tech lead by name from the team above`,
    diagramLine('Draw a high-level C4 Context or component diagram showing services and their interactions.'),
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce an Architecture Design Document (ADD) for "${ctx.projectName}" that gives downstream ` +
    `agents (API design, code structure, DevOps, infra) concrete technology choices and component ` +
    `boundaries to build on. Read the data model and feasibility study outputs first to ground ` +
    `technology decisions in the actual entities and scale requirements. Every technology choice must ` +
    `name at least one rejected alternative. Include 3+ ADRs with genuine trade-off statements.`,
  tools: ALL_TOOLS,
  maxIterations: 4,
};

const apiDesign: AgentDefinition = {
  id: 'apiDesign',
  name: 'API Design',
  phase: 'phase3',
  description: 'RESTful API specification and contract design',
  outputLabel: 'API Design Specification',
  dependsOn: ['architecture'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the API Design Agent. Produce a comprehensive REST API specification detailed enough that frontend and backend engineers could work in parallel against it without a single clarifying question, and an OpenAPI/Swagger document could be derived from it directly.

## API Design Standards
- Endpoint paths must follow consistent REST naming conventions (plural nouns, nested resources reflecting ownership, no verbs in paths) and match the entities defined in the data model where applicable.
- Every endpoint's request/response bodies must use concrete field names and types consistent with the Data Dictionary (if a data model excerpt is available) — do not invent field names that conflict with the data model.
- Error responses must follow one consistent error envelope shape across all endpoints (e.g. a JSON object with a top-level "error" key containing "code", "message", and "details" fields) — define this shape once and reference it.
- Authentication/authorization must specify which endpoints require which roles/scopes — don't leave authorization as an afterthought.
- At least 8-10 core endpoints must be specified in full detail (not just listed) — prioritize the endpoints that map to the highest-priority user stories/functional requirements.
- Pagination must specify the actual mechanism (cursor-based vs offset-based) and the response envelope shape for paginated lists.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 1200) ?? ctx.projectDescription}`,
    `Data Model Summary (for entity/field consistency):\n${ctx.priorOutputs.dataModel?.slice(0, 1000) ?? ''}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce an API Design Specification with:`,
    `1. API Design Principles — REST conventions, versioning strategy (e.g. URI versioning /v1/), naming conventions, and how this API supports the architecture's integration patterns`,
    `2. Authentication & Authorization — concrete mechanism (JWT/OAuth2/API keys) consistent with the architecture's security design, plus a role/scope-to-endpoint mapping for at least the core resources`,
    `3. Base URL & Versioning Strategy`,
    `4. Core Endpoints (8-10 minimum, covering the highest-priority capability areas) — for each endpoint:`,
    `   - Method + Path (consistent with data model entity names)`,
    `   - Description and which user story/functional requirement it supports`,
    `   - Request headers, path params, query params, body (with concrete types matching the data dictionary)`,
    `   - Response schema for 200, 400, 401, 403, 404, 500 (using one consistent error envelope)`,
    `   - Example request/response JSON`,
    `   - Owner (assign from team member names above)`,
    `5. Pagination, Filtering, Sorting — specify the mechanism (cursor vs offset) and the response envelope shape`,
    `6. Error Response Format — define the single consistent error envelope used across all endpoints`,
    `7. Rate Limiting - headers returned and default limits per endpoint category`,
    `8. Webhook Events (if applicable to the ${ctx.domain} domain) — event names, payload shapes, retry/delivery guarantees`,
    `9. API Changelog section template — format for documenting future breaking/non-breaking changes`,
    diagramLine('Draw a sequenceDiagram showing the auth flow and at least one core API request-response cycle.'),
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a REST API Design Specification for "${ctx.projectName}" detailed enough for frontend and ` +
    `backend teams to work in parallel without clarifying questions. Read the architecture document for ` +
    `technology/auth decisions, and the data model for entity/field names — endpoint request/response ` +
    `bodies must use field names consistent with the data dictionary. Cover 8-10 core endpoints with full ` +
    `request/response schemas, a single error envelope, and a sequence diagram for the auth flow.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,
};

const uxResearch: AgentDefinition = {
  id: 'uxResearch',
  name: 'UX Research',
  phase: 'phase3',
  description: 'UX research findings, journey maps, and design principles',
  outputLabel: 'UX Research Report',
  dependsOn: ['userStory', 'stakeholder'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the UX Research Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `User Stories Excerpt:\n${ctx.priorOutputs.userStory?.slice(0, 1200) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a UX Research Report with:`,
    `1. Research Objectives & Methodology (assign research lead from team member names above)`,
    `2. User Persona Deep Dives (3 personas: goals, pain points, tech comfort, context of use)`,
    `3. User Journey Maps (2 key journeys: current state vs future state)`,
    `4. Usability Heuristics Analysis`,
    `5. Accessibility Requirements (WCAG 2.1 AA checklist items relevant to this domain)`,
    `6. Competitive UX Analysis (3 comparable products, what they do well/poorly)`,
    `7. Design Principles for this product`,
    `8. Information Architecture (site map / navigation structure)`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a UX Research Report for ${ctx.projectName} with 3 persona deep-dives, ` +
    `2 user journey maps (current vs future state), a competitive UX analysis of 3 comparable ` +
    `products, and domain-specific WCAG 2.1 AA accessibility requirements. Read user story and ` +
    `stakeholder outputs to ground personas in real requirements.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};

const interaction: AgentDefinition = {
  id: 'interaction',
  name: 'Interaction Design',
  phase: 'phase3',
  description: 'Wireframe descriptions, component library and interaction patterns',
  outputLabel: 'Interaction Design Spec',
  dependsOn: ['uxResearch'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Interaction Design Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `UX Research Excerpt:\n${ctx.priorOutputs.uxResearch?.slice(0, 1200) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce an Interaction Design Specification with:`,
    `1. Design System Overview (color palette, typography, spacing, iconography)`,
    `2. Component Library (buttons, forms, cards, modals, tables, navigation — describe each)`,
    `3. Key Screen Wireframes (text descriptions of layout for 5+ screens)`,
    `4. Interaction Patterns (hover states, loading states, error states, empty states)`,
    `5. Responsive Design Breakpoints`,
    `6. Micro-interactions & Animations guidelines`,
    `7. Form Design Patterns (validation, error messages, inline help)`,
    `8. Accessibility Implementation Notes`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce an Interaction Design Specification for ${ctx.projectName} — design system tokens, ` +
    `component library (buttons, forms, cards, modals, tables, nav), wireframe descriptions for 5+ ` +
    `key screens, interaction/animation patterns, and accessibility implementation notes. Read ` +
    `uxResearch output to ensure designs address identified pain points and personas.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};

const uxMockups: AgentDefinition = {
  id: 'uxMockups',
  name: 'UX Mockups',
  phase: 'phase3',
  description: 'Two interactive HTML mockup versions with live style guide — rendered directly in the Preview tab',
  outputLabel: 'UX Mockups & Style Guide',
  dependsOn: ['uxResearch', 'interaction', 'architecture'],
  systemPrompt: `${BASE_SYSTEM}

You are the UX Mockups Agent. You produce two complete, standalone, COMMERCIAL-GRADE HTML mockup documents for the project — one per design concept. Each mockup must look like a finished, shippable product — not a wireframe or prototype sketch. Think Figma-quality, investor-demo-ready screens with real mock data, professional typography, status states, and working navigation simulation.

COMMERCIAL-GRADE QUALITY STANDARD (non-negotiable):
Every mockup must include ALL of the following:
1. STICKY NAVIGATION BAR — logo + full nav links with active state + user avatar/profile chip + notification badge. Height 56-64px, subtle shadow, z-index 100.
2. AT LEAST 4 DISTINCT BUSINESS FEATURES on the screen — e.g. a dashboard might have: KPI stat cards, a data table with real rows, a chart/progress visual, and an activity feed. A marketplace might have: search+filter, product grid, deal strip, and seller spotlight. NEVER show only one feature per screen.
3. REAL MOCK DATA — use domain-appropriate real-sounding names, real numbers, real dates (e.g. "Priya Sharma", "₹89,500", "Jun 20, 2024", "Order #AX-2024-78421"). NEVER use "Lorem ipsum", "Product 1", "User A", "John Doe", or generic placeholders.
4. STATUS BADGES — every data entity must show a status: delivered/pending/active/cancelled/processing — coloured pills (green/amber/red/grey).
5. HERO SECTION — a gradient banner or highlight panel at top with key metric, tagline, or primary CTA.
6. INTERACTIVE COMPONENT STATES — show hover-ready cards, active nav links, filled forms, progress bars, count badges.
7. DATA DENSITY — cards with real counts, tables with 4-6 real rows, lists with 3-5 real items. Never leave large empty areas.
8. CSS DESIGN TOKENS — declare at :root: --color-primary, --color-secondary, --color-surface, --color-text, --color-accent, --color-success, --color-danger, --font-family, --radius, --shadow-sm, --shadow-md, --shadow-lg, --spacing-unit.
9. PROFESSIONAL SHADOWS & DEPTH — cards: 0 1px 3px rgba(0,0,0,0.08); hover: 0 8px 32px rgba(0,0,0,0.12); navbar: 0 1px 4px rgba(0,0,0,0.08).
10. TYPOGRAPHY HIERARCHY — 3+ distinct type sizes (hero H1 32-40px 800w, section H2 18-20px 700w, body 14px 400w, caption 11-12px 500-600w). Load Google Font via @import if appropriate for the domain.

CRITICAL OUTPUT RULES:
- You MUST output EXACTLY 2 fenced code blocks using \`\`\`html ... \`\`\` syntax.
- Each block must be a COMPLETE standalone HTML document starting with <!DOCTYPE html>.
- RESPONSIVE DESIGN IS MANDATORY. Every HTML document must:
  1. Include <meta name="viewport" content="width=device-width, initial-scale=1.0"> as the FIRST tag in <head>.
  2. Use mobile-first CSS — base styles for 375px, min-width media queries for larger screens.
  3. Never use fixed pixel widths on layout containers.
  4. Navigation must collapse or adapt on mobile.
  5. Sidebars must be hidden or collapsed below 768px.
  6. Required breakpoints: @media (min-width: 480px), @media (min-width: 768px), @media (min-width: 1024px).
- Do NOT use placeholder images (via.placeholder.com or similar). Use CSS gradients, emoji icons (🛍📱💳📊), or inline SVG instead.
- Do NOT use external CDN links except @import for Google Fonts in <style> which is allowed.
- The two versions must be visually and structurally distinct (different layout, nav pattern, color mood, or density).
- Each version must cover the SAME 4+ business features so the user can compare approaches, not coverage.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Domain: ${ctx.domain}`,
    `UX Research Excerpt:\n${ctx.priorOutputs.uxResearch?.slice(0, 1000) ?? ctx.projectDescription}`,
    `Interaction Design Excerpt:\n${ctx.priorOutputs.interaction?.slice(0, 1000) ?? ''}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 500) ?? ''}`,
    domainLine(ctx),
    teamLine(ctx),
    brandingLine(ctx),
    ``,
    `Produce a COMMERCIAL-GRADE UX Mockups & Style Guide with the following structure:`,
    ``,
    `## Design System`,
    `Document the shared design tokens for ${ctx.projectName}:`,
    `- Color palette with hex codes (primary, secondary, accent, success, danger, surface, background, text, text-secondary, border)`,
    `- Typography: font family, scale (hero/h1/h2/body/caption/micro), weights`,
    `- Spacing: base unit, card padding, section gap, page margin`,
    `- Border radius convention, shadow scale (sm/md/lg)`,
    `- 6-8 core components overview: nav bar, stat card, data card, status badge, button styles, form input, table row, notification chip`,
    ``,
    `## Version A — [Give it a domain-appropriate concept name]`,
    `Design direction rationale (2-3 sentences): what visual language, layout pattern, and UX philosophy this version follows and why it fits ${ctx.domain} users.`,
    ``,
    `Business features covered (list all 4+):`,
    `- Feature 1: [name] — [what it does, what mock data it shows]`,
    `- Feature 2: [name] — [what it does, what mock data it shows]`,
    `- Feature 3: [name] — [what it does, what mock data it shows]`,
    `- Feature 4: [name] — [what it does, what mock data it shows]`,
    ``,
    `Then output the COMPLETE standalone HTML mockup:`,
    ``,
    `\`\`\`html`,
    `<!DOCTYPE html>`,
    `<!-- Version A: [Concept Name] — ${ctx.projectName} -->`,
    `<!-- COMMERCIAL-GRADE: sticky nav, 4+ features, real mock data, status badges, hero section -->`,
    `<!-- CSS tokens: --color-primary, --color-secondary, --color-accent, --color-success, --color-danger, --color-surface, --color-text, --font-family, --radius, --shadow-sm, --shadow-md, --shadow-lg -->`,
    `...full HTML document with real content, real data, professional polish...`,
    `\`\`\``,
    ``,
    `## Version B — [Give it a meaningfully different concept name]`,
    `Design direction rationale (2-3 sentences): what makes this direction VISUALLY AND STRUCTURALLY different from Version A. Must differ in at least 2 of: nav pattern, layout density, color mood, card style, information hierarchy, or primary interaction model.`,
    ``,
    `Business features covered (same 4+ features as Version A, different presentation):`,
    `- Feature 1: [how Version B presents this differently]`,
    `- Feature 2: [how Version B presents this differently]`,
    `- Feature 3: [how Version B presents this differently]`,
    `- Feature 4: [how Version B presents this differently]`,
    ``,
    `Then output the COMPLETE standalone HTML mockup:`,
    ``,
    `\`\`\`html`,
    `<!DOCTYPE html>`,
    `<!-- Version B: [Concept Name] — ${ctx.projectName} -->`,
    `<!-- COMMERCIAL-GRADE: sticky nav, 4+ features, real mock data, status badges, hero section -->`,
    `<!-- CSS tokens: --color-primary, --color-secondary, --color-accent, --color-success, --color-danger, --color-surface, --color-text, --font-family, --radius, --shadow-sm, --shadow-md, --shadow-lg -->`,
    `...full HTML document with real content, real data, professional polish...`,
    `\`\`\``,
    ``,
    `## Comparison & Recommendation`,
    `Table comparing Version A vs Version B across: visual style, target user, information density, nav pattern, mobile suitability, implementation complexity. End with a clear recommendation for which to prototype first and why.`,
    ``,
    `## Appendix — AI Image Generation Prompts`,
    `**Version A Hero Image Prompt:** [2-4 sentences: image subject, visual style, color palette, mood, composition — suitable for Midjourney/DALL-E]`,
    ``,
    `**Version B Hero Image Prompt:** [2-4 sentences: image subject, visual style, color palette, mood, composition — suitable for Midjourney/DALL-E]`,
    ``,
    `FINAL REMINDER: Output EXACTLY 2 \`\`\`html fenced code blocks. Each must be a complete <!DOCTYPE html> with: sticky nav, hero, 4+ real business features, real mock data (real names/numbers/dates), status badges, professional shadows/typography, CSS custom properties, Google Font @import allowed, no external JS/CSS CDN, no placeholder images, mobile-responsive.`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce exactly 2 COMMERCIAL-GRADE standalone HTML mockup documents for ${ctx.projectName} — ` +
    `Version A and Version B — each a full <!DOCTYPE html> with: sticky nav bar, hero section, ` +
    `AT LEAST 4 distinct business features per screen with REAL mock data (real names/numbers/dates, ` +
    `NO lorem ipsum or "Product 1" placeholders), status badges, professional shadows and typography, ` +
    `mobile-first responsive CSS using CSS custom properties (--color-primary, --color-secondary, ` +
    `--color-accent, --color-success, --color-danger, --color-surface, --color-text, --font-family, ` +
    `--radius, --shadow-sm, --shadow-md, --shadow-lg), Google Font @import allowed, no external JS/CSS CDN. ` +
    `The two versions must be visually AND structurally distinct. ` +
    `Read uxResearch and interaction outputs for domain context and feature list. ` +
    `Output MUST contain exactly 2 \`\`\`html fenced code blocks.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};

// ─── Phase 3B ─────────────────────────────────────────────────────────────────
const securityCompliance: AgentDefinition = {
  id: 'securityCompliance',
  name: 'Security & Compliance',
  phase: 'phase3b',
  description: 'Security assessment, threat model and compliance checklist',
  outputLabel: 'Security & Compliance Report',
  dependsOn: ['architecture', 'dataModel'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Security & Compliance Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 1000) ?? ''}`,
    `Data Model Summary:\n${ctx.priorOutputs.dataModel?.slice(0, 800) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Security & Compliance Report with:`,
    `1. Threat Model (STRIDE methodology)`,
    `2. Attack Surface Analysis`,
    `3. OWASP Top 10 Assessment (rate each item: High/Medium/Low risk, mitigations)`,
    `4. Authentication & Authorization Design`,
    `5. Data Protection Controls (encryption, masking, tokenization)`,
    `6. Network Security Controls`,
    `7. Compliance Checklist (domain-specific regulations)`,
    `8. Security Testing Requirements`,
    `9. Incident Response Plan outline — assign named roles from team members above`,
    `10. Security Runbook`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a Security & Compliance Report for ${ctx.projectName} using STRIDE threat modelling, ` +
    `OWASP Top 10 assessment with per-item risk ratings, domain-specific compliance checklist, and ` +
    `an incident response plan with named role assignments from the team roster. Read architecture ` +
    `and data model outputs to ground the attack surface analysis in the actual tech choices.`,
  tools: ALL_TOOLS,
  maxIterations: 4,

};

// ─── Phase 4 ──────────────────────────────────────────────────────────────────
const sprintPlanner: AgentDefinition = {
  id: 'sprintPlanner',
  name: 'Sprint Planner',
  phase: 'phase4',
  description: 'Sprint plan with capacity and velocity estimation',
  outputLabel: 'Sprint Plan',
  dependsOn: ['userStory', 'architecture'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Sprint Planning Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `User Stories Excerpt:\n${ctx.priorOutputs.userStory?.slice(0, 1500) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Sprint Plan with:`,
    `1. Release Strategy (MVP vs. subsequent releases)`,
    `2. Sprint 0 — Setup & Infrastructure tasks (assign owners from actual team member names above)`,
    `3. Sprints 1-6 (2-week sprints): Sprint Goal, Stories included, Estimated story points, Team capacity assumptions`,
    `4. Velocity Assumptions & Burn-down approach`,
    `5. Definition of Ready / Definition of Done`,
    `6. Dependencies between sprints`,
    `7. Release milestones`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a Sprint Plan for ${ctx.projectName} covering Sprints 0-6 (2-week sprints) ` +
    `with sprint goals, story point estimates, capacity assumptions, and named task owners from ` +
    `the team roster. Read user story and architecture outputs to accurately sequence work and ` +
    `identify inter-sprint dependencies.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};

const taskBreakdown: AgentDefinition = {
  id: 'taskBreakdown',
  name: 'Task Breakdown',
  phase: 'phase4',
  description: 'Granular engineering task breakdown for Phase 1 implementation',
  outputLabel: 'Engineering Task Breakdown',
  dependsOn: ['architecture', 'apiDesign'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Task Breakdown Agent. Break high-level stories into concrete engineering tasks.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 1000) ?? ''}`,
    `API Design Summary:\n${ctx.priorOutputs.apiDesign?.slice(0, 1000) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce an Engineering Task Breakdown with:`,
    `1. Backend Tasks (group by service/module)`,
    `2. Frontend Tasks (group by feature/page)`,
    `3. Infrastructure / DevOps Tasks`,
    `4. Testing Tasks`,
    `5. For each task: Task ID, Title, Description, Estimated Hours, Assignee (use actual team member names), Dependencies, Acceptance Criteria`,
    `6. Critical Path Analysis`,
    `7. Technical Spikes required`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Break the engineering work for ${ctx.projectName} into granular tasks (backend, frontend, ` +
    `infra, testing) with estimated hours, named assignees from the team roster, dependencies, ` +
    `and acceptance criteria per task. Read architecture and API design outputs to ensure tasks ` +
    `map to real services and endpoints. Include critical path analysis.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};

const techDebt: AgentDefinition = {
  id: 'techDebt',
  name: 'Tech Debt Register',
  phase: 'phase4',
  description: 'Known tech debt, shortcuts and future refactoring plan',
  outputLabel: 'Tech Debt Register',
  dependsOn: ['architecture'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Technical Debt Management Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 1200) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Tech Debt Register with:`,
    `1. Planned Technical Shortcuts (accepted for MVP)`,
    `2. Tech Debt Register (table: ID, Category, Description, Impact, Effort to Fix, Priority, Target Sprint, Owner)`,
    `3. Architectural Debt items`,
    `4. Dependency & Upgrade Schedule`,
    `5. Code Quality Targets (coverage %, linting rules, complexity thresholds)`,
    `6. Refactoring Roadmap (post-MVP phases)`,
    `7. Monitoring for Debt Growth`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a Tech Debt Register for ${ctx.projectName} — planned MVP shortcuts, a scored ` +
    `debt register (ID, category, impact, effort, priority, target sprint, owner), architectural ` +
    `debt items, dependency upgrade schedule, and a post-MVP refactoring roadmap. Read architecture ` +
    `output to identify concrete debt items from the chosen tech stack.`,
  tools: RESEARCH_TOOLS,

};

const codeStructure: AgentDefinition = {
  id: 'codeStructure',
  name: 'Code Structure Generator',
  phase: 'phase4',
  description: 'Recommended repository and code folder structure based on the architecture',
  outputLabel: 'Code Folder Structure',
  dependsOn: ['architecture'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Code Structure Agent. Translate the system architecture into a concrete, opinionated repository and folder layout that engineers can scaffold immediately.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 1800) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Code Folder Structure document with:`,
    `1. Repository Strategy (monorepo vs. polyrepo, with rationale)`,
    `2. Top-level Directory Tree — show the FULL tree in a fenced \`\`\`text block`,
    `3. Purpose of each top-level directory and key subdirectory`,
    `4. Module/Service Boundaries — how the tree maps to architecture services`,
    `5. Naming Conventions (files, folders, modules, components)`,
    `6. Configuration & Environment File Placement`,
    `7. Where Tests Live (mirroring strategy vs. co-location)`,
    `8. Notes for Scaffolding Tooling`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a Code Folder Structure document for ${ctx.projectName} — repository strategy ` +
    `(mono vs poly with rationale), full directory tree in a fenced text block, naming conventions, ` +
    `module/service boundary mapping, and test co-location strategy. Read architecture output to ` +
    `ensure the folder tree maps 1:1 to the architecture's service boundaries.`,
  tools: RESEARCH_TOOLS,

};

const codeSnippets: AgentDefinition = {
  id: 'codeSnippets',
  name: 'Code Snippet Generator',
  phase: 'phase4',
  description: 'Representative starter code snippets derived from the architecture, API design, and UX/interaction design',
  outputLabel: 'Code Snippets',
  dependsOn: ['architecture', 'apiDesign', 'interaction'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Code Snippet Agent. Produce representative, runnable-quality starter code grounded in the architecture, API design, and UX/interaction design provided.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 1200) ?? ''}`,
    `API Design Summary:\n${ctx.priorOutputs.apiDesign?.slice(0, 1200) ?? ''}`,
    `Interaction/UX Design Summary:\n${ctx.priorOutputs.interaction?.slice(0, 1000) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Code Snippets document with:`,
    `1. Brief intro naming the languages/frameworks assumed (consistent with the architecture)`,
    `2. One representative Backend API Handler/Controller for a key endpoint, in a fenced code block`,
    `3. One representative Data Model / Entity definition matching the architecture's data layer`,
    `4. One representative Frontend Component/Screen skeleton implementing a key interaction`,
    `5. One representative Service/Business Logic function`,
    `6. For each snippet: a short paragraph explaining what it does and where it fits in the folder structure`,
    `7. Keep each snippet concise (roughly 20-50 lines) and focused`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce representative starter code snippets for ${ctx.projectName} in the languages ` +
    `and frameworks chosen in the architecture: one backend API handler, one data model/entity, ` +
    `one frontend component, and one service/business-logic function. Read architecture, API design, ` +
    `and interaction outputs to ensure snippets use the real endpoints, entities, and UI patterns. ` +
    `Each snippet 20-50 lines with a contextual explanation.`,
  tools: ALL_TOOLS,
  maxIterations: 4,

};

const uiComponentLibrary: AgentDefinition = {
  id: 'uiComponentLibrary',
  name: 'UI Component Library',
  phase: 'phase4',
  description: 'Reusable UI component inventory and component library management strategy',
  outputLabel: 'UI Component Library Plan',
  dependsOn: ['interaction', 'codeStructure'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the UI Component Library Agent. Identify reusable UI components, decide which belong in a shared library vs. page-specific, and define how the library should be structured, versioned, and maintained.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Interaction Design Excerpt:\n${ctx.priorOutputs.interaction?.slice(0, 1500) ?? ctx.projectDescription}`,
    `Code Folder Structure Excerpt:\n${ctx.priorOutputs.codeStructure?.slice(0, 1000) ?? ''}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a UI Component Library Plan with:`,
    `1. Component Inventory (table: Component Name, Category, Description, Used On Screens, Reusable?)`,
    `2. Reusable Component Library — components for the shared library with props/variants and design token dependencies`,
    `3. Page-Specific Components — components that should NOT be generalized, with rationale`,
    `4. Component Library Folder Structure in a fenced \`\`\`text block`,
    `5. Naming & Versioning Conventions`,
    `6. Documentation & Discovery Strategy`,
    `7. Governance — who owns/reviews additions (assign from actual team member names above)`,
    `8. Design Token Mapping`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a UI Component Library Plan for ${ctx.projectName} — component inventory table ` +
    `(name, category, screens used, reusable?), shared library component definitions with props/variants, ` +
    `library folder structure, governance model with named owners, and design token mapping. Read ` +
    `interaction and codeStructure outputs to ensure components align with the design system and ` +
    `folder conventions.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};

const codeReviewStandards: AgentDefinition = {
  id: 'codeReviewStandards',
  name: 'Code Review Standards',
  phase: 'phase4',
  description: 'Code review checklist, standards and best practices',
  outputLabel: 'Code Review Standards',
  dependsOn: ['codeStructure', 'architecture'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Code Review Standards Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 800) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Code Review Standards document with:`,
    `1. Code Review Philosophy & Goals`,
    `2. Review Process (who reviews, turnaround SLA, approval requirements — assign reviewers from team above)`,
    `3. Pre-submission Checklist (author responsibilities before opening a PR)`,
    `4. Reviewer Checklist (correctness, security, performance, readability, tests)`,
    `5. Language/Framework-Specific Standards (based on the architecture's tech stack)`,
    `6. Security Review Checklist (OWASP items relevant to this project)`,
    `7. Performance Review Checklist`,
    `8. Automated Checks (linting, formatting, test coverage gates, static analysis)`,
    `9. Handling Disagreements & Escalation`,
    `10. Metrics (PR cycle time, review coverage targets)`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce Code Review Standards for ${ctx.projectName} — author + reviewer checklists, ` +
    `language/framework-specific standards matching the architecture's tech stack, security and ` +
    `performance review checklists, automated gate requirements (linting, coverage), and named ` +
    `reviewers from the team roster. Read architecture and codeStructure outputs for technology context.`,
  tools: RESEARCH_TOOLS,

};

const roadmapPlanner: AgentDefinition = {
  id: 'roadmapPlanner',
  name: 'Roadmap Planner',
  phase: 'phase4',
  description: 'Long-term product roadmap beyond the initial sprint plan',
  outputLabel: 'Product Roadmap',
  dependsOn: ['sprintPlanner', 'feasibility'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Product Roadmap Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Sprint Plan Summary:\n${ctx.priorOutputs.sprintPlanner?.slice(0, 1000) ?? ''}`,
    `Feasibility Summary:\n${ctx.priorOutputs.feasibility?.slice(0, 800) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Product Roadmap with:`,
    `1. Vision Statement (1-2 sentences on the 3-year product vision)`,
    `2. Now / Next / Later Framework — categorize initiatives into 3 horizons`,
    `3. Quarterly Roadmap (Q1-Q4 for Year 1) — themes, major features, success metrics per quarter`,
    `4. Year 2-3 Outlook — major capability areas and strategic bets`,
    `5. Dependency Map — cross-team or cross-system dependencies that constrain the roadmap`,
    `6. Investment Themes — the 3-5 strategic bets the roadmap is making and why`,
    `7. Risks to the Roadmap — what could cause major re-planning`,
    `8. Roadmap Review Cadence — who reviews, how often, what triggers a revision (assign DRI from team above)`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a Product Roadmap for ${ctx.projectName} with a 3-year vision statement, ` +
    `Now/Next/Later horizon categorisation, Q1-Q4 Year 1 quarterly plan with per-quarter success ` +
    `metrics, Year 2-3 strategic bets, dependency map, and a named DRI for roadmap governance. ` +
    `Read sprint plan and feasibility outputs to anchor the roadmap in committed velocity and ` +
    `known financial constraints.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};

// ─── Phase 5 ──────────────────────────────────────────────────────────────────
const testPlan: AgentDefinition = {
  id: 'testPlan',
  name: 'Test Plan',
  phase: 'phase5',
  description: 'Master test plan covering all testing levels',
  outputLabel: 'Master Test Plan',
  dependsOn: ['architecture', 'userStory'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Test Planning Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 1000) ?? ''}`,
    `User Stories Excerpt:\n${ctx.priorOutputs.userStory?.slice(0, 800) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a Master Test Plan with:`,
    `1. Test Strategy Overview (assign test lead from actual team member names above)`,
    `2. Testing Levels: Unit, Integration, System, UAT, Performance, Security, Accessibility`,
    `3. Test Environment Requirements`,
    `4. Test Data Management`,
    `5. Test Tools & Frameworks`,
    `6. Entry/Exit Criteria per testing level`,
    `7. Defect Management Process (assign triage owners from team member names)`,
    `8. Test Metrics & Reporting`,
    `9. Risk-Based Testing Approach`,
    `10. Automation Strategy`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce a Master Test Plan for ${ctx.projectName} covering all testing levels ` +
    `(unit, integration, system, UAT, performance, security, accessibility) with named test lead, ` +
    `entry/exit criteria per level, tool stack, risk-based test prioritisation, and automation ` +
    `strategy. Read architecture and user story outputs to ensure coverage maps to real services ` +
    `and acceptance criteria.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};

const testCases: AgentDefinition = {
  id: 'testCases',
  name: 'Test Cases',
  phase: 'phase5',
  description: 'Detailed test cases for critical user flows',
  outputLabel: 'Test Cases',
  dependsOn: ['testPlan', 'userStory'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Test Case Author Agent. Write detailed, executable test cases.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Test Plan Summary:\n${ctx.priorOutputs.testPlan?.slice(0, 1000) ?? ''}`,
    `User Stories:\n${ctx.priorOutputs.userStory?.slice(0, 1000) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce Test Cases including:`,
    `1. Test Case Register (table: TC-ID, Title, Preconditions, Steps, Expected Result, Priority, Type, Author — use actual team member names as authors)`,
    `2. Happy Path test cases for 5 core flows`,
    `3. Negative test cases (invalid inputs, edge cases, error conditions)`,
    `4. Integration test cases (API contracts, database, third-party services)`,
    `5. Performance test scenarios (load, stress, spike)`,
    `6. Security test cases (OWASP Top 10 relevant items)`,
    `7. Accessibility test cases`,
    `8. Regression test suite outline`,
  ].join('\n'),
  // ── L3 upgrade ──────────────────────────────────────────────────────────
  goal: (ctx) =>
    `Produce executable Test Cases for ${ctx.projectName} — happy path cases for 5 core ` +
    `flows, negative/edge-case tests, integration tests for API contracts, performance test scenarios, ` +
    `OWASP-aligned security test cases, and a regression suite outline. Each case has TC-ID, ` +
    `preconditions, steps, expected result, and named author from the team roster. Read testPlan ` +
    `and userStory outputs to ensure cases trace to acceptance criteria.`,
  tools: RESEARCH_TOOLS,
  maxIterations: 4,

};


// ─── Phase 6 ─────────────────────────────────────────────────────────────────
const workingPrototype: AgentDefinition = {
  id: 'workingPrototype',
  name: 'Working Prototype',
  phase: 'phase6',
  description: "Generates a real codebase in the project's tech stack with live Theme Studio — download as ZIP and run locally",
  outputLabel: 'Interactive Prototype',
  dependsOn: ['architecture', 'uxMockups', 'dataModel', 'apiDesign'],

  systemPrompt: BASE_SYSTEM + `

You are the Working Prototype Agent. You produce a REAL, runnable codebase in the exact technology stack chosen in the Architecture document — not a single-page HTML mockup. The output is a multi-file project that a developer can unzip, run npm install (or equivalent), and have a working app with realistic mock data running locally in under 5 minutes.

You ALSO produce one special preview.html file that is a self-contained single-page version of the prototype for instant in-browser preview without a build step.

CRITICAL OUTPUT FORMAT
======================
Your output MUST follow this structure:

## Tech Stack
[One paragraph describing the stack extracted from the Architecture document]

## File Structure
[A plain text tree of all files you are generating]

## Files

For EACH file, output a fenced code block with the file path as the language identifier:

\`\`\`file:package.json
{ ... }
\`\`\`

\`\`\`file:src/main.tsx
import React from 'react'
...
\`\`\`

\`\`\`file:preview.html
<!DOCTYPE html>
...
\`\`\`

The preview.html MUST be the LAST file and MUST be a complete self-contained interactive prototype.
Do NOT add prose between file blocks. Every file must be complete and runnable.

TECH STACK RULES
================
Read the Architecture document carefully and extract the EXACT technology choices:
- Frontend framework (React, Vue, Angular, Next.js, etc.)
- Backend language and framework (Node/Express, Python/FastAPI, Java/Spring, etc.)
- Database (PostgreSQL, MongoDB, MySQL, SQLite, etc.)
- Package manager and build tool

Generate a codebase in THAT exact stack. Examples:

If stack is React + Node/Express + PostgreSQL:
  frontend/package.json (React, Vite, TypeScript), frontend/src/main.tsx, App.tsx, pages/, components/
  backend/package.json (Express, cors, pg), backend/src/server.js, routes/, db/schema.sql, db/seed.sql
  .env.example, README.md

If stack is Next.js + PostgreSQL:
  package.json, next.config.js, tsconfig.json, app/ or pages/, components/, lib/, db/schema.sql, README.md

If stack is Vue 3 + FastAPI:
  frontend/ (Vue 3 + Vite + TS), backend/ (FastAPI + SQLAlchemy), requirements.txt, db/, README.md

Default if Architecture is absent: React + Vite + TypeScript frontend, Express + SQLite backend.

REQUIRED FILES
==============
1. README.md — exact setup/run instructions, prerequisites, env vars, DB setup commands
2. package.json (or equivalent) — correct dependencies with realistic versions
3. Frontend pages (5 minimum):
   - Dashboard page: KPI cards + SVG bar/sparkline chart + activity feed
   - List page: table with live search, sort, filter, pagination (10/page)
   - Detail page: full record view with Edit/Delete actions
   - Form page: Create/Edit with inline validation + success toast
   - Reports/Kanban/Calendar page (whichever fits the domain best)
4. Shared UI components: Button, Badge, Modal, Table, Card, Toast, Sidebar, ThemeStudio
5. Backend entry point + CRUD route handlers for the primary entity
6. db/schema.sql — all tables with types, constraints, foreign keys
7. db/seed.sql — 25 realistic domain records (NEVER "lorem ipsum" or "John Doe")
8. .env.example — all required env vars with descriptions
9. preview.html — LAST FILE — complete self-contained interactive prototype (see below)

MOCK DATA — 25 REALISTIC RECORDS
====================================
- Use domain-appropriate names, companies, realistic values
- Status field: 3-5 meaningful statuses (e.g. Active/Pending/Completed/Archived)
- Dates spanning the past 6 months
- Include in both db/seed.sql AND as a mockData.ts/js file in the frontend

PREVIEW.HTML — SELF-CONTAINED INTERACTIVE PROTOTYPE
=====================================================
This is the MOST IMPORTANT file. It must be a complete <!DOCTYPE html> document with:

ALL CSS in one <style> block using CSS custom properties on :root:
  --color-primary, --color-secondary, --color-bg, --color-surface,
  --color-text, --color-text-muted, --color-border, --color-success,
  --color-warning, --color-danger, --font-family, --radius,
  --spacing-base, --shadow-sm, --shadow-md, --transition

5 INTERACTIVE SCREENS (adapt names to the domain):
  Screen 1 — Dashboard: 4-6 KPI cards + SVG bar/sparkline chart + activity feed (8-10 items)
  Screen 2 — List: full table with live search, 2 sortable columns, status filter, pagination (10/page)
  Screen 3 — Detail: full record view, breadcrumb, Edit + Delete with confirmation modal
  Screen 4 — Form: Create/Edit with inline validation (blur), disabled submit until valid, success toast
  Screen 5 — Reports or Kanban or Calendar (domain-appropriate with real interactivity)

NAVIGATION: sidebar on desktop (>=768px), bottom tabs on mobile. Smooth 200ms CSS transitions.

FLOATING THEME STUDIO (🎨 FAB, fixed bottom-right, z-index 99999):
  - Color pickers: primary, secondary, background, surface, text
  - 6 preset swatches: Default, Ocean, Forest, Sunset, Violet, Midnight
  - Dark/Light mode toggle
  - Font selector: Inter, Roboto, Georgia, Mono, Poppins (5 options)
  - Border radius slider: 0–24px
  - Spacing slider: 4–16px (step 2)
  - ALL changes instant via document.documentElement.style.setProperty() — no reload
  - Panel: glass-morphism style, 280px wide, collapsible via FAB, close button top-right

UX QUALITY:
  - Status badges (colored pills), avatar initials circles (32-36px, color derived from name)
  - Toast notifications (slide in top-right, auto-dismiss 3s, green/red)
  - Loading skeleton shimmer on first render (show for 300ms then swap to real content)
  - Empty states with CTAs, never blank screens
  - Responsive: sidebar collapses to bottom tabs at 768px; table scrolls horizontally on mobile
  - cursor: pointer on all interactive elements; visible focus rings (2px solid var(--color-primary))
  - SVG charts: responsive with viewBox, accessible <title> elements — NO Chart.js, NO canvas

NO external dependencies — no CDN, no external fonts, no images. Everything inline.
Single <style> block, then HTML, then single <script> block.

UX/UI PRINCIPLES (ui-ux-pro-max)
=================================
- Typography: base 16px, line-height 1.6, type scale 12/13/14/16/20/24/32px
- Spacing: 8dp grid system, --spacing-base as the unit
- Cards: box-shadow 0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.04), border-radius var(--radius)
- Buttons: min 44px height, clear hover/active states, disabled opacity 0.45
- All transitions: 150-300ms ease-out, transform+opacity only (never width/height)
- Color contrast: minimum 4.5:1 for body text; 3:1 for large text and UI elements`,

  buildUserPrompt: (ctx: AgentPromptContext): string => {
    // Prefer explicit project tech stack; fall back to extracting from Architecture output
    let stackSection: string;
    if (ctx.techStack) {
      stackSection = ctx.techStack;
    } else {
      const archExcerpt = ctx.priorOutputs.architecture ?? '';
      const stackMatch = archExcerpt.match(/##\s*(?:\d+\.\s*)?Technology Stack[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n#[^#]|$)/i);
      stackSection = stackMatch ? stackMatch[1].slice(0, 1500) : archExcerpt.slice(0, 1000);
    }

    return [
      `Project: ${ctx.projectName}`,
      `Domain: ${ctx.domain}`,
      `Project Description: ${ctx.projectDescription}`,
      ``,
      `=== TECHNOLOGY STACK (USE THIS EXACT STACK — DO NOT DEVIATE) ===`,
      stackSection || '(No stack specified — default to React + Vite + TypeScript frontend, Express + SQLite backend)',
      ``,
      `=== UX Mockups / Style Guide (extract colors, typography, visual direction) ===`,
      ctx.priorOutputs.uxMockups?.slice(0, 1000) ?? 'No UX mockups — use clean professional SaaS design system.',
      ``,
      `=== Data Model (use entities/fields for schema.sql and mock data) ===`,
      ctx.priorOutputs.dataModel?.slice(0, 1000) ?? '',
      ``,
      `=== API Design (use routes/operations for backend route handlers) ===`,
      ctx.priorOutputs.apiDesign?.slice(0, 600) ?? '',
      domainLine(ctx),
      teamLine(ctx),
      brandingLine(ctx),
      ``,
      `=== TASK ===`,
      `Generate a complete runnable codebase for "${ctx.projectName}" using the tech stack above.`,
      ``,
      `Output each file as a fenced block: \`\`\`file:path/to/file`,
      ``,
      `REQUIRED FILES:`,
      `1. README.md — prerequisites, install, DB setup, env vars, dev server commands`,
      `2. package.json (or equivalent) — correct dependencies`,
      `3. Frontend: 5 page components (Dashboard with SVG charts, List with search+sort+pagination,`,
      `   Detail with Edit/Delete, Form with inline validation+toast, Reports/Kanban/Calendar)`,
      `4. Shared UI: Button, Badge, Modal, Toast, Sidebar, ThemeStudio components`,
      `5. Backend: server entry + CRUD routes for ${ctx.domain} entity`,
      `6. db/schema.sql — all tables with proper types/constraints`,
      `7. db/seed.sql — 25 realistic ${ctx.domain} records, NO placeholders`,
      `8. .env.example — all required environment variables`,
      `9. preview.html — LAST FILE — complete self-contained interactive prototype with:`,
      `   - 5 working screens (Dashboard, List, Detail, Form, Reports/Kanban) with real mock data`,
      `   - Floating Theme Studio (🎨 FAB, bottom-right) with colors, presets, dark mode, font, radius, spacing`,
      `   - All CSS via custom properties, no external dependencies, sidebar+bottom-tab nav`,
      ``,
      `Mock data: 25 realistic ${ctx.domain} records. NEVER use "lorem ipsum", "John Doe", or placeholders.`,
    ].join('\n');
  },

  goal: (ctx: AgentPromptContext): string => {
    let stackHint: string;
    if (ctx.techStack) {
      stackHint = ctx.techStack;
    } else {
      const archExcerpt = ctx.priorOutputs.architecture ?? '';
      const stackMatch = archExcerpt.match(/##\s*(?:\d+\.\s*)?Technology Stack[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n#[^#]|$)/i);
      stackHint = stackMatch
        ? stackMatch[1].slice(0, 300).replace(/\n/g, ' ')
        : 'React + TypeScript + Express + SQLite';
    }
    return (
      `Generate a complete runnable codebase for ${ctx.projectName} (${ctx.domain} domain) ` +
      `using the tech stack: ${stackHint}. ` +
      `Output each file as a fenced block with path as language tag (e.g. \`\`\`file:src/App.tsx). ` +
      `Include README.md, package.json, 5 frontend page components (Dashboard with SVG charts, ` +
      `List with search+sort+filter+pagination, Detail with Edit/Delete, Form with inline validation+toast, ` +
      `Reports or Kanban), shared UI components (ThemeStudio, Modal, Badge, Toast, Sidebar), ` +
      `backend CRUD routes, db/schema.sql, db/seed.sql (25 realistic records), .env.example, ` +
      `and preview.html (last file) — self-contained single-file app with 5 screens, ` +
      `floating Theme Studio FAB (🎨 colors+presets+dark mode+font+radius+spacing), ` +
      `sidebar+bottom-tab nav, responsive, CSS custom properties throughout, no external deps.`
    );
  },

  tools: CONTEXT_TOOLS,
  maxIterations: 5,
};


// ─── Phase 7 ──────────────────────────────────────────────────────────────────
const devopsEngineer: AgentDefinition = {
  id: 'devopsEngineer',
  name: 'DevOps Engineer',
  phase: 'phase7',
  description: 'CI/CD pipeline design and deployment strategy',
  outputLabel: 'DevOps & CI/CD Design',
  dependsOn: ['architecture'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the DevOps Engineer Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 1200) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce a DevOps & CI/CD Design document with:`,
    `1. CI/CD Pipeline Architecture (stages: build, test, security scan, deploy)`,
    `2. Branch Strategy (GitFlow or trunk-based)`,
    `3. Environment Strategy (dev, staging, prod — promotion criteria)`,
    `4. Container Strategy (Dockerfile guidelines, image registry, tagging)`,
    `5. Deployment Strategy (blue/green, canary, rolling — with rationale)`,
    `6. Infrastructure as Code approach (Terraform / Pulumi)`,
    `7. Secret Management`,
    `8. Rollback Procedures`,
    `9. Pipeline YAML skeleton (GitHub Actions or equivalent)`,
    `10. DORA Metrics targets — assign metric owners from actual team member names above`,
    diagramLine('Draw a flowchart TD of the full CI/CD pipeline from code commit to production deployment.'),
  ].join('\n'),
};

const infraEngineer: AgentDefinition = {
  id: 'infraEngineer',
  name: 'Infrastructure Engineer',
  phase: 'phase7',
  description: 'Cloud infrastructure design and resource sizing',
  outputLabel: 'Infrastructure Design',
  dependsOn: ['architecture'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Infrastructure Engineer Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 1200) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce an Infrastructure Design document with:`,
    `1. Cloud Provider Recommendation & Justification`,
    `2. Network Architecture (VPC, subnets, security groups, load balancers)`,
    `3. Compute Resources (instance types, auto-scaling groups, sizing rationale)`,
    `4. Database Infrastructure (managed services, read replicas, multi-AZ)`,
    `5. Storage Strategy (object storage, block storage, file storage)`,
    `6. CDN & Edge Configuration`,
    `7. Cost Estimate (monthly, by service)`,
    `8. Capacity Planning (6-month, 12-month projections)`,
    `9. Disaster Recovery Architecture (RPO/RTO targets)`,
    `10. Infrastructure Runbook — assign runbook owners from actual team member names above`,
    diagramLine('Draw a flowchart LR showing the cloud infrastructure topology (VPC, subnets, compute, load balancer, database, CDN).'),
  ].join('\n'),
};

// ─── Phase 8 ──────────────────────────────────────────────────────────────────
const observabilityEngineer: AgentDefinition = {
  id: 'observabilityEngineer',
  name: 'Observability Engineer',
  phase: 'phase8',
  description: 'Monitoring, logging, tracing and alerting design',
  outputLabel: 'Observability Design',
  dependsOn: ['devopsEngineer', 'infraEngineer'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the Observability Engineer Agent.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Architecture Summary:\n${ctx.priorOutputs.architecture?.slice(0, 800) ?? ''}`,
    `Infrastructure Summary:\n${ctx.priorOutputs.infraEngineer?.slice(0, 800) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce an Observability Design document with:`,
    `1. Observability Strategy (pillars: Metrics, Logs, Traces) — assign observability lead from actual team member names above`,
    `2. Metrics Design (SLIs, SLOs, SLAs — define at least 5 SLIs)`,
    `3. Logging Strategy (log levels, structured logging schema, retention)`,
    `4. Distributed Tracing Design`,
    `5. Dashboard Design (list of dashboards and key panels)`,
    `6. Alerting Rules (table: Alert Name, Condition, Severity, On-Call Action, Owner — use actual team member names as owners)`,
    `7. Synthetic Monitoring`,
    `8. Tooling Stack (Prometheus, Grafana, OpenTelemetry, etc.)`,
    `9. Runbook Template`,
    diagramLine('Draw a sequenceDiagram showing the alerting pipeline: metric threshold → alert → on-call notification → escalation → resolution.'),
  ].join('\n'),
};

const onCallEngineer: AgentDefinition = {
  id: 'onCallEngineer',
  name: 'On-Call Engineer',
  phase: 'phase8',
  description: 'On-call playbook, incident runbooks and escalation procedures',
  outputLabel: 'On-Call Playbook',
  dependsOn: ['observabilityEngineer', 'securityCompliance'],
  systemPrompt: `${BASE_SYSTEM}\n\nYou are the On-Call Engineering Agent. Your output is the definitive operational playbook.`,
  buildUserPrompt: (ctx) => [
    `Project: ${ctx.projectName}`,
    `Observability Design:\n${ctx.priorOutputs.observabilityEngineer?.slice(0, 1000) ?? ''}`,
    `Security Report Summary:\n${ctx.priorOutputs.securityCompliance?.slice(0, 500) ?? ctx.projectDescription}`,
    domainLine(ctx),
    teamLine(ctx),
    `\nProduce an On-Call Playbook with:`,
    `1. On-Call Responsibilities & Schedule — assign on-call rotation slots to actual team members by name`,
    `2. Incident Severity Levels (P0-P4 with response time SLAs)`,
    `3. Incident Response Process (detect, triage, communicate, resolve, review)`,
    `4. Escalation Matrix — use actual team member names as escalation contacts at each tier`,
    `5. Runbooks for top 10 likely incidents (each: trigger, impact, diagnosis steps, resolution steps, responsible person)`,
    `6. Communication Templates (status page update, customer email, internal Slack) — name the DRI for each from team members above`,
    `7. Post-Incident Review Template — assign facilitator from team members`,
    `8. On-Call Health & Burnout Prevention`,
  ].join('\n'),
};

// ─── Registry ──────────────────────────────────────────────────────────────────────────────
export const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  sdlcOrchestrator,
  manager,
  projectCharter,
  brd,
  stakeholder,
  userStory,
  businessRules,
  feasibility,
  dataModel,
  architecture,
  apiDesign,
  uxResearch,
  interaction,
  uxMockups,
  sprintPlanner,
  taskBreakdown,
  techDebt,
  codeStructure,
  codeSnippets,
  uiComponentLibrary,
  testPlan,
  testCases,
  securityCompliance,
  devopsEngineer,
  infraEngineer,
  observabilityEngineer,
  onCallEngineer,
  workingPrototype,
};
