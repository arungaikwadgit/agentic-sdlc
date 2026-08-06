/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Team-assignment-driven agent enablement.
 *
 * An agent with nobody assigned to it (project.agentAssignments) is treated
 * as skipped: PipelineEngine.runAgent marks its run 'skipped' instead of
 * calling the LLM, downstream phase/gate logic treats 'skipped' the same as
 * 'complete' for progression purposes, and the SDLC Orchestrator is told
 * which agents are unavailable so its plan accounts for the gap instead of
 * assuming the full fleet will run.
 *
 * Single source of truth for "is this agent going to run" — consumed by
 * pipelineEngine.ts (execution), ReviewGateModal.tsx (gate completeness),
 * and ProjectWorkspace.tsx (sidebar UI + the pre-flight warning).
 */
import { PHASE_ORDER, PHASE_AGENTS } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import type { Project, ReviewGateId } from '@/types/project.types';
import type { AgentId, PhaseId } from '@/types/agent.types';

/**
 * Agents that don't need a team member assigned to run — infrastructure /
 * planning agents rather than domain deliverable owners. sdlcOrchestrator
 * specifically must never be auto-skippable: it produces the plan gate0
 * gates on, and if it were skipped there'd be nothing for gate0 to review.
 */
export const ASSIGNMENT_EXEMPT_AGENTS: AgentId[] = ['sdlcOrchestrator', 'tokenOptimizer', 'aiGovernance'];

export function isAgentAssigned(project: Project, agentId: AgentId): boolean {
  const assignment = (project.agentAssignments ?? []).find((a) => a.agentId === agentId);
  return (assignment?.memberIds?.length ?? 0) > 0;
}

/** Every agent in the pipeline (all phases, in order). */
export function getAllAgentIds(): AgentId[] {
  return PHASE_ORDER.flatMap((ph) => PHASE_AGENTS[ph] ?? []);
}

export function isInternalAgent(agentId: AgentId): boolean {
  return AGENT_DEFINITIONS[agentId]?.visibility === 'internal';
}

export function getUserVisibleAgentIds(): AgentId[] {
  return getAllAgentIds().filter((id) => !isInternalAgent(id));
}

/** Agents (excluding assignment-exempt ones) that currently have nobody assigned. */
export function getUnassignedAgents(project: Project): AgentId[] {
  return getAllAgentIds().filter(
    (id) => !ASSIGNMENT_EXEMPT_AGENTS.includes(id) && !isAgentAssigned(project, id)
  );
}

/** Is this agent currently marked skipped (won't execute)? */
export function isAgentSkipped(project: Project, agentId: AgentId): boolean {
  return (project.skippedAgentIds ?? []).includes(agentId);
}

/** Is every agent in this phase skipped — i.e. is the phase itself effectively disabled? */
export function isPhaseFullySkipped(project: Project, phase: PhaseId): boolean {
  const agents = PHASE_AGENTS[phase];
  if (!agents || agents.length === 0) return false;
  return agents.every((a) => isAgentSkipped(project, a));
}

/**
 * Merge the currently-unassigned agents into project.skippedAgentIds,
 * preserving any pre-existing entries (e.g. from a future manual-skip UI).
 * Called when the owner/admin confirms the pre-flight team-assignment
 * warning.
 */
export function computeSkippedAgentIdsAfterConfirm(project: Project): AgentId[] {
  const existing = new Set(project.skippedAgentIds ?? []);
  for (const id of getUnassignedAgents(project)) existing.add(id);
  return Array.from(existing);
}

/**
 * Phase index each gate blocks entry into — verbatim copy of the map
 * pipelineEngine.ts's automatic run loop already used privately (still
 * used there too, via re-export, so the two never drift). Exported here
 * since agentEnablement.ts is the documented single source of truth for
 * "is this agent going to run" — see getGateRequiredBeforePhase below and
 * the 2026-07-20 gate0-bypass fix it closes: manually-triggered
 * "Run"/"Re-run" buttons in ProjectWorkspace never checked gate approval
 * at all, only role/assignment (getAgentRunPermission in projectAccess.ts),
 * so PRD/Project Charter/BRD were runnable immediately on a new project
 * even though gate0 (SDLC Orchestrator plan approval) hadn't been approved
 * yet. Only the fully-automatic pipeline run respected gate sequencing.
 */
export const GATE_AFTER_PHASE_INDEX: Record<ReviewGateId, number> = {
  gate0: PHASE_ORDER.indexOf('phase0a'),
  gate1: PHASE_ORDER.indexOf('phase2'),
  gate2: PHASE_ORDER.indexOf('phase3'),
  gate3: PHASE_ORDER.indexOf('phase4'),
  gate5: PHASE_ORDER.indexOf('phase6'),
  gate6: -1,
};

/**
 * Which gate (if any) is still unapproved and blocks entry into phaseIndex.
 * Verbatim port of PipelineEngine's private getGateRequiredBefore method —
 * same algorithm, same result, now shared so the automatic pipeline run and
 * manual per-agent run permission checks can never disagree about gate
 * sequencing.
 */
export function getGateRequiredBeforePhase(
  phaseIndex: number,
  reviewGates: Project['reviewGates'],
): ReviewGateId | null {
  const explicitPendingGate = Object.entries(GATE_AFTER_PHASE_INDEX)
    .filter(([gateId, gatePhaseIndex]) => {
      if (gatePhaseIndex < 0 || gatePhaseIndex > phaseIndex) return false;
      const gate = reviewGates[gateId as ReviewGateId];
      return gate !== undefined && !gate.approved;
    })
    .sort(([, leftIndex], [, rightIndex]) => leftIndex - rightIndex)[0];

  if (explicitPendingGate) return explicitPendingGate[0] as ReviewGateId;

  // Preserve the normal phase-boundary behavior for a gate that has not
  // been persisted yet (for example the first run reaching Gate 3).
  for (const [gateId, gatePhaseIndex] of Object.entries(GATE_AFTER_PHASE_INDEX)) {
    if (gatePhaseIndex === phaseIndex) return gateId as ReviewGateId;
  }
  return null;
}

/** Which phase (if any) an agent belongs to. */
export function getAgentPhase(agentId: AgentId): PhaseId | null {
  for (const [phase, agents] of Object.entries(PHASE_AGENTS) as [PhaseId, AgentId[]][]) {
    if (agents.includes(agentId)) return phase;
  }
  return null;
}

/**
 * Which gate (if any) is still unapproved and blocks agentId from running
 * right now, given the project's current reviewGates state. Returns null
 * when there's no gate in the way (safe to run) or the agent isn't found
 * in any phase.
 *
 * Deliberately NOT implemented via getGateRequiredBeforePhase above: that
 * function assumes the caller is walking phases 0..N sequentially and has
 * already validated (and persisted) every earlier gate, so it only treats
 * a not-yet-persisted gate as blocking when its boundary exactly equals
 * the phase index being checked. This function is called for an arbitrary
 * agent directly — e.g. a manual "Run" click on a brand-new project where
 * no automatic pipeline run has ever happened and reviewGates is still
 * `{}` — so it can't rely on that invariant. Instead it checks every gate
 * whose boundary is at or before this agent's phase, treating "gate not
 * persisted yet" the same as "not approved" (both mean the gate hasn't
 * been explicitly approved), and returns the earliest one still pending.
 */
export function getGateBlockingAgent(project: Project, agentId: AgentId): ReviewGateId | null {
  const phase = getAgentPhase(agentId);
  if (!phase) return null;
  const phaseIndex = PHASE_ORDER.indexOf(phase);
  if (phaseIndex < 0) return null;

  const reviewGates = project.reviewGates ?? {};
  const pending = Object.entries(GATE_AFTER_PHASE_INDEX)
    .filter(([, gatePhaseIndex]) => gatePhaseIndex >= 0 && gatePhaseIndex <= phaseIndex)
    .sort(([, a], [, b]) => a - b)
    .find(([gateId]) => !reviewGates[gateId as ReviewGateId]?.approved);

  return pending ? (pending[0] as ReviewGateId) : null;
}
