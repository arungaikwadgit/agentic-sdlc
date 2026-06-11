export type AgentStatus = 'idle' | 'running' | 'complete' | 'error' | 'skipped';

export type PhaseId =
  | 'phase1'
  | 'phase1b'
  | 'phase2'
  | 'phase3'
  | 'phase4'
  | 'phase5'
  | 'phase6'
  | 'phase7'
  | 'phase8';

export type AgentId =
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
  // Phase 4
  | 'sprintPlanner'
  | 'taskBreakdown'
  | 'techDebt'
  | 'codeStructure'
  | 'codeSnippets'
  | 'uiComponentLibrary'
  // Phase 5
  | 'testPlan'
  | 'testCases'
  // Phase 6
  | 'securityCompliance'
  // Phase 7
  | 'devopsEngineer'
  | 'infraEngineer'
  // Phase 8
  | 'observabilityEngineer'
  | 'onCallEngineer';

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
}
