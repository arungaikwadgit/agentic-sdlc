/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
export type AgentStatus = 'idle' | 'running' | 'complete' | 'error' | 'skipped';

export type PhaseId =
  | 'phase0'
  | 'phase1'
  | 'phase1b'
  | 'phase2'
  | 'phase3'
  | 'phase3b'
  | 'phase4'
  | 'phase5'
  | 'phase6'
  | 'phase7'
  | 'phase8';

export type AgentId =
  // Phase 0
  | 'sdlcOrchestrator'
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

/** L3 runtime metadata stored alongside AgentRun */
export interface L3RuntimeMeta {
  goal: string;
  planRevisions: PlanRevision[];
  toolTrace: ToolTraceEntry[];
  decisions: AgentDecision[];
  iterationCount: number;
}

export interface AgentDefinition {
  id: AgentId;
  name: string;
  phase: PhaseId;
  description: string;
  outputLabel: string;
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
}

export interface TeamRosterEntry {
  name: string;
  role: string;
  /** Agent IDs this person is assigned to */
  agents: AgentId[];
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
  /** Which provider actually served this run, echoed back by the proxy. */
  provider?: 'openai' | 'claude';
  /** Which model actually served this run, echoed back by the proxy. */
  model?: string;
  /**
   * Best-known provider routing for a run that is still in progress, derived
   * from the app-level per-agent provider hint at the moment the run started.
   * 'auto' means no explicit hint was set — the backend's default routing
   * (AGENT_PROVIDER_MAP) will decide, and the actual provider/model will be
   * known once the run completes (see `provider`/`model` above).
   * Not meaningful once `status` is 'complete' or 'error'.
   */
  pendingProvider?: 'openai' | 'claude' | 'auto';
  /** L3 runtime metadata — only present for agents that ran in L3 mode */
  l3?: L3RuntimeMeta;
}
