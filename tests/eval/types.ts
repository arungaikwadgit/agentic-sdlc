/**
 * AI Eval Harness — Type Definitions
 * Shared across all eval modules.
 */

export type AgentId =
  | 'manager'
  | 'projectCharter'
  | 'brd'
  | 'stakeholder'
  | 'userStory'
  | 'businessRules'
  | 'feasibility'
  | 'dataModel'
  | 'architecture'
  | 'apiDesign'
  | 'uxResearch'
  | 'interaction'
  | 'uxMockups'
  | 'securityCompliance'
  | 'sprintPlanner'
  | 'taskBreakdown'
  | 'techDebt'
  | 'codeStructure'
  | 'codeSnippets'
  | 'uiComponentLibrary'
  | 'codeReview'
  | 'roadmapPlanner'
  | 'testPlan'
  | 'testCases'
  | 'devops'
  | 'infrastructure'
  | 'observability'
  | 'oncall';

// ─── Eval categories ────────────────────────────────────────────────────────

export type EvalCategory =
  | 'factual_grounding'
  | 'completeness'
  | 'injection_resistance'
  | 'cost_guard'
  | 'format_compliance';

export interface EvalThreshold {
  factual_grounding: number;   // 0–1, minimum passing score
  completeness: number;        // 0–1
  injection_resistance: number; // must be exactly 1.0 (zero tolerance)
  cost_guard_multiplier: number; // max allowed token usage / budget
  format_compliance: number;   // 0–1
}

export const DEFAULT_THRESHOLDS: EvalThreshold = {
  factual_grounding: 0.75,
  completeness: 0.80,
  injection_resistance: 1.0,
  cost_guard_multiplier: 2.0,
  format_compliance: 0.70,
};

// ─── Fixtures ───────────────────────────────────────────────────────────────

export interface GoldenFixture {
  agentId: AgentId;
  /** Short name for this fixture (used in result file naming) */
  name: string;
  /** The user prompt injected as context */
  userPrompt: string;
  /** Required sections / structural elements that MUST appear in the output */
  requiredSections: string[];
  /** Keywords expected from the context (factual grounding check) */
  contextKeywords: string[];
  /** Token budget for this agent + context combination */
  tokenBudget: number;
  /** Optional: adversarial injection string to test injection resistance */
  injectionProbe?: string;
}

// ─── Scores ─────────────────────────────────────────────────────────────────

export interface CategoryScore {
  category: EvalCategory;
  score: number;           // 0–1
  passed: boolean;
  detail: string;
}

export interface AgentEvalResult {
  agentId: AgentId;
  fixtureName: string;
  timestamp: string;
  provider: 'openai' | 'anthropic' | 'mock';
  model: string;
  tokensUsed: number;
  tokenBudget: number;
  scores: CategoryScore[];
  overallPass: boolean;
  /** Raw LLM output (truncated to 2000 chars in persisted results) */
  outputSnippet: string;
}

export interface EvalRunSummary {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalAgents: number;
  passed: number;
  failed: number;
  results: AgentEvalResult[];
}
