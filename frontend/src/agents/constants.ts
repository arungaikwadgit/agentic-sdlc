/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import type { PhaseId, AgentId } from '@/types/agent.types';


/** Ordered phase execution sequence */
export const PHASE_ORDER: PhaseId[] = [
  'phase0',
  'phase1',
  'phase1b',
  'phase2',
  'phase3',
  'phase3b',
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
  phase0: ['sdlcOrchestrator'],
  phase1: ['manager'],
  phase1b: ['projectCharter', 'brd'],
  phase2: ['stakeholder', 'userStory', 'businessRules', 'feasibility', 'dataModel'],
  phase3: ['architecture', 'apiDesign', 'uxResearch', 'interaction', 'uxMockups'],
  phase3b: ['securityCompliance'],
  phase4: ['sprintPlanner', 'taskBreakdown', 'techDebt', 'codeStructure', 'codeSnippets', 'uiComponentLibrary', 'codeReviewStandards', 'roadmapPlanner'],
  phase5: ['testPlan', 'testCases'],
  // phase6 now hosts the Working Prototype agent — a self-contained interactive HTML prototype
  // generated from UX mockups + data model + API design outputs.
  phase6: ['workingPrototype'],
  phase7: ['devopsEngineer', 'infraEngineer'],
  phase8: ['observabilityEngineer', 'onCallEngineer'],
};

// M-01 fix: derived dynamically so it never goes stale when agents are added/removed
export const TOTAL_AGENTS = Object.values(PHASE_AGENTS).flat().length;

/** Review gates — which phases must complete before the gate triggers */
export const REVIEW_GATES = {
  gate1: ['phase1', 'phase1b'] as PhaseId[],
  gate2: ['phase2'] as PhaseId[],
  gate3: ['phase3', 'phase3b'] as PhaseId[],
  gate5: ['phase5'] as PhaseId[],
  // gate6 has no phases — the Working Prototype (phase6) is exploratory and does not
  // require a stakeholder approval gate. gate6 is retained in ReviewGateId for index stability.
  gate6: [] as PhaseId[],
};

export const PHASE_LABELS: Record<PhaseId, string> = {
  phase0: 'Phase 0 — SDLC Orchestrator',
  phase1: 'Phase 1 — PRD',
  phase1b: 'Phase 1B — Foundation',
  phase2: 'Phase 2 — Requirements',
  phase3: 'Phase 3 — Design',
  phase3b: 'Phase 3B — Security Review',
  phase4: 'Phase 4 — Dev Planning',
  phase5: 'Phase 5 — Testing',
  phase6: 'Phase 6 — Prototype',
  phase7: 'Phase 7 — DevOps',
  phase8: 'Phase 8 — Operations',
};

/**
 * Maps each phase to its standard SDLC stage, shown as a subtitle under the
 * phase label in the sidebar (see ProjectWorkspace.tsx). phase6 maps to ''
 * since it is empty/unused and never rendered in the sidebar.
 */
export const PHASE_SDLC_STAGE: Record<PhaseId, string> = {
  phase0: 'Orchestration',
  phase1: 'Initiation',
  phase1b: 'Initiation',
  phase2: 'Requirements',
  phase3: 'Design',
  phase3b: 'Design (Security Gate)',
  phase4: 'Development Planning',
  phase5: 'Testing',
  phase6: 'Prototype',
  phase7: 'Deployment',
  phase8: 'Operations & Maintenance',
};
