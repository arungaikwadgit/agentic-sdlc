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
  'phase2a',  // dataModel (depends on businessRules from phase2)
  'phase3',
  'phase3a',  // apiDesign + interaction (depend on phase3 outputs)
  'phase3c',  // uxMockups (depends on phase3a outputs)
  'phase3b',
  'phase4',
  'phase4a',  // codeReviewStandards + uiComponentLibrary + roadmapPlanner (depend on phase4)
  'phase5',
  'phase6',
  'phase7',
  'phase8',
];

/** Phases that run agents in parallel (vs sequential) */
export const PARALLEL_PHASES: Set<PhaseId> = new Set([
  'phase2',   // businessRules, stakeholder, userStory, feasibility — no mutual deps
  'phase3',   // architecture, uxResearch — no mutual deps
  'phase3a',  // apiDesign, interaction — no mutual deps (both only need phase3 outputs)
  'phase4',   // codeStructure, sprintPlanner, taskBreakdown, techDebt, codeSnippets — no mutual deps
  'phase4a',  // codeReviewStandards, uiComponentLibrary, roadmapPlanner — all depend on phase4, not each other
  'phase7',
  'phase8',
]);

/** Agents per phase — each phase contains only agents whose dependencies are all in prior phases */
export const PHASE_AGENTS: Record<PhaseId, AgentId[]> = {
  phase0:  ['sdlcOrchestrator'],
  phase1:  ['manager'],
  phase1b: ['projectCharter', 'brd'],

  // Phase 2: agents with no intra-phase deps (all depend only on phase1/phase1b outputs)
  phase2:  ['businessRules', 'stakeholder', 'userStory', 'feasibility'],
  // Phase 2a: dataModel depends on businessRules (phase2) — must run after phase2 completes
  phase2a: ['dataModel'],

  // Phase 3 tier 1: architecture + uxResearch have no intra-phase deps
  phase3:  ['architecture', 'uxResearch'],
  // Phase 3 tier 2: apiDesign needs architecture; interaction needs uxResearch
  phase3a: ['apiDesign', 'interaction'],
  // Phase 3 tier 3: uxMockups needs uxResearch + interaction + architecture (all from prior tiers)
  phase3c: ['uxMockups'],

  // Phase 3b: securityCompliance depends on architecture + dataModel (phase3/phase2a) — runs after design gate
  phase3b: ['securityCompliance'],

  // Phase 4 tier 1: all independent (depend only on phase3 outputs)
  phase4:  ['codeStructure', 'sprintPlanner', 'taskBreakdown', 'techDebt', 'codeSnippets'],
  // Phase 4 tier 2: codeReviewStandards + uiComponentLibrary need codeStructure; roadmapPlanner needs sprintPlanner
  phase4a: ['codeReviewStandards', 'uiComponentLibrary', 'roadmapPlanner'],

  phase5:  ['testPlan', 'testCases'],
  // phase6: Working Prototype — generated from UX mockups + data model + API design outputs
  phase6:  ['workingPrototype'],
  phase7:  ['devopsEngineer', 'infraEngineer'],
  phase8:  ['observabilityEngineer', 'onCallEngineer'],
};

// M-01 fix: derived dynamically so it never goes stale when agents are added/removed
export const TOTAL_AGENTS = Object.values(PHASE_AGENTS).flat().length;

/** Review gates — which phases must complete before the gate triggers */
export const REVIEW_GATES = {
  // gate0 fires after the SDLC Orchestrator (phase0) produces its execution
  // plan. The plan must be approved by a project owner or admin before any
  // other agent runs — see ReviewGateModal.tsx's gate0-specific permission
  // check and pipelineEngine.ts's GATE_AFTER_PHASE_INDEX.gate0.
  gate0: ['phase0'] as PhaseId[],
  gate1: ['phase1', 'phase1b'] as PhaseId[],
  // gate2 fires after ALL requirements phases (including phase2a: dataModel)
  gate2: ['phase2', 'phase2a'] as PhaseId[],
  // gate3 fires after ALL design phases (including phase3a, phase3c, phase3b)
  gate3: ['phase3', 'phase3a', 'phase3c', 'phase3b'] as PhaseId[],
  gate5: ['phase5'] as PhaseId[],
  // gate6 has no phases — the Working Prototype (phase6) is exploratory and does not
  // require a stakeholder approval gate. gate6 is retained in ReviewGateId for index stability.
  gate6: [] as PhaseId[],
};

export const PHASE_LABELS: Record<PhaseId, string> = {
  phase0:  'Phase 0 — SDLC Orchestrator',
  phase1:  'Phase 1 — PRD',
  phase1b: 'Phase 1B — Foundation',
  phase2:  'Phase 2 — Requirements',
  phase2a: 'Phase 2A — Data Model',
  phase3:  'Phase 3 — Architecture & UX Research',
  phase3a: 'Phase 3A — API & Interaction Design',
  phase3c: 'Phase 3C — UX Mockups',
  phase3b: 'Phase 3B — Security Review',
  phase4:  'Phase 4 — Dev Planning',
  phase4a: 'Phase 4A — Standards & Roadmap',
  phase5:  'Phase 5 — Testing',
  phase6:  'Phase 6 — Prototype',
  phase7:  'Phase 7 — DevOps',
  phase8:  'Phase 8 — Operations',
};

/**
 * Maps each phase to its standard SDLC stage, shown as a subtitle under the
 * phase label in the sidebar (see ProjectWorkspace.tsx).
 */
export const PHASE_SDLC_STAGE: Record<PhaseId, string> = {
  phase0:  'Orchestration',
  phase1:  'Initiation',
  phase1b: 'Initiation',
  phase2:  'Requirements',
  phase2a: 'Requirements',
  phase3:  'Design',
  phase3a: 'Design',
  phase3c: 'Design',
  phase3b: 'Design (Security Gate)',
  phase4:  'Development Planning',
  phase4a: 'Development Planning',
  phase5:  'Testing',
  phase6:  'Prototype',
  phase7:  'Deployment',
  phase8:  'Operations & Maintenance',
};
