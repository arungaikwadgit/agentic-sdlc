/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import type { ModelCatalogEntry } from './model.types';

export type AgentStatus = 'idle' | 'running' | 'complete' | 'error' | 'skipped';

export type PhaseId =
  | 'phase0'
  | 'phase0a'  // tokenOptimizer (depends on phase0 orchestration plan)
  | 'phase0b'  // aiGovernance (reviews orchestration + token optimization before gate0)
  | 'phase1'
  | 'phase1b'
  | 'phase2'
  | 'phase2a'   // dataModel (depends on businessRules from phase2)
  | 'phase3'
  | 'phase3a'   // apiDesign + interaction (depend on phase3 outputs)
  | 'phase3c'   // uxMockups (depends on phase3a outputs)
  | 'phase3b'
  | 'phase4'
  | 'phase4a'   // codeReviewStandards + uiComponentLibrary + roadmapPlanner (depend on phase4)
  | 'phase5'
  | 'phase6'
  | 'phase7'
  | 'phase8';

export type AgentId =
  // Phase 0
  | 'sdlcOrchestrator'
  // Governed preflight
  | 'tokenOptimizer'
  | 'aiGovernance'
  // Phase 1
  | 'manager'
  // Phase 1B
  | 'projectCharter'
  | 'brd'
  // Phase 2
  | 'stakeholder'
  | 'userStory'
  | 'businessRules'
  | 'feasibility'
  | 'dataModel'
  // Phase 3
  | 'architecture'
  | 'apiDesign'
  | 'uxResearch'
  | 'interaction'
  | 'uxMockups'
  // Phase 3B
  | 'securityCompliance'
  // Phase 4
  | 'sprintPlanner'
  | 'taskBreakdown'
  | 'techDebt'
  | 'codeStructure'
  | 'codeSnippets'
  | 'uiComponentLibrary'
  | 'codeReviewStandards'
  | 'roadmapPlanner'
  // Phase 5
  | 'testPlan'
  | 'testCases'
  // Phase 6
  | 'workingPrototype'
  // Phase 7
  | 'devopsEngineer'
  | 'infraEngineer'
  // Phase 8
  | 'observabilityEngineer'
  | 'onCallEngineer';

// ─── L3 Agent constructs ─────────────────────────────────────────────────────

/** A single tool the agent can invoke */
export interface AgentTool {
  /** Unique snake_case name used in LLM tool_call.name */
  name: string;
  /** Human-readable description passed to the LLM in the tools list */
  description: string;
  /** JSON Schema describing the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /** Execute the tool. Returns a JSON-serialisable result. */
  execute: (args: Record<string, unknown>, ctx: AgentPromptContext) => Promise<unknown>;
}

/** One entry in the agent's append-only tool trace */
export interface ToolTraceEntry {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;
  durationMs: number;
}

/** A plan revision record — captured whenever the agent reformulates its plan */
export interface PlanRevision {
  revision: number;
  steps: string[];
  reason: string;
  timestamp: number;
}

/** A decision the agent records during execution */
export interface AgentDecision {
  type: 'tool_selected' | 'plan_revised' | 'output_accepted' | 'retry';
  rationale: string;
  confidence: number;   // 0.0 – 1.0
  timestamp: number;
}

/** One LLM call's measured token cost within an L3 run — recorded so token
 *  usage can be inspected per-call instead of only as a single aggregate
 *  total (added 2026-07-17 after having to guess at where a run's tokens
 *  went from the total alone). See L3RuntimeMeta.iterationTokens. */
export interface IterationTokenEntry {
  /** 1-indexed iteration number, or -1 for the tool-free forced-finalization call. */
  iteration: number;
  tokens: number;
  /** Which system prompt variant this call used — 'intermediate' means
   *  AgentDefinition.intermediateSystemPrompt was used instead of the full
   *  prompt (see l3Runtime.ts); 'full' covers iteration 0 once gathering is
   *  done, the near-limit iteration, and every call for agents that don't
   *  define intermediateSystemPrompt; 'forced-final' is the tool-free
   *  finalization call, which always uses the original full systemPrompt. */
  promptVariant: 'full' | 'intermediate' | 'forced-final';
  timestamp: number;
}

/** L3 runtime metadata stored alongside AgentRun */
export interface L3RuntimeMeta {
  goal: string;
  planRevisions: PlanRevision[];
  toolTrace: ToolTraceEntry[];
  decisions: AgentDecision[];
  iterationCount: number;
  /** Per-call token usage — see IterationTokenEntry. Sums to the run's
   *  total tokensUsed (AgentRun.tokensUsed / L3RunResult.tokensUsed). */
  iterationTokens: IterationTokenEntry[];
  /**
   * Set only when the run finished (FINAL_OUTPUT or passthrough) while one
   * or more of AgentDefinition.requiredTools had never been called, after
   * exhausting the runtime's corrective-nudge budget. Undefined/absent
   * means either the agent has no requiredTools, or it satisfied all of
   * them. Surfaced as a warning in AgentThinkingPanel.
   */
  incompleteRequiredTools?: string[];
  /** Mechanical validation of the required Validation & Confidence footer. */
  outputGovernance?: {
    passed: boolean;
    score: number | null;
    issues: string[];
    blocked: boolean;
  };
  /**
   * Set to true only when AgentDefinition.requiresDiagram is true and the
   * final output still has no detectable fenced ```mermaid block after
   * exhausting the runtime's diagram-correction budget (see
   * MAX_DIAGRAM_CORRECTIONS in l3Runtime.ts). Undefined/absent means either
   * the agent doesn't require a diagram, or it produced one. Surfaced as a
   * warning in AgentThinkingPanel, same treatment as
   * incompleteRequiredTools/outputGovernance above.
   */
  missingDiagram?: boolean;
}

export interface AgentDefinition {
  id: AgentId;
  name: string;
  phase: PhaseId;
  description: string;
  outputLabel: string;
  /** Internal agents execute and remain auditable but are hidden from normal project UX/export. */
  visibility?: 'standard' | 'internal';
  systemPrompt: string;
  /** Function returning the user prompt given project context */
  buildUserPrompt: (ctx: AgentPromptContext) => string;
  /** Agents that must complete before this one can run */
  dependsOn?: AgentId[];
  /**
   * L3 upgrade: natural-language goal this agent is trying to achieve.
   * When set, the agent runs through the L3 plan→act→observe→revise loop
   * instead of the single-shot LLM call.
   */
  goal?: (ctx: AgentPromptContext) => string;
  /**
   * L3 upgrade: tools this agent can invoke during its reasoning loop.
   * If empty/absent the agent runs in L2 (single-shot) mode.
   */
  tools?: AgentTool[];
  /**
   * L3 upgrade: maximum plan-act-observe iterations before forcing output.
   * Defaults to 3.
   */
  maxIterations?: number;
  /**
   * L3 upgrade: tool names (matching AgentTool.name) that MUST be called at
   * least once before the runtime accepts a FINAL_OUTPUT/passthrough as
   * done. Without this, a model that drops the TOOL_CALL/FINAL_OUTPUT
   * marker formatting mid-sequence gets silently treated as "finished" by
   * runL3Agent's graceful-degradation fallback — even if it skipped most of
   * its mandatory research steps. When set, the runtime instead pushes a
   * bounded number of corrective nudges before giving up (see
   * MAX_CORRECTION_ATTEMPTS in l3Runtime.ts) and flags the gap on
   * L3RuntimeMeta.incompleteRequiredTools if it still can't get there.
   * Currently set on 'sdlcOrchestrator' only — its goal explicitly mandates
   * a 6-tool grounding sequence before writing.
   */
  requiredTools?: string[];
  /**
   * Optional shorter system prompt used INSTEAD of the full `systemPrompt`
   * on L3 iterations where the agent is still gathering its requiredTools
   * (i.e. missingRequired.length > 0 before the call) — see l3Runtime.ts.
   * Only applies while at least one required tool is still outstanding AND
   * the iteration isn't the last-chance ("nearLimit") one; every other
   * call (iteration 0's tool selection is covered by this too, but the
   * near-limit iteration and the forced-finalization call always use the
   * FULL systemPrompt) still gets the complete prompt.
   *
   * Added 2026-07-17 after measuring that sdlcOrchestrator's full
   * systemPrompt (BASE_SYSTEM + a ~5,000-char, 9-section output-format
   * spec) was being resent, unchanged, on every one of its up-to-10 L3
   * iterations — the majority of which are pure tool-selection turns that
   * can't legitimately produce FINAL_OUTPUT yet (requiredTools blocks it).
   * That format spec is only relevant to the call that actually writes the
   * document, so repeating it on every intermediate turn was pure
   * overhead: roughly half of a typical sdlcOrchestrator run's total
   * token cost. Safe by construction — while any required tool is still
   * outstanding, the runtime's own requiredTools enforcement guarantees
   * the model can't legitimately finalize on that call anyway (see the
   * correction-retry block below), so it never needed the format spec for
   * that turn in the first place. Undefined/absent (every other agent)
   * means no change from prior behavior.
   */
  intermediateSystemPrompt?: string;
  /**
   * When true, PipelineEngine pauses before running this agent's generation
   * call — the first time only, i.e. until project.clarifyingAnswers[id] has
   * at least one entry — and instead fires onClarifyingQuestionsNeeded with a
   * generated question set (see services/clarifyingQuestions.ts). The
   * answers are then threaded into this agent's AgentPromptContext via
   * clarifyingAnswers below. Currently set on 'brd' and 'userStory' only.
   */
  needsClarifyingQuestions?: boolean;
  /**
   * When true, the L3 runtime treats "the final output contains at least
   * one fenced ```mermaid diagram block" as a mandatory condition — mirrors
   * the requiredTools mechanism (bounded corrective retry via
   * MAX_DIAGRAM_CORRECTIONS in l3Runtime.ts, then flagged on
   * L3RuntimeMeta.missingDiagram rather than blocked) rather than trusting
   * prompt instructions alone. Set on dataModel, architecture, apiDesign,
   * and interaction — see agents/diagramUtils.ts's DIAGRAM_AGENTS for the
   * UI-side set this should stay in sync with.
   */
  requiresDiagram?: boolean;
}

/** One question/answer pair collected via the pre-generation clarifying-
 *  questions flow (see AgentDefinition.needsClarifyingQuestions). Persisted
 *  on Project.clarifyingAnswers, keyed by AgentId. */
export interface ClarifyingAnswer {
  question: string;
  answer: string;
}

export interface TeamRosterEntry {
  name: string;
  role: string;
  /** Agent IDs this person is assigned to */
  agents: AgentId[];
}

/** Lightweight, read-only view of one entry in AGENT_DEFINITIONS — enough for
 *  the orchestrator to reason about the agent fleet via a tool call instead of
 *  inferring it from memory. Deliberately excludes systemPrompt/goal/tools so
 *  the catalog tool can't be used to exfiltrate prompt internals. */
export interface AgentCatalogEntry {
  id: AgentId;
  name: string;
  phase: PhaseId;
  description: string;
  dependsOn?: AgentId[];
  /** False when this agent has no team member assigned (or was otherwise
   *  marked skipped) and will not execute — see project.skippedAgentIds and
   *  lib/agentEnablement.ts. Lets the orchestrator plan around the actual
   *  available fleet instead of assuming every agent will run. */
  enabled?: boolean;
}

/** Read-only view of the static phase/gate rules (constants.ts), exposed as a
 *  tool result so the orchestrator's plan is grounded in what the pipeline can
 *  actually execute, not a guess baked into its own prompt text. */
export interface PhaseRulesSnapshot {
  phaseOrder: PhaseId[];
  phaseAgents: Record<PhaseId, AgentId[]>;
  parallelPhases: PhaseId[];
  reviewGates: Record<string, PhaseId[]>;
}

export interface AgentRunMetric {
  agentId: AgentId;
  status: AgentStatus;
  tokensUsed: number;
  provider?: AgentRun['provider'];
  model?: string;
}

export interface GovernanceSnapshot {
  reviewGates: Array<{ id: string; approved: boolean; approvedAt?: number; approvedBy?: string }>;
  promptOverrideAgentIds: AgentId[];
  contextDocuments: Array<{ name: string; kind: string; sizeKb: number }>;
  creationApproval: { approverRole?: string; approvedAt?: number } | null;
}

export interface AgentPromptContext {
  projectName: string;
  projectDescription: string;
  domain: string;
  domainContext: string;
  /** Outputs from previously completed agents, keyed by agentId */
  priorOutputs: Partial<Record<AgentId, string>>;
  /** Project team members with their roles and agent assignments */
  teamRoster: TeamRosterEntry[];
  /** Owner-supplied branding guidelines (colors, typography, tone, brand references), if any */
  brandingGuidelines?: string;
  /** Explicit tech stack chosen during project creation (e.g. "React + Node/Express + PostgreSQL") */
  techStack?: string;
  /** Context documents uploaded by the user (style guides, brand docs, design specs, etc.) */
  contextDocuments?: Array<{
    id: string;
    name: string;
    sizeKb: number;
    kind: string;
    content: string;
  }>;
  /**
   * Number of distinct mockup versions the UX Mockups agent should generate.
   * Range 1–4. Defaults to 2 when absent.
   */
  mockupVersionCount?: number;
  /** Commercial delivery model (fixed bid, T&M, etc.) — see ProjectExecutionStyle. */
  projectExecutionStyle?: string;
  /** What's being built (web app, mobile app, etc.) — see ProjectType. */
  projectType?: string;
  /** Read-only agent fleet metadata, populated by PipelineEngine.buildContext(). Only
   *  present for agents whose tools include get_agent_catalog (currently sdlcOrchestrator). */
  agentCatalog?: AgentCatalogEntry[];
  /** Read-only phase/gate rules snapshot, same availability scope as agentCatalog. */
  phaseRules?: PhaseRulesSnapshot;
  /** Admin-configured model catalog (paid + free/open models), same availability scope
   *  as agentCatalog. See types/model.types.ts. */
  modelCatalog?: ModelCatalogEntry[];
  /** Read-only token/provider telemetry for completed and in-flight project agent runs. */
  agentRunMetrics?: AgentRunMetric[];
  /** Read-only governance evidence metadata; never includes hidden prompts or document content. */
  governanceSnapshot?: GovernanceSnapshot;
  /** This agent's own saved Q&A pairs from the pre-generation clarifying-
   *  questions flow, if any (see AgentDefinition.needsClarifyingQuestions).
   *  Populated per-agent by PipelineEngine.buildContext(), not shared across
   *  agents — brd's answers never leak into userStory's context and vice
   *  versa. */
  clarifyingAnswers?: ClarifyingAnswer[];
}

export interface AgentRun {
  agentId: AgentId;
  status: AgentStatus;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  /** Token usage from Anthropic response */
  tokensUsed?: number;
  /**
   * Which provider actually served this run, echoed back by the proxy.
   * 'openai-compatible' means a MODEL_CATALOG entry (e.g. Hugging Face)
   * served it — see dispatchAgentCall() in backend/src/proxy.js.
   */
  provider?: 'openai' | 'claude' | 'openai-compatible';
  /** Which model actually served this run, echoed back by the proxy. */
  model?: string;
  /**
   * Best-known provider routing for a run that is still in progress, derived
   * from the app-level per-agent provider hint at the moment the run started.
   * 'auto' means no explicit hint was set — the backend's default routing
   * (AGENT_PROVIDER_MAP) will decide, and the actual provider/model will be
   * known once the run completes (see `provider`/`model` above).
   * Not meaningful once `status` is 'complete' or 'error'.
   * Can also be a MODEL_CATALOG entry id (e.g. an assigned Hugging Face
   * model) when the agent has a specific model assignment set — see
   * getAgentModelAssignments() in agents/promptDefaults.ts.
   */
  pendingProvider?: 'openai' | 'claude' | 'auto' | (string & {});
  /** L3 runtime metadata — only present for agents that ran in L3 mode */
  l3?: L3RuntimeMeta;
}
