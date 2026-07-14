/**
 * © 2025 Arun Gaikwad. All rights reserved.
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
import type { Project } from '@/types/project.types';
import type { AgentId, PhaseId } from '@/types/agent.types';

/**
 * Agents that don't need a team member assigned to run — infrastructure /
 * planning agents rather than domain deliverable owners. sdlcOrchestrator
 * specifically must never be auto-skippable: it produces the plan gate0
 * gates on, and if it were skipped there'd be nothing for gate0 to review.
 */
export const ASSIGNMENT_EXEMPT_AGENTS: AgentId[] = ['sdlcOrchestrator'];

export function isAgentAssigned(project: Project, agentId: AgentId): boolean {
  const assignment = (project.agentAssignments ?? []).find((a) => a.agentId === agentId);
  return (assignment?.memberIds?.length ?? 0) > 0;
}

/** Every agent in the pipeline (all phases, in order). */
export function getAllAgentIds(): AgentId[] {
  return PHASE_ORDER.flatMap((ph) => PHASE_AGENTS[ph] ?? []);
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
