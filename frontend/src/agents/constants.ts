import type { PhaseId, AgentId } from '@/types/agent.types';

export const TOTAL_AGENTS = 26;

/** Ordered phase execution sequence */
export const PHASE_ORDER: PhaseId[] = [
  'phase1',
  'phase1b',
  'phase2',
  'phase3',
  'phase4',
  'phase5',
  'phase6',
  'phase7',
  'phase8',
];

/** Phases that run agents in parallel (vs sequential) */
export const PARALLEL_PHASES: Set<PhaseId> = new Set([
  'phase2',
  'phase3',
  'phase4',
  'phase7',
  'phase8',
]);

/** Agents per phase */
export const PHASE_AGENTS: Record<PhaseId, AgentId[]> = {
  phase1: ['manager'],
  phase1b: ['projectCharter', 'brd'],
  phase2: ['stakeholder', 'userStory', 'businessRules', 'feasibility', 'dataModel'],
  phase3: ['architecture', 'apiDesign', 'uxResearch', 'interaction', 'uxMockups'],
  phase4: ['sprintPlanner', 'taskBreakdown', 'techDebt', 'codeStructure', 'codeSnippets', 'uiComponentLibrary'],
  phase5: ['testPlan', 'testCases'],
  phase6: ['securityCompliance'],
  phase7: ['devopsEngineer', 'infraEngineer'],
  phase8: ['observabilityEngineer', 'onCallEngineer'],
};

/** Review gates — which phases must complete before the gate triggers */
export const REVIEW_GATES = {
  gate1: ['phase1', 'phase1b'] as PhaseId[],
  gate2_3: ['phase2', 'phase3'] as PhaseId[],
  gate5: ['phase5'] as PhaseId[],
  gate6: ['phase6'] as PhaseId[],
};

export const PHASE_LABELS: Record<PhaseId, string> = {
  phase1: 'Phase 1 — Orchestration',
  phase1b: 'Phase 1B — Foundation',
  phase2: 'Phase 2 — Requirements',
  phase3: 'Phase 3 — Design',
  phase4: 'Phase 4 — Dev Planning',
  phase5: 'Phase 5 — Testing',
  phase6: 'Phase 6 — Security',
  phase7: 'Phase 7 — DevOps',
  phase8: 'Phase 8 — Operations',
};
